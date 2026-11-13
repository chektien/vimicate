import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { buildVisibleTranscriptRenderRows } from '../transcript/transcriptVisibleRows';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';

const sessionKey = 'route';
const transcriptSessionId = '11111111-1111-4111-8111-111111111111';
const runId = 'request';
const scope = { sessionKey, transcriptSessionId, runId, timestamp: '1000' };
const rawDetail = 'Your request could not be completed.\nProtected Codex continuation requires a parent-local inference relay.\n  Diagnostic spacing stays intact.  ';
const legacy = (overrides: Partial<WorkspaceMessage> = {}): WorkspaceMessage => ({
  id: 'typed-marker', role: 'system', source: 'history', text: rawDetail, ...scope, ...overrides,
});

describe('persisted notice projection migration', () => {
  it('marks legacy custom/error projections as inert cached detail without claiming delivery or current failure', () => {
    for (const role of ['system', 'error'] as const) {
      const [restored] = parsedTranscriptCache(JSON.stringify([legacy({ role, state: 'error' })]));
      expect(restored).toMatchObject({ id: 'typed-marker', role: 'system', cachedNotice: true, ...scope });
      expect(restored?.state).toBeUndefined();
      const [headline, detail] = restored!.text.split('\nTechnical details\n');
      expect(headline).toContain('Cached notice, not current status');
      expect(headline).toContain('Refresh');
      expect(headline).not.toMatch(/Message saved|Run failed|will run|retry/i);
      expect(detail).toBe(rawDetail);
      const [visible] = buildVisibleTranscriptRenderRows([restored!], new Set());
      expect(visible?.compiled.source).toContain(headline);
      expect(visible?.compiled.source).not.toContain('parent-local');
    }
  });

  it('preserves authored prompts, uncertain local custody, live fragments and ordinary tool activity', () => {
    const rows = [
      legacy({ id: 'authored', role: 'user' }),
      legacy({ id: 'local', role: 'user', source: 'local', idempotencyKey: 'outbound' }),
      legacy({ id: 'partial', role: 'assistant', source: 'live' }),
      legacy({ id: 'tool', role: 'tool', tool: { name: 'exec', summary: 'Read a file' } }),
      legacy({ id: 'local-error', role: 'error', source: 'local', state: 'error' }),
      legacy({ id: 'other-live-error', role: 'error', source: 'live', state: 'error' }),
    ];
    expect(parsedTranscriptCache(JSON.stringify(rows))).toEqual(rows);
  });

  it('migrates only exact client-owned live failure identities, never a prefix or foreign scope', () => {
    const snapshotID = `session-failure:${JSON.stringify([sessionKey, transcriptSessionId, runId])}`;
    for (const id of [snapshotID, `live-run-${runId}`, `live-chat-${runId}`]) {
      const [restored] = parsedTranscriptCache(JSON.stringify([legacy({ id, role: 'error', state: 'error', source: 'live' })]));
      expect(restored).toMatchObject({ id, role: 'system', cachedNotice: true });
      expect(restored?.text.endsWith(rawDetail)).toBe(true);
    }
    for (const id of [`${snapshotID}:lookalike`, `session-failure:${JSON.stringify(['foreign', transcriptSessionId, runId])}`, `live-run-${runId}-other`]) {
      const row = legacy({ id, role: 'error', state: 'error', source: 'live' });
      expect(parsedTranscriptCache(JSON.stringify([row]))).toEqual([row]);
    }
  });

  it('versions new cache projections and does not downgrade their existing actionable notice', () => {
    const current = legacy({ role: 'error', state: 'error', text: 'Message saved. Refresh to check the response.\nTechnical details\nA fixture failure.' });
    const payload = serializedTranscriptCache([current]);
    expect(JSON.parse(payload)).toMatchObject({ version: 1, messages: [current] });
    expect(parsedTranscriptCache(payload)).toEqual([current]);
  });

  it('retains the stale marker and exact detail through subsequent saves without nested wrapping', () => {
    const first = parsedTranscriptCache(JSON.stringify([legacy()]));
    expect(first[0]).toHaveProperty('cachedNotice', true);
    const second = parsedTranscriptCache(serializedTranscriptCache(first));
    expect(second).toEqual(first);
    expect(second[0]?.text.split('Cached notice, not current status')).toHaveLength(2);
    expect(second[0]?.text.endsWith(rawDetail)).toBe(true);
  });

  it('does not truncate old diagnostic bytes just because migration adds a presentation envelope', () => {
    const detail = 'd'.repeat(64_000);
    const first = parsedTranscriptCache(JSON.stringify([legacy({ text: detail })]));
    const second = parsedTranscriptCache(serializedTranscriptCache(first));
    expect(second[0]?.text).toBe(first[0]?.text);
    expect(second[0]?.text.split('\nTechnical details\n')[1]).toBe(detail);
  });

  it('does not preserve a stale-marker flag on authored text or an incomplete generated envelope', () => {
    for (const row of [legacy({ role: 'user' }), legacy({ text: 'Cached notice, not current status. A lookalike.' })]) {
      const payload = JSON.stringify({ version: 1, messages: [{ ...row, cachedNotice: true }] });
      expect(parsedTranscriptCache(payload)).toEqual([row]);
    }
  });

  it.each(['before-reply', 'runtime', 'snapshot'] as const)('retains scoped typed %s failure provenance through current-cache restoration', runFailure => {
    const row = legacy({ role: 'error', state: 'error', runFailure });
    expect(parsedTranscriptCache(serializedTranscriptCache([row]))).toEqual([row]);
    for (const invalid of [{ role: 'user' }, { runId: '' }, { sessionKey: '' }, { runFailure: 'authored-lookalike' }]) {
      const payload = JSON.stringify({ version: 1, messages: [{ ...row, ...invalid }] });
      expect(parsedTranscriptCache(payload)[0]?.runFailure).toBeUndefined();
    }
  });

  it('restores server queue custody as unknown until a fresh authoritative read', () => {
    const row: WorkspaceMessage = { id: 'pending-input:custody', role: 'user', source: 'history', text: 'A queued question', ...scope,
      inputAcceptedAtMs: 1000, inputReceiptRunId: runId, inputQueueState: 'queued' };
    const payload = serializedTranscriptCache([row]);
    expect(JSON.parse(payload).messages[0].inputQueueState).toBe('queued');
    const restored = parsedTranscriptCache(payload)[0];
    expect(restored).toMatchObject({ ...row, inputQueueState: 'unknown' });
    expect(parsedTranscriptCache(serializedTranscriptCache([restored!]))[0]?.inputQueueState).toBe('unknown');
    for (const invalid of [{ role: 'assistant' }, { id: 'authored' }, { transcriptSessionId: '' }, { inputReceiptRunId: 'other' }, { inputQueueState: 'consumed' }]) {
      const invalidPayload = JSON.stringify({ version: 1, messages: [{ ...row, ...invalid }] });
      expect(parsedTranscriptCache(invalidPayload)[0]?.inputQueueState).toBeUndefined();
    }
  });

  it.each([{ version: 2, messages: [legacy()] }, { version: 1, messages: null }, { messages: [legacy()] }])('does not treat an unknown or malformed envelope as current projection authority', payload => {
    expect(parsedTranscriptCache(JSON.stringify(payload))).toEqual([]);
  });
});
