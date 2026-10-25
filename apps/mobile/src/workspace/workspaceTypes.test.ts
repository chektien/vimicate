import { describe, expect, it } from 'vitest';
import { projectsFromPayload, semanticWorkspaceRole, workspaceRole } from './workspaceTypes';
import { gatewayContentText, messagesFromPayload } from './historyMessageProjection';

describe('workspace gateway adapters', () => {

  it('carries the run identity the Gateway sends under its own metadata', () => {
    // chat.history sends no top-level runId; every message carries it as
    // `__openclaw.runId`. Dropping it leaves canonical history with no run
    // identity, so a rendered final answer can never be matched to its run and
    // its pending-final recovery can never settle.
    const [prompt, answer] = messagesFromPayload({
      messages: [
        { role: 'user', content: 'regenerate the coding CSV', timestamp: '1', __openclaw: { runId: 'run-77' } },
        { role: 'assistant', content: 'Done — the CSV is regenerated.', timestamp: '2', __openclaw: { runId: 'run-77' } },
      ],
    });

    expect(prompt).toMatchObject({ role: 'user', runId: 'run-77' });
    expect(answer).toMatchObject({ role: 'assistant', runId: 'run-77' });
  });

  it('presents Claude CLI prose that precedes a tool call as narration, like Codex commentary', () => {
    const claude = (id: string, stopReason: string, content: unknown[]) => ({
      role: 'assistant', api: 'anthropic-messages', provider: 'claude-cli', model: 'claude-opus-5-5', stopReason, timestamp: 1790228000000, content,
      __openclaw: { id, importedFrom: 'claude-cli', cliSessionId: '00000000-0000-4000-8000-000000000114', externalId: id },
    });
    const rows = messagesFromPayload({ messages: [
      claude('step-1', 'tool_use', [{ type: 'text', text: 'Checking the gateway usage payload next.' }]),
      claude('step-2', 'tool_use', [{ type: 'toolcall', id: 'toolu_1', name: 'Bash', arguments: { command: 'true' } }]),
      claude('step-3', 'tool_use', [{ type: 'text', text: 'Reading the handler.' }, { type: 'toolcall', id: 'toolu_2', name: 'Read', arguments: { file_path: '/tmp/x' } }]),
      claude('step-4', 'end_turn', [{ type: 'text', text: 'The footer now shows the real quota.' }]),
    ] });
    expect(rows.map(row => [row.role, row.text.split('\n')[0]])).toEqual([
      ['narration', 'Checking the gateway usage payload next.'],
      ['tool', expect.any(String)],
      ['narration', 'Reading the handler.'],
      ['tool', expect.any(String)],
      ['assistant', 'The footer now shows the real quota.'],
    ]);
    // Other runtimes own their commentary identity; a tool-use stop alone is not it.
    const [embedded] = messagesFromPayload({ messages: [{ role: 'assistant', provider: 'anthropic', stopReason: 'toolUse', content: [{ type: 'text', text: 'Embedded prose.' }] }] });
    expect(embedded).toMatchObject({ role: 'assistant', text: 'Embedded prose.' });
  });

  it('makes the authoritative oversized-history placeholder recoverable by its concrete message identity', () => {
    const [omitted] = messagesFromPayload({
      sessionKey: 'agent:main:video',
      sessionId: '00000000-0000-4000-8000-000000000105',
      messages: [{
        role: 'assistant',
        timestamp: 1789000000000,
        content: [{ type: 'text', text: '[chat.history omitted: message too large]' }],
        __openclaw: { id: 'message-oversized-1', truncated: true, reason: 'oversized', runId: 'run-video-1' },
      }],
    });

    expect(omitted).toMatchObject({
      id: 'message-oversized-1',
      role: 'assistant',
      runId: 'run-video-1',
      sessionKey: 'agent:main:video',
      recovery: { sourceMessageId: 'message-oversized-1', state: 'available' },
    });
  });

  it('does not infer recovery from authored omission-like prose without the Gateway oversized descriptor', () => {
    const rows = messagesFromPayload({ messages: [
      { id: 'quoted', role: 'assistant', content: '[chat.history omitted: message too large]' },
      { id: 'wrong-reason', role: 'assistant', content: '[chat.history omitted: message too large]', __openclaw: { id: 'wrong-reason', truncated: true, reason: 'budget' } },
      { id: 'wrong-text', role: 'assistant', content: 'message too large', __openclaw: { id: 'wrong-text', truncated: true, reason: 'oversized' } },
    ] });

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.recovery === undefined)).toBe(true);
  });

  it('does not make an oversized omission retrievable through a synthesized display identity', () => {
    const [omitted] = messagesFromPayload({ messages: [{
      role: 'assistant',
      content: '[chat.history omitted: message too large]',
      __openclaw: { truncated: true, reason: 'oversized' },
    }] });

    expect(omitted?.id).toMatch(/^history-/);
    expect(omitted?.recovery).toEqual({
      sourceMessageId: '',
      state: 'unavailable',
      detail: 'full response unavailable: no concrete Gateway message id',
    });
  });

  it('prefers an explicit top-level run identity over the metadata copy', () => {
    const [only] = messagesFromPayload({
      messages: [{ role: 'assistant', content: 'answer', timestamp: '1', runId: 'explicit', __openclaw: { runId: 'metadata' } }],
    });
    expect(only).toMatchObject({ runId: 'explicit' });
  });
  it('preserves semantic transcript roles instead of converting them to assistant', () => {
    expect(workspaceRole('approval')).toBe('approval');
    expect(workspaceRole('error')).toBe('error');
    expect(workspaceRole('unknown-status')).toBe('system');
  });

  it('keeps tool and media payloads out of the prose a reader scans for the answer', () => {
    // Tool parts publish their own bounded rows; nothing they carry — least of
    // all a raw argument object — belongs to the surrounding conversation text.
    expect(gatewayContentText([
      { type: 'text', text: 'Checking the live config.' },
      { type: 'toolcall', name: 'exec', arguments: { cmd: 'pwd' } },
      { type: 'toolresult', name: 'exec', text: '/tmp' },
      { type: 'image', title: 'capture.png' },
    ])).toBe('Checking the live config.');
    expect(gatewayContentText([{ type: 'image', title: 'capture.png' }])).toBe('');
  });

  it('presents assistant tool-call records as machine progress without reclassifying prose', () => {
    expect(semanticWorkspaceRole('assistant', [{ type: 'toolCall', name: 'exec', arguments: { cmd: 'pwd' } }])).toBe('tool');
    expect(semanticWorkspaceRole('assistant', [{ type: 'text', text: 'I will inspect this.' }, { type: 'toolCall', name: 'exec' }])).toBe('assistant');
    expect(messagesFromPayload({ messages: [{ id: 'tool-only', role: 'assistant', content: [{ type: 'toolCall', name: 'exec', arguments: { cmd: 'pwd' } }] }] })[0]).toMatchObject({ role: 'tool' });
  });

  it('adds concise semantic fold metadata to historical tool calls and results', () => {
    const [call, result] = messagesFromPayload({ messages: [
      { id: 'call', role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: "/bin/zsh -lc 'pnpm test'", env: { TOKEN: 'private' } } }] },
      { id: 'result', role: 'toolResult', content: [{ type: 'toolResult', toolCallId: 'call-1', name: 'bash', text: '{"tests":129}' }] },
    ] });

    expect(call?.tool).toEqual({ name: 'bash', summary: 'bash · pnpm test' });
    expect(result?.tool).toEqual(call?.tool);
    expect(call?.text).toContain('"TOKEN": "private"');
    expect(result?.text).toContain('{"tests":129}');
  });

  it('does not turn Markdown printed by a tool into false image cards', () => {
    const [message] = messagesFromPayload({ messages: [{
      id: 'tool-result', role: 'toolResult', content: [{
        type: 'toolResult', name: 'bash', text: 'source:\n![Architecture](../images/architecture.png)\n/Users/fixture/repo/screenshot.png',
      }],
    }] }, '~/repos/example-research');
    expect(message?.role).toBe('tool');
    expect(message?.attachments).toBeUndefined();
  });

  it('retains genuine structured images returned by a tool', () => {
    const [message] = messagesFromPayload({ messages: [{
      id: 'tool-image', role: 'toolResult', content: [{ type: 'image', mimeType: 'image/png', url: 'https://cdn.example/capture.png', alt: 'capture.png', width: 2048, height: 1536, byteCount: 251_700 }],
    }] });
    expect(message?.attachments).toEqual([expect.objectContaining({ uri: 'https://cdn.example/capture.png', pixelWidth: 2048, pixelHeight: 1536, byteCount: 251_700 })]);
  });

  it('does not render source-less omitted tool images as blank cards', () => {
    const [message] = messagesFromPayload({ messages: [{
      id: 'omitted-images', role: 'toolResult', content: [
        { type: 'text', text: 'The search returned two image previews.' },
        { type: 'image', mimeType: 'image/jpeg', omitted: true, bytes: 12_345 },
        { type: 'image', mimeType: 'image/png', omitted: true, bytes: 67_890 },
      ],
    }] });
    expect(message).toMatchObject({ role: 'tool', id: 'omitted-images' });
    expect(message?.attachments).toBeUndefined();
    expect(message?.text).toContain('The search returned two image previews.');

    const [mixed] = messagesFromPayload({ messages: [{
      id: 'mixed-images', role: 'toolResult', content: [
        { type: 'image', mimeType: 'image/jpeg', omitted: true, bytes: 12_345 },
        { type: 'image', mimeType: 'image/png', url: 'https://cdn.example/real.png' },
      ],
    }] });
    expect(mixed?.attachments).toEqual([expect.objectContaining({ uri: 'https://cdn.example/real.png' })]);
  });

  it('projects markdown, MEDIA markers, and host image paths as attachments', () => {
    const [message] = messagesFromPayload({ messages: [{
      id: 'media-answer', role: 'assistant', text: 'done\nMEDIA:/Users/fixture/Library/Mobile Documents/com~apple~CloudDocs/Downloads/result.png\n![remote](https://cdn.example/plot.webp)',
    }] });
    expect(message?.text).toBe('done\n![remote](https://cdn.example/plot.webp)');
    expect(message?.attachments).toEqual([
      expect.objectContaining({ filename: 'remote', mimeType: 'image/webp', uri: 'https://cdn.example/plot.webp' }),
      expect.objectContaining({ filename: 'result.png', mimeType: 'image/png', uri: '/__openclaw__/assistant-media?source=%2FUsers%2Ffixture%2FLibrary%2FMobile%20Documents%2Fcom~apple~CloudDocs%2FDownloads%2Fresult.png' }),
    ]);
  });

  it('preserves a Computer Use screenshot path with spaces as authenticated host media', () => {
    const source = '/var/folders/v4/device/T/com.openai.sky.CUAService/Word Screenshot 2026-08-27 at 4.53.32 PM.jpeg';
    const [message] = messagesFromPayload({ messages: [{
      id: 'computer-use-proof',
      role: 'assistant',
      content: `Here is the recovered signature page:\n\n![Example signed page](<${source}>)`,
    }] });

    expect(message?.attachments).toEqual([expect.objectContaining({
      filename: 'Example signed page',
      mimeType: 'image/jpeg',
      uri: `/__openclaw__/assistant-media?source=${encodeURIComponent(source)}`,
    })]);
  });

  it('normalizes inline OpenClaw image blocks and deduplicates repeated sources', () => {
    const [message] = messagesFromPayload({ messages: [{ role: 'assistant', content: [{ type: 'image', mimeType: 'image/png', fileName: 'tiny.png', content: 'aGVsbG8=' }, { type: 'image', mimeType: 'image/png', fileName: 'tiny.png', content: 'aGVsbG8=' }] }] });
    expect(message?.attachments).toEqual([expect.objectContaining({ filename: 'tiny.png', uri: 'data:image/png;base64,aGVsbG8=' })]);
  });

  it('accepts nested OpenAI and Gateway structured image source shapes', () => {
    const [message] = messagesFromPayload({ messages: [{ role: 'assistant', content: [
      { type: 'input_image', image_url: { url: 'https://cdn.example/input.png' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' }, file_name: 'nested.jpg' },
      { type: 'output_image', imageUrl: 'media://outgoing/550e8400-e29b-41d4-a716-446655440000?sessionKey=agent:main:example-thread' },
    ] }] });
    expect(message?.attachments).toEqual([
      expect.objectContaining({ uri: 'https://cdn.example/input.png', mimeType: 'image/*' }),
      expect.objectContaining({ filename: 'nested.jpg', uri: 'data:image/jpeg;base64,aGVsbG8=' }),
      expect.objectContaining({ uri: expect.stringContaining('assistant-media?source=media%3A%2F%2Foutgoing') }),
    ]);
  });

  it('routes structured host files and managed outgoing descriptors through authenticated media', () => {
    const [message] = messagesFromPayload({ messages: [{ role: 'assistant', content: [
      { type: 'image', mimeType: 'image/png', path: 'file:///Users/fixture/Downloads/host.png', fileName: 'host.png' },
      { type: 'image', mimeType: 'image/png', uri: 'media://outgoing/550e8400-e29b-41d4-a716-446655440000?sessionKey=agent:main:example-thread', fileName: 'outgoing.png' },
    ] }] });
    expect(message?.attachments?.[0]?.uri).toBe('/__openclaw__/assistant-media?source=%2FUsers%2Ffixture%2FDownloads%2Fhost.png');
    expect(message?.attachments?.[1]?.uri).toContain('/__openclaw__/assistant-media?source=media%3A%2F%2Foutgoing');
  });

  it('resolves relative Markdown images against the project workspace', () => {
    const [message] = messagesFromPayload({ messages: [{ role: 'assistant', content: '![result](../images/final.png "Final")' }] }, '~/projects/example-notes');
    expect(message?.attachments?.[0]).toMatchObject({ filename: 'result', uri: '/__openclaw__/assistant-media?source=~%2Fprojects%2Fimages%2Ffinal.png' });
  });

  it('does not turn incidental operational-report paths into blank image cards', () => {
    const report = Array.from({ length: 16 }, (_, index) => `checkpoint ${index}: /Users/fixture/reports/capture-${index}.png remains archived`).join('\n');
    expect(messagesFromPayload({ messages: [{ role: 'assistant', content: report }] })[0]?.attachments).toBeUndefined();
    expect(messagesFromPayload({ messages: [{ role: 'assistant', content: '- /Users/fixture/reports/bullet.png\n`/Users/fixture/reports/code.png`\n```\n/Users/fixture/reports/fenced.png\n```' }] })[0]?.attachments).toBeUndefined();
  });

  it('keeps intentional whole-line legacy image paths ordered', () => {
    const [message] = messagesFromPayload({ messages: [{ role: 'assistant', content: '/Users/fixture/reports/one.png\n~/Downloads/two.jpg' }] });
    expect(message?.attachments?.map((attachment) => attachment.filename)).toEqual(['one.png', 'two.jpg']);
  });

  it.each([
    [{ lastInteractionAt: 100, lastActivityAt: 200 }, 200],
    [{ lastInteractionAt: 300, lastActivityAt: 200 }, 300],
    [{ lastActivityAt: 0 }, undefined],
    [{ lastInteractionAt: NaN, lastActivityAt: 200 }, 200],
    [{ lastInteractionAt: -1, lastActivityAt: Infinity }, 900],
    [{ metadata: { lastInteractionAt: 400 } }, 400],
    [{}, 900],
  ])('selects conversation activity independently of metadata updates: %j', (fields, expected) => {
    expect(projectsFromPayload({ sessions: [{ key: 'thread', updatedAt: 900, lastReadAt: 900, ...fields }] })[0]?.updatedAt).toBe(expected);
  });

  it('retains run identity and project activity metadata', () => {
    expect(messagesFromPayload({ messages: [{ role: 'assistant', runId: 'run-1', content: [{ type: 'text', text: 'done' }] }] })[0]).toMatchObject({ role: 'assistant', runId: 'run-1', source: 'history' });
    expect(projectsFromPayload({ sessions: [{ key: 'agent:main:one', label: 'one', group: 'home', updatedAt: 42 }] })[0]).toMatchObject({ group: 'home', updatedAt: 42, backendLabel: 'one' });
  });

  it.each(['Vimicate RN', 'Vimicate'])('does not promote the client fallback %s into explicit thread-label authority', (displayName) => {
    const [session] = projectsFromPayload({ sessions: [{
      key: 'agent:main:dashboard:emails',
      displayName,
      origin: { label: displayName, provider: 'webchat', surface: 'webchat' },
    }] });

    expect(session).toMatchObject({ name: displayName });
    expect(session).not.toHaveProperty('backendLabel');
  });

  it('renders the OpenClaw compaction control prompt as one neutral boundary', () => {
    const [message] = messagesFromPayload({ messages: [{
      id: 'compaction-control',
      role: 'user',
      timestamp: 1787821380000,
      content: 'Pre-compaction memory flush. Store durable memories only in memory/2026-08-27.md. Treat workspace bootstrap files as read-only. Current time: Thursday, August 27th, 2026.',
    }] });

    expect(message).toMatchObject({
      id: 'compaction-control',
      role: 'boundary',
      text: '--- compaction ---',
      timestamp: '1787821380000',
    });
  });

  it('restores embedded event chronology when Gateway appends delayed run records after newer steering prompts', () => {
    const messages = messagesFromPayload({ sessionKey: 'agent:main:r3cap', messages: [
      { id: 'prompt-1', role: 'user', timestamp: 1787764659052, content: 'edit the saved document' },
      { id: 'prompt-2', role: 'user', timestamp: 1787764680778, content: 'ask ccwork to check formatting' },
      { id: 'prompt-3', role: 'user', timestamp: 1787764692019, content: 'use ccwork where possible' },
      // These records were physically appended later by the Gateway, but the
      // embedded message timestamps retain when they were actually emitted.
      { id: 'preamble-1', role: 'assistant', timestamp: 1787764682155, content: "I'll update the saved DOCX." },
      { id: 'tool-1', role: 'toolResult', timestamp: 1787764682159, content: [{ type: 'toolResult', name: 'bash', text: 'instructions loaded' }] },
      { id: 'preamble-2', role: 'assistant', timestamp: 1787764696014, content: "I'll delegate the formatting review." },
    ] });

    expect(messages.map((message) => message.id)).toEqual([
      'prompt-1', 'prompt-2', 'preamble-1', 'tool-1', 'prompt-3', 'preamble-2',
    ]);
  });

  it('hides exact assistant sentinels in history while retaining ordinary NO and sentinel media', () => {
    const messages = messagesFromPayload({ messages: [
      { id: 'silent', role: 'assistant', content: 'NO_REPLY' },
      { id: 'ordinary', role: 'assistant', content: 'NO' },
      { id: 'media', role: 'assistant', content: [{ type: 'text', text: 'HEARTBEAT_OK' }, { type: 'image', mimeType: 'image/png', url: 'https://example.test/proof.png' }] },
    ] });
    expect(messages.map(({ id }) => id)).toEqual(['ordinary', 'media']);
    expect(messages[0]?.text).toBe('NO');
    expect(messages[1]).toMatchObject({ text: '', attachments: [{ uri: 'https://example.test/proof.png' }] });
  });

  it('removes Vimicate transport scaffolding from history user rows', () => {
    const [message] = messagesFromPayload({ messages: [{
      id: 'user-1', role: 'user', idempotencyKey: 'submission-1', content: 'Vimicate project context:\n- Project: notes\nUser prompt:\nwhat changed?',
    }] });
    expect(message).toMatchObject({ role: 'user', text: 'what changed?', idempotencyKey: 'submission-1' });
  });

  it('restores queued OpenClaw inputs that are not yet part of model history', () => {
    const messages = messagesFromPayload({
      sessionKey: 'agent:main:emails',
      messages: [{ id: 'prompt-1', role: 'user', timestamp: 1000, content: 'triage email' }],
      pendingInputs: { items: [
        { id: 'pending-1', runId: 'run-1', acceptedAt: 2000, state: 'queued', message: { role: 'user', idempotencyKey: 'submission-2', content: 'also check drafts' } },
        { id: 'pending-2', acceptedAt: 3000, state: 'interrupted', message: { role: 'user', content: 'do not replay this' } },
      ], total: 2 },
    });

    expect(messages.map(({ id }) => id)).toEqual(['prompt-1', 'pending-input:pending-1']);
    expect(messages[1]).toMatchObject({
      role: 'user', text: 'also check drafts', timestamp: '2000', source: 'history',
      sessionKey: 'agent:main:emails', runId: 'run-1', idempotencyKey: 'submission-2',
    });
  });

  it('projects canonical OpenClaw slash commands back into Vimicate colon commands', () => {
    const messages = messagesFromPayload({ messages: [
      { id: 'think', role: 'user', content: '/think high' },
      { id: 'reload', role: 'user', content: '/reload_projects now' },
      { id: 'path', role: 'user', content: '/Users/fixture/report.md' },
    ] });
    expect(messages.map((message) => message.text)).toEqual([':think high', ':reload-projects now', '/Users/fixture/report.md']);
  });

  it('projects Vimicate project roots with dashboard/direct threads and excludes unrelated session cards', () => {
    const projected = projectsFromPayload({ sessions: [
      { key: 'agent:main:direct:vimicate-ios:project:notes', displayName: 'Vimicate', updatedAt: 10, model: 'gpt-5.6-sol', modelProvider: 'openai', thinkingLevel: 'high', effectiveFastMode: true, totalTokens: 40000, contextTokens: 372000, estimatedCostUsd: 0.04, agentRuntime: { id: 'codex' } },
      { key: 'agent:main:dashboard:example-thread', label: 'example thread', parentSessionKey: 'agent:main:direct:vimicate-ios:project:notes', sessionId: '33333333-3333-4333-8333-333333333333', sessionStartedAt: 1787575888639, startedAt: 1787588900728, updatedAt: 12, hasActiveRun: true },
      { key: 'agent:main:direct:vimicate-ios:project:notes:thread:supervising', updatedAt: 8 },
      { key: 'agent:main:discord:channel:123', updatedAt: 20 },
      { key: 'agent:main:subagent:worker', parentSessionKey: 'agent:main:direct:vimicate-ios:project:notes' },
    ] });
    expect(projected.map((entry) => entry.name)).toEqual(['notes', 'example thread', 'supervising']);
    expect(projected[0]).toMatchObject({ kind: 'project', threadCount: 3, model: 'gpt-5.6-sol', agentRuntime: 'codex', thinkingLevel: 'high', fastMode: true, totalTokens: 40000, contextTokens: 372000, estimatedCostUsd: 0.04 });
    expect(projected[1]).toMatchObject({ kind: 'thread', rootSessionKey: projected[0]?.sessionKey, projectName: 'notes', state: 'running', sessionId: '33333333-3333-4333-8333-333333333333', sessionStartedAtMs: 1787575888639, backendLabel: 'example thread' });
  });

  it('never adopts leaked smoke or Vimicate control sessions as project threads', () => {
    const rootKey = 'agent:main:direct:vimicate-ios';
    const projected = projectsFromPayload({ sessions: [
      { key: rootKey, label: 'vimicate' },
      { key: 'agent:thread:visible-background-run-smoke', label: 'Visible background run', parentSessionKey: rootKey },
      { key: 'agent:main:dashboard:control', label: 'vimicate control DEADBEEF', parentSessionKey: rootKey },
      { key: 'agent:main:dashboard:real', label: 'real thread', parentSessionKey: rootKey },
    ] });
    expect(projected.map((entry) => entry.name)).toEqual(['vimicate', 'real thread']);
  });
});
