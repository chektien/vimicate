import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';

describe('persistent transcript cache', () => {
  it('does not persist a process-owned full-message loading lock and repairs legacy cached locks', () => {
    const row: WorkspaceMessage = { id: 'row', role: 'assistant', text: 'partial...(truncated)...', source: 'history', sessionKey: 'one', recovery: { sourceMessageId: 'source', state: 'loading', detail: 'loading full response…' } };
    const payload = serializedTranscriptCache([row]);
    expect(JSON.parse(payload)[0].recovery).toEqual({ sourceMessageId: 'source', state: 'available' });
    expect(parsedTranscriptCache(JSON.stringify([row]))[0]?.recovery).toEqual({ sourceMessageId: 'source', state: 'available' });
    expect(row.recovery?.state).toBe('loading');
  });

  it.each(['available', 'failed', 'unavailable', 'recovered'] as const)('retains durable %s recovery state and detail', (state) => {
    const row: WorkspaceMessage = { id: 'row', role: 'assistant', text: 'answer', source: 'history', recovery: { sourceMessageId: 'source', state, detail: 'detail' } };
    expect(parsedTranscriptCache(serializedTranscriptCache([row]))[0]?.recovery).toEqual(row.recovery);
  });

  it('round trips presentation rows without persisting Gateway credentials or pending approvals', () => {
    const message: WorkspaceMessage = {
      id: 'one', role: 'assistant', text: 'hello', sessionKey: 'thread', source: 'history', state: 'streaming',
      attachments: [{ id: 'image', filename: 'one.png', mimeType: 'image/png', uri: '/__openclaw__/assistant-media?source=one', headers: { Authorization: 'Bearer secret' } }],
      approval: { id: 'approval', kind: 'exec', allowedDecisions: ['allow-once'], resolved: false },
    };
    const payload = serializedTranscriptCache([message]);
    expect(payload).not.toContain('secret'); expect(payload).not.toContain('approval');
    expect(parsedTranscriptCache(payload)).toEqual([{ id: 'one', role: 'assistant', text: 'hello', sessionKey: 'thread', source: 'history', attachments: [{ id: 'image', filename: 'one.png', mimeType: 'image/png', uri: '/__openclaw__/assistant-media?source=one' }] }]);
  });

  it('retains scoped artifact identity and geometry without retaining credentials', () => {
    const attachment = { id: 'image', filename: 'generated.png', mimeType: 'image/png',
      uri: '/api/chat/media/outgoing/thread/media/full', artifactId: 'artifact_managed_image_fixture',
      artifactSessionKey: 'thread', pixelWidth: 1920, pixelHeight: 819, byteCount: 1024 };
    const payload = serializedTranscriptCache([{ id: 'delivery', role: 'assistant', text: '',
      attachments: [{ ...attachment, headers: { Authorization: 'Bearer fixture' } }] }]);
    expect(payload).not.toContain('Bearer fixture');
    expect(parsedTranscriptCache(payload)[0]?.attachments).toEqual([attachment]);
  });

  it('rejects malformed rows and bounds the retained tail', () => {
    const messages = Array.from({ length: 450 }, (_, index): WorkspaceMessage => ({ id: String(index), role: 'assistant', text: `row ${index}` }));
    const restored = parsedTranscriptCache(serializedTranscriptCache(messages));
    expect(restored).toHaveLength(200); expect(restored[0]?.id).toBe('250'); expect(restored.at(-1)?.id).toBe('449');
    expect(parsedTranscriptCache('[{"id":1,"role":"assistant","text":"bad"}]')).toEqual([]);
  });

  it('drops stale image cards from folded tool output', () => {
    const tool: WorkspaceMessage = {
      id: 'tool', role: 'tool', text: '![source](../images/source.png)',
      attachments: [{ id: 'false-card', filename: 'source', mimeType: 'image/png', uri: '/__openclaw__/assistant-media?source=source.png' }],
    };
    expect(parsedTranscriptCache(serializedTranscriptCache([tool]))).toEqual([{ id: 'tool', role: 'tool', text: tool.text }]);
    expect(parsedTranscriptCache(JSON.stringify([{ ...tool }]))).toEqual([{ id: 'tool', role: 'tool', text: tool.text }]);
  });

  it('serializes the same bounded projection deterministically', () => {
    const messages: WorkspaceMessage[] = Array.from({ length: 420 }, (_, index) => ({
      id: `row-${index}`,
      role: index % 2 ? 'assistant' : 'tool',
      text: `payload ${index}`,
      sessionKey: 'thread-a',
      source: 'history',
      ...(index % 2 ? { attachments: [{ id: `image-${index}`, filename: `${index}.png`, mimeType: 'image/png', uri: `file:///tmp/${index}.png` }] } : {}),
    }));
    const first = serializedTranscriptCache(messages);
    const second = serializedTranscriptCache(messages.map((message) => ({ ...message })));
    expect(second).toBe(first);
    expect(parsedTranscriptCache(first)).toHaveLength(200);
  });

  it('repairs timestamped history rows persisted in delayed append order', () => {
    const cached = JSON.stringify([
      { id: 'prompt-1', role: 'user', text: 'first', source: 'history', timestamp: '1000' },
      { id: 'prompt-2', role: 'user', text: 'second', source: 'history', timestamp: '3000' },
      { id: 'preamble-1', role: 'assistant', text: 'working', source: 'history', timestamp: '2000' },
    ]);

    expect(parsedTranscriptCache(cached).map((message) => message.id)).toEqual([
      'prompt-1', 'preamble-1', 'prompt-2',
    ]);
  });

  it('retains an uncertain offline live answer until canonical history can place or reject it', () => {
    const cached = JSON.stringify([
      { id: 'old-prompt', role: 'user', text: 'prepare brief', source: 'history', timestamp: '1000' },
      { id: 'old-answer', role: 'assistant', text: 'brief ready', source: 'history', timestamp: '2000' },
      { id: 'latest-prompt', role: 'user', text: 'update standup', source: 'history', timestamp: '3000' },
      { id: 'latest-answer', role: 'assistant', text: 'Updated standup.md', source: 'history', timestamp: '4000' },
      { id: 'stale-live', role: 'assistant', text: '[Morning brief] stale duplicate', source: 'live', runId: 'lost-run', state: 'complete' },
    ]);

    expect(parsedTranscriptCache(cached).map((message) => message.id)).toEqual([
      'old-prompt', 'old-answer', 'latest-prompt', 'latest-answer', 'stale-live',
    ]);
  });
});

it('retires a completed Claude cumulative copy on cache-only restore before any history merge', () => {
  const sessionKey = 's';
  const transcriptSessionId = '11111111-1111-4111-8111-111111111111';
  const cliSessionId = '22222222-2222-4222-8222-222222222222';
  const native = (id: string, role: WorkspaceMessage['role'], text: string, timestamp: string): WorkspaceMessage => ({
    id, role, text, timestamp, source: 'history', sessionKey, transcriptSessionId, state: 'complete',
    cliProvenance: { kind: 'claude-native', sessionId: cliSessionId, externalId: id },
  });
  const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'request', source: 'history', sessionKey,
    transcriptSessionId, idempotencyKey: 'submission:user', timestamp: '1000', displayPosition: { source: 'sqlite', rawSeq: 1 } };
  const prior = native('prior', 'assistant', 'Prior answer.', '1400');
  const step = native('step', 'narration', 'Checking.', '2000');
  const answer = native('answer', 'assistant', 'Done.', '2200');
  const footer: WorkspaceMessage = { id: 'history-run-answer', role: 'run', text: '✓ done in 1s', source: 'history',
    sessionKey, transcriptSessionId, timestamp: '2200', state: 'complete' };
  const live: WorkspaceMessage = { id: 'live-chat-r', runId: 'r', role: 'assistant', text: 'Checking.\n\nDone.',
    source: 'live', sessionKey, transcriptSessionId, timestamp: '2000', state: 'complete' };
  const payload = serializedTranscriptCache([prompt, prior, step, answer, footer, live]);
  expect(JSON.parse(payload).some((row: WorkspaceMessage) => row.id === live.id)).toBe(true);
  const restored = parsedTranscriptCache(payload);
  expect(restored.map(row => row.id)).toEqual(['prompt', 'prior', 'step', 'answer', 'history-run-answer']);
  expect(restored.find(row => row.id === answer.id)?.text).toBe('Done.');
});
