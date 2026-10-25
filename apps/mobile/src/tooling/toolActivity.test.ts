import { describe, expect, it } from 'vitest';
import {
  conciseToolSummary,
  contentIsOnlyToolActivity,
  machineActivitySummary,
  toolActivitiesFromContent,
  toolActivityFromContent,
  toolActivityFromLiveEvent,
  toolActivityPairedWithCall,
  toolCallActivityIndex,
  toolRowText,
} from './toolActivity';

/**
 * Envelope evidence: an external agent CLI reports tool activity in the
 * provider dialect (`tool_use` / `tool_result`) rather than the Gateway's own
 * `toolCall` / `toolResult` dialect. Both name the same semantic identity and
 * must reach the transcript as one bounded tool row.
 */
describe('tool activity identity', () => {
  it('retains an explicit live error phase without requiring a second failure flag', () => {
    const activity = toolActivityFromLiveEvent({ phase: 'error', name: 'Bash', toolCallId: 'failed-call', result: 'command failed' });
    expect(activity.status).toBe('failed');
    expect(activity.summary).toBe('Bash · failed');
  });
  const providerCall = { type: 'tool_use', id: 'toolu_01PgMKK25V2ygJ1TJa4LyXdJ', name: 'Bash', input: { command: 'ls -la ~/.config/*.json', description: 'Locate config files' } };
  const providerResult = {
    type: 'tool_result',
    tool_use_id: 'toolu_01PgMKK25V2ygJ1TJa4LyXdJ',
    is_error: true,
    content: 'cat: illegal option -- A\nusage: cat [-belnstuv] [file ...]\nShell cwd was reset to /tmp/agent',
  };
  const gatewayCall = { type: 'toolCall', id: 'exec-1', name: 'apply_patch', arguments: { input: '*** Begin Patch\n*** Delete File: /tmp/a.md\n*** End Patch' } };

  it('recognizes the provider dialect as tool activity, not assistant prose', () => {
    expect(contentIsOnlyToolActivity([providerCall])).toBe(true);
    expect(contentIsOnlyToolActivity([providerResult])).toBe(true);
    expect(contentIsOnlyToolActivity([{ type: 'text', text: 'Let me check the live config.' }])).toBe(false);
  });

  it('keeps the Gateway dialect recognized', () => {
    expect(contentIsOnlyToolActivity([gatewayCall])).toBe(true);
  });

  it('names the provider tool and hides its argument payload behind a summary', () => {
    const activity = toolActivityFromContent([providerCall], '');
    expect(activity?.name).toBe('Bash');
    expect(activity?.callId).toBe('toolu_01PgMKK25V2ygJ1TJa4LyXdJ');
    expect(activity?.summary).toBe('Bash · Locate config files');
    expect(activity?.summary).not.toMatch(/[{}]/);
    expect(activity?.detail).toContain('ls -la ~/.config/*.json');
  });

  it('reports a failed provider tool result as failed, not completed', () => {
    const activity = toolActivityFromContent([providerResult], '');
    expect(activity?.status).toBe('failed');
    expect(activity?.callId).toBe('toolu_01PgMKK25V2ygJ1TJa4LyXdJ');
    expect(activity?.summary).toBe('tool · failed');
    expect(toolRowText(activity!)).toContain('cat: illegal option -- A');
    expect(toolRowText(activity!).split('\n')[0]).not.toMatch(/[{}]/);
  });

  it('reports a live tool failure from the isError flag alone', () => {
    const activity = toolActivityFromLiveEvent({
      phase: 'result',
      name: 'Bash',
      toolCallId: 'toolu_01PgMKK25V2ygJ1TJa4LyXdJ',
      isError: true,
      result: { output: 'cat: illegal option -- A', exitCode: 1 },
    });
    expect(activity.status).toBe('failed');
    expect(activity.summary).toBe('Bash · failed');
    expect(activity.detail).toContain('cat: illegal option -- A');
  });

  it('summarizes a live tool start from its arguments without raw braces', () => {
    const activity = toolActivityFromLiveEvent({
      phase: 'start',
      name: 'Skill',
      toolCallId: 'toolu_019JAGNF9MqPNsAfXLvU8jHR',
      args: { skill: 'claude-api' },
    });
    expect(activity.summary).toBe('Skill · claude-api');
    expect(activity.status).toBe('running');
  });

  it('shortens a long absolute path to its tail instead of leaking the whole location', () => {
    const activity = toolActivityFromLiveEvent({
      phase: 'start',
      name: 'Read',
      toolCallId: 'toolu_01LCDHEhNPa7QtjiHsaFrHTf',
      args: { file_path: '/Users/someone/.claude/projects/-Users-someone--vimicate/memory/openclaw-register-newer-provider-model.md' },
    });
    expect(activity.summary).toBe('Read · memory/openclaw-register-newer-provider-model.md');
  });

  it('summarizes an opaque machine payload without printing its object braces', () => {
    const projected = machineActivitySummary({ command: 'rm -rf /tmp/scratch', host: 'fixture-host' }, 'Approval required');
    expect(projected.summary).toBe('rm -rf /tmp/scratch');
    expect(projected.summary).not.toMatch(/[{}]/);
    expect(projected.detail).toContain('"host"');
  });

  it('falls back to the caller label when a machine payload carries no semantic key', () => {
    const projected = machineActivitySummary({ opaque: [1, 2, 3] }, 'agent stream error');
    expect(projected.summary).toBe('agent stream error');
    expect(projected.detail).toContain('"opaque"');
  });
});

describe('interleaved and structured payloads', () => {
  const interleaved = [
    { type: 'text', text: 'Checking both repositories.' },
    { type: 'toolCall', id: 'call-a', name: 'exec', arguments: { command: "ssh -i /home/agent/.ssh/id_ed25519 -o BatchMode=yes host 'cd ~/repo && git status --short'", workdir: '/home/agent' } },
    { type: 'toolCall', id: 'call-b', name: 'exec', arguments: { command: "ssh -i /home/agent/.ssh/id_ed25519 -o BatchMode=yes host 'cd ~/repo/module && git log --oneline -n 5'", workdir: '/home/agent' } },
  ];

  it('resolves one activity per tool part in wire order', () => {
    const activities = toolActivitiesFromContent(interleaved);
    expect(activities.map((activity) => activity.callId)).toEqual(['call-a', 'call-b']);
    expect(activities.map((activity) => activity.summary)).toEqual([
      "exec · ssh host 'git status --short …",
      "exec · ssh host 'git log --oneline -n 5 …",
    ]);
    // Sibling calls of one launcher must not collapse to the same headline.
    expect(new Set(activities.map((activity) => activity.summary)).size).toBe(2);
    expect(activities.every((activity) => !/[{}]/.test(activity.summary))).toBe(true);
    expect(activities[0]?.detail).toContain('"workdir": "/home/agent"');
  });

  it('retains an object or array payload only in the detail a reader expands', () => {
    const structured = toolActivityFromContent([{ type: 'toolResult', toolCallId: 'call-a', name: 'grep', content: ['/etc/agent.json', '/etc/agent.d/logging.json'] }])!;
    expect(structured.summary).toBe('grep · completed');
    expect(structured.detail).toContain('/etc/agent.d/logging.json');
    expect(toolRowText(structured).split('\n')[0]).not.toMatch(/[[\]{}]/);
  });

  it('names a result from its own call and keeps a failure legible in text', () => {
    const calls = toolCallActivityIndex([{ content: interleaved }]);
    const anonymous = toolActivityFromContent([{ type: 'toolResult', toolCallId: 'call-b', isError: true, content: 'fatal: not a git repository' }])!;
    const paired = toolActivityPairedWithCall(anonymous, calls);
    expect(paired.name).toBe('exec');
    expect(paired.summary).toBe("exec · failed · ssh host 'git log --oneline -n 5 …");
    expect(toolActivityPairedWithCall(toolActivityFromContent([{ type: 'toolResult', toolCallId: 'call-a', content: 'clean' }])!, calls).summary)
      .toBe("exec · ssh host 'git status --short …");
  });
});

describe('concise tool summaries', () => {
  it('uses the first shell action without its launcher or chained payload', () => {
    expect(conciseToolSummary({
      name: 'bash',
      phase: 'start',
      argumentsValue: { command: "/bin/zsh -lc 'git status --short; git diff --check'", cwd: '/tmp/project' },
    })).toBe('bash · git status --short …');
  });

  it('summarizes a patch from its structured changed-file list', () => {
    expect(conciseToolSummary({
      name: 'apply_patch',
      phase: 'start',
      argumentsValue: { changes: [{ path: '/tmp/project/src/App.tsx', kind: { type: 'update' } }] },
    })).toBe('apply_patch · update App.tsx');
  });

  it('does not repeat a name-only historical label', () => {
    expect(toolActivityFromContent(undefined, 'bash\n{"opaque":"payload"}')?.summary).toBe('bash · activity');
  });

  it('summarizes the action a chained command performs, not the directory it enters', () => {
    expect(conciseToolSummary({ name: 'bash', phase: 'start', argumentsValue: { command: 'cd ~/.agent && head -c 400 agent.json' } }))
      .toBe('bash · head -c 400 agent.json …');
  });
});
