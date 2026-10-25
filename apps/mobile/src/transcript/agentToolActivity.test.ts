import { describe, expect, it } from 'vitest';
import { projectGatewayEvent } from '../gateway/gatewayEventProjection';
import { mergeLatestHistory, mergeOlderHistory } from '../gateway/historyPagination';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { agentToolActivityFixture } from './agentToolActivityFixture';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';

const SESSION = 'agent:fixture:direct:tool-activity';
const RAW_ARTIFACTS = ['cat: illegal option', 'usage: cat [-belnstuv]', 'Shell cwd was reset', 'lastTouchedVersion', 'json.dump(', 'BatchMode=yes', '{', '}'];

function rendered(messages: WorkspaceMessage[], expanded = new Set<string>()) {
  return buildVisibleTranscriptRenderRows(messages, expanded).map((row) => row.compiled.source);
}

/**
 * The label `TranscriptSourceRow` announces for one row. A folded machine row
 * must name its tool and offer expansion without reading a payload aloud.
 */
function announced(messages: WorkspaceMessage[], messageID: string) {
  const row = buildVisibleTranscriptRenderRows(messages, new Set()).find((candidate) => candidate.message.id === messageID)!;
  return `${row.message.role}, line ${row.sourceRow + 1}, ${row.compiled.source || 'blank'}${row.fold ? `, ${row.fold.expanded ? 'collapse' : 'expand'} details` : ''}`;
}

/**
 * An external agent CLI reports tool activity only as live `agent` tool frames
 * and persists the turn as one assistant message. The reader must still get
 * bounded semantic rows, an intact answer, and no raw payload on screen.
 */
describe('external agent tool activity', () => {
  const messages = agentToolActivityFixture();
  const rows = buildVisibleTranscriptRenderRows(messages, new Set());
  const liveTools = rows.filter((row) => row.message.role === 'tool' && row.message.id.startsWith('live-tool-'));

  it('renders one folded row per live tool and never leaks a raw payload', () => {
    expect(liveTools.every((row) => row.fold?.expanded === false)).toBe(true);
    expect(liveTools.map((row) => row.compiled.source.split('  …')[0])).toEqual([
      'Read · memory/register-newer-provider-model.md',
      'Bash · Check config formatting before editing',
      'Bash · Back up config before edit',
      'Bash · Add the model to the catalog and allowlist',
      'Grep · modelPolicy\\.allow',
      'Skill · provider-catalog',
    ]);
  });

  it('keeps every raw artifact off the collapsed transcript', () => {
    const visible = rendered(messages).join('\n');
    for (const leak of RAW_ARTIFACTS) expect(visible, leak).not.toContain(leak);
  });

  it('marks the failed tool as failed rather than completed', () => {
    const failed = messages.find((message) => message.role === 'tool' && message.tool?.summary.includes('Check config formatting'));
    expect(failed?.state).toBe('error');
  });

  it('keeps the terminal answer intact, whole and after its tool activity', () => {
    const answer = messages.find((message) => message.role === 'assistant' && message.text.startsWith('Done — the model is live'))!;
    expect(answer.text).toContain('the allowlist entry that actually drives the picker');
    const answerRows = rows.filter((row) => row.message.id === answer.id);
    // The answer is never folded away behind a summary: every line is present.
    expect(answerRows.every((row) => !row.fold)).toBe(true);
    expect(rows.indexOf(answerRows[0]!)).toBeGreaterThan(rows.indexOf(liveTools.at(-1)!));
  });

  it('reveals the raw payload only for the one tool the reader expands', () => {
    const target = messages.find((message) => message.role === 'tool' && message.tool?.summary.includes('Check config formatting'))!;
    const expanded = rendered(messages, new Set([target.id])).join('\n');
    expect(expanded).toContain('cat: illegal option -- A');
    expect(expanded).toContain('usage: cat [-belnstuv] [file ...]');
    expect(expanded).not.toContain('added catalog entry');
    expect(rendered(messages, new Set([target.id])).filter((line) => line.includes('lastTouchedVersion'))).toHaveLength(1);
  });

  it('announces a folded tool row by its identity and its expansion affordance', () => {
    const target = messages.find((message) => message.role === 'tool' && message.tool?.summary.includes('Check config formatting'))!;
    const label = announced(messages, target.id);
    expect(label).toContain('tool, line ');
    expect(label).toContain('Bash · Check config formatting before editing');
    expect(label).toContain('expand details');
    for (const leak of RAW_ARTIFACTS) expect(label, leak).not.toContain(leak);
    expect(announced(messages, target.id).length).toBeLessThan(200);
  });
});

/**
 * The reported splatter: one canonical assistant message that interleaves
 * prose with its tool calls. Its payload used to reach the reader as unfolded
 * assistant prose, braces included, ahead of the answer.
 */
describe('interleaved canonical tool activity', () => {
  const messages = agentToolActivityFixture();
  const turn = messages.filter((message) => message.id.startsWith('fixture-interleaved-turn'));

  it('publishes the prose once and each tool call as its own bounded row', () => {
    expect(turn.map((message) => message.role)).toEqual(['assistant', 'tool', 'tool']);
    expect(turn[0]!.text).toBe('Checking the live config before I touch it.');
    expect(turn.map((message) => message.id)).toEqual(['fixture-interleaved-turn', 'fixture-interleaved-turn#tool-1', 'fixture-interleaved-turn#tool-2']);
    expect(turn.slice(1).map((message) => message.tool?.summary)).toEqual([
      "exec · ssh operator@192.0.2.4 'cat -A agent.json | head -20 …",
      "exec · ssh operator@192.0.2.4 'cp -p agent.json agent.json.pre-edit …",
    ]);
  });

  it('keeps the interleaved payload folded and brace-free until it is expanded', () => {
    const visible = rendered(messages);
    expect(visible).toContain("exec · ssh operator@192.0.2.4 'cat -A agent.json | head -20 …  … [5 lines folded]");
    for (const leak of RAW_ARTIFACTS) expect(visible.join('\n'), leak).not.toContain(leak);
    const expanded = rendered(messages, new Set(['fixture-interleaved-turn#tool-1'])).join('\n');
    expect(expanded).toContain('-o BatchMode=yes');
    expect(expanded).toContain('"workdir": "/Users/operator/.agent"');
  });

  it('names the paired result from its call and states the failure first', () => {
    const result = messages.find((message) => message.id === 'fixture-interleaved-result')!;
    expect(result).toMatchObject({ role: 'tool', state: 'error', tool: { name: 'exec' } });
    expect(result.tool?.summary).toBe("exec · failed · ssh operator@192.0.2.4 'cat -A agent.json | head -20 …");
    expect(rendered(messages, new Set([result.id])).join('\n')).toContain('cat: illegal option -- A');
  });

  it('leaves the following answer as the prominent, unfolded row', () => {
    const rows = buildVisibleTranscriptRenderRows(messages, new Set());
    const answer = rows.filter((row) => row.message.id === 'fixture-interleaved-answer');
    expect(answer).toHaveLength(1);
    expect(answer[0]!.fold).toBeUndefined();
    expect(answer[0]!.compiled.source).toBe('The config is intact; the inspection flag was wrong, not the file.');
    expect(rows.indexOf(answer[0]!)).toBe(rows.length - 1);
  });
});

/**
 * Reviewable render evidence: the exact collapsed transcript a reader sees for
 * both preserved envelope shapes. Every machine row is one bounded headline;
 * both answers are whole, prominent and last in their turn.
 */
describe('collapsed transcript render', () => {
  it('renders the fixture exactly as the reader receives it', () => {
    const rows = buildVisibleTranscriptRenderRows(agentToolActivityFixture(), new Set());
    expect(rows.map((row) => [row.message.role, row.compiled.source])).toEqual([
      ['user', 'Add the new provider model to the selector.'],
      ['tool', 'Read · memory/register-newer-provider-model.md  … [4 lines folded]'],
      ['tool', 'Bash · Check config formatting before editing  … [14 lines folded]'],
      ['tool', 'Bash · Back up config before edit  … [2 lines folded]'],
      ['tool', 'Bash · Add the model to the catalog and allowlist  … [4 lines folded]'],
      ['tool', 'Grep · modelPolicy\\.allow  … [3 lines folded]'],
      ['tool', 'Skill · provider-catalog  … [1 line folded]'],
      ['assistant', 'Done — the model is live in the selector.'],
      ['assistant', '**What changed** in `~/.agent/agent.json` (backup: `agent.json.pre-edit-20260102-090000`):'],
      ['assistant', '1. a catalog entry for the new model id'],
      ['assistant', '2. a runtime binding matching its sibling'],
      ['assistant', '3. the allowlist entry that actually drives the picker'],
      ['assistant', 'The catalog entry alone would have been invisible; the allowlist is the selector list.'],
      ['run', 'end'],
      ['user', 'Check the config before editing it.'],
      ['assistant', 'Checking the live config before I touch it.'],
      ['tool', "exec · ssh operator@192.0.2.4 'cat -A agent.json | head -20 …  … [5 lines folded]"],
      ['tool', "exec · ssh operator@192.0.2.4 'cp -p agent.json agent.json.pre-edit …  … [5 lines folded]"],
      ['tool', "exec · failed · ssh operator@192.0.2.4 'cat -A agent.json | head -20 …  … [8 lines folded]"],
      ['assistant', 'The config is intact; the inspection flag was wrong, not the file.'],
    ]);
  });
});

describe('tool activity stability across refresh and relaunch', () => {
  const page = {
    sessionKey: SESSION,
    messages: [
      { id: 'turn', role: 'assistant', content: [
        { type: 'text', text: 'Reading the config.' },
        { type: 'toolCall', id: 'call-1', name: 'exec', arguments: { command: 'cat agent.json', workdir: '/tmp' } },
      ], timestamp: 1_788_359_872_003 },
      { id: 'result', role: 'toolResult', content: [{ type: 'toolResult', toolCallId: 'call-1', content: '{"level":"debug"}' }], idempotencyKey: 'run:tool:call-1:result', timestamp: 1_788_359_873_003 },
    ],
  };

  it('projects the same rows and identities on every refresh', () => {
    const first = messagesFromPayload(page);
    const second = messagesFromPayload(page);
    expect(second.map((message) => message.id)).toEqual(first.map((message) => message.id));
    expect(rendered(second)).toEqual(rendered(first));
    // A relaunch replays the same page into an empty transcript; a refresh
    // replays it over the rows already published. Neither may duplicate a row.
    expect(mergeLatestHistory(second, first, SESSION).map((message) => message.id)).toEqual(first.map((message) => message.id));
    expect(mergeOlderHistory(first, second, SESSION).map((message) => message.id)).toEqual(first.map((message) => message.id));
  });

  it('reconciles the live aggregate into the canonical result rather than duplicating it', () => {
    const live = projectGatewayEvent({
      event: 'agent',
      payload: { sessionKey: SESSION, runId: 'run', stream: 'tool', data: { phase: 'result', name: 'exec', toolCallId: 'call-1', result: '{"level":"debug"}' } },
    }, SESSION)!.message;
    const merged = mergeLatestHistory(messagesFromPayload(page), [{ ...live, sessionKey: SESSION }], SESSION);
    expect(merged.filter((message) => message.role === 'tool').map((message) => message.id)).toEqual(['turn#tool-1', 'result']);
  });

  it('retains a live tool row the canonical page never recorded', () => {
    const merged = agentToolActivityFixture();
    const refreshed = mergeLatestHistory(merged.filter((message) => message.source === 'history'), merged, SESSION);
    expect(refreshed.map((message) => message.id)).toEqual(merged.map((message) => message.id));
    expect(refreshed.filter((message) => message.id.startsWith('live-tool-'))).toHaveLength(6);
  });
});

/**
 * Classification is structural. A runtime whose dialect the Gateway already
 * normalized keeps its presentation, and a runtime that publishes the provider
 * dialect gains the same one.
 */
describe('runtime-neutral dialects', () => {
  it.each([
    ['plain string', 'Reading the config.'],
    ['untyped text block', { text: 'Reading the config.' }],
  ])('retains %s prose alongside structured tool activity across history refreshes', (_format, prose) => {
    const page = {
      sessionKey: SESSION,
      messages: [{ id: 'mixed', role: 'assistant', content: [
        prose,
        { type: 'tool_use', id: 'call-mixed', name: 'Bash', input: { command: 'cat config.json' } },
      ] }],
    };
    const first = messagesFromPayload(page);
    expect(first.map((message) => message.role)).toEqual(['assistant', 'tool']);
    expect(first[0]).toMatchObject({ id: 'mixed', text: 'Reading the config.' });
    expect(first[1]).toMatchObject({ id: 'mixed#tool-1', tool: { name: 'Bash', summary: 'Bash · cat config.json' } });
    expect(rendered(first)[0]).toBe('Reading the config.');
    const refreshed = mergeLatestHistory(messagesFromPayload(page), first, SESSION);
    expect(refreshed.map((message) => message.id)).toEqual(first.map((message) => message.id));
    expect(rendered(refreshed)).toEqual(rendered(first));
  });

  it('projects provider tool parts as folded tool rows instead of assistant prose', () => {
    const messages = messagesFromPayload({
      sessionKey: SESSION,
      messages: [
        { id: 'call', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'cat -A config.json', description: 'Inspect config' } }], timestamp: 1_788_359_872_003 },
        { id: 'result', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'cat: illegal option -- A' }], timestamp: 1_788_359_873_003 },
      ],
    });
    expect(messages.map((message) => message.role)).toEqual(['tool', 'tool']);
    expect(messages[0]).toMatchObject({ text: expect.stringContaining('Bash · Inspect config'), tool: { name: 'Bash' } });
    // The result inherits the identity its call declared and reports failure.
    expect(messages[1]).toMatchObject({ state: 'error', tool: { name: 'Bash' } });
    expect(rendered(messages)).toEqual([
      'Bash · Inspect config  … [4 lines folded]',
      'Bash · failed · Inspect config  … [1 line folded]',
    ]);
  });

  it('keeps the Gateway dialect presenting exactly as it did', () => {
    const messages = messagesFromPayload({
      sessionKey: SESSION,
      messages: [
        { id: 'call', role: 'assistant', content: [{ type: 'toolCall', id: 'exec-1', name: 'apply_patch', arguments: { changes: [{ path: '/tmp/project/src/App.tsx', kind: { type: 'update' } }] } }], timestamp: 1_788_359_872_003 },
        { id: 'result', role: 'toolResult', content: [{ type: 'toolResult', toolCallId: 'exec-1', text: 'applied' }], timestamp: 1_788_359_873_003 },
      ],
    });
    expect(messages.map((message) => message.id)).toEqual(['call', 'result']);
    expect(rendered(messages)).toEqual([
      'apply_patch · update App.tsx  … [10 lines folded]',
      'apply_patch · update App.tsx  … [1 line folded]',
    ]);
  });

  it('projects a live provider-dialect chat tool part as one folded tool row', () => {
    const projected = projectGatewayEvent({
      event: 'chat',
      payload: {
        sessionKey: SESSION, runId: 'run-1', state: 'delta',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: '/tmp/scratch/notes.md', content: '# heading\nbody' } }] },
      },
    }, SESSION);
    expect(projected?.message).toMatchObject({ role: 'tool', tool: { name: 'Write', summary: 'Write · scratch/notes.md' } });
    expect(rendered([projected!.message])).toEqual(['Write · scratch/notes.md  … [4 lines folded]']);
  });
});
