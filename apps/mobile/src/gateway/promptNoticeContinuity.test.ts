import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { mergeLatestHistory, mergeOlderHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { sessionFailureNotice } from './sessionFailureNotice';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { reconcileRunFailureNotices } from './runFailureConvergence';
import { reconcileFailedRunWait } from './runWaitSettlement';

const key = 'synthetic:notice'; const generation = '11111111-1111-4111-8111-111111111111';
const otherGeneration = '22222222-2222-4222-8222-222222222222'; const runId = 'attempt';
const detail = 'Protected Codex continuation requires a current parent-local inference relay; the native thread is claimed by active work.';
const payload = { sessionKey: key, sessionId: generation, messages: [
  { id: 'prompt', role: 'user', content: 'How long did it take?', idempotencyKey: `${runId}:user` },
  { id: 'failure', role: 'custom', customType: 'run-failed-before-reply', openclawRunError: { runId, summary: detail } },
] };
const fresh = () => messagesFromPayload(payload);
const snapshot = () => sessionFailureNotice({ key, sessionId: generation, status: 'failed', lastRunId: runId, lastRunError: detail })!;

describe('prompt notice continuity across history and live boundaries', () => {
  for (const [name, merge] of [['latest', mergeLatestHistory], ['older', mergeOlderHistory]] as const) {
    it(`${name} refresh replaces the exact cached record and retires its neutral cached mirror`, () => {
      const old = fresh().map(row => row.id === 'failure' ? { ...row, role: 'system' as const, runFailure: undefined, text: 'Your request could not be completed.', state: 'error' as const } : row);
      const restored = parsedTranscriptCache(JSON.stringify([...old, snapshot()]));
      const rows = merge(fresh(), restored, key);
      expect(rows.filter(row => row.runId === runId && row.role !== 'user')).toHaveLength(1);
      expect(rows.find(row => row.id === 'failure')).toMatchObject({ role: 'error', runFailure: 'before-reply' });
      expect(rows.find(row => row.id === 'failure')?.text).toContain('Message saved.');
      expect(rows.some(row => row.cachedNotice)).toBe(false);
      expect(merge(fresh(), rows, key)).toEqual(rows);
    });

    it(`${name} refresh owns corrected record bytes even when an old projection scores higher`, () => {
      const { runFailure: _kind, ...old } = fresh()[1]!;
      const stale: WorkspaceMessage = { ...old, role: 'assistant', text: 'x'.repeat(500), state: 'complete' };
      const rows = merge(fresh(), [stale], key);
      expect(rows.find(row => row.id === 'failure')).toMatchObject({ role: 'error', text: fresh()[1]!.text });
    });

    it(`${name} refresh retires an initially unscoped snapshot after census enriches its generation`, () => {
      const unscoped = sessionFailureNotice({ key, status: 'failed', lastRunId: runId, lastRunError: detail })!;
      const enriched = upsertLiveMessage([unscoped], snapshot());
      expect(enriched[0]).toMatchObject({ id: unscoped.id, transcriptSessionId: generation });
      expect(merge(fresh(), enriched, key)).toEqual(fresh());
      // Pre-version caches keep the same generated ID after enrichment.
      const restored = parsedTranscriptCache(JSON.stringify(enriched));
      expect(restored[0]).toMatchObject({ role: 'system', cachedNotice: true });
      expect(merge(fresh(), restored, key)).toEqual(fresh());
    });
  }

  it('ignores repeated late snapshot and chat failure mirrors after the saved typed failure arrives', () => {
    let rows = parsedTranscriptCache(serializedTranscriptCache(fresh()));
    const live = projectGatewayEvent({ type: 'event', event: 'chat', payload: { sessionKey: key, sessionId: generation, runId, state: 'error', errorMessage: detail } }, key)!.message;
    for (const mirror of [snapshot(), live, snapshot(), live]) rows = upsertLiveMessage(rows, mirror);
    expect(rows).toEqual(fresh());
  });

  it('converges real wait failures in both event orders and does not re-add them on repeated settlement', () => {
    const settle = (rows: WorkspaceMessage[]) => reconcileFailedRunWait(rows, key, runId, { status: 'error', error: detail }, 1000);
    const first = settle([]);
    expect(first[0]).toMatchObject({ runFailure: 'runtime', id: `live-run-${runId}` });
    const rows = mergeLatestHistory(fresh(), first, key);
    expect(rows).toEqual(fresh()); expect(settle(rows)).toEqual(rows); expect(settle(settle(rows))).toEqual(rows);
  });

  it('preserves the concrete generation on real agent-stream errors before convergence', () => {
    const error = (sessionId: string) => projectGatewayEvent({ event: 'agent', payload: {
      sessionKey: key, sessionId, runId, stream: 'error', seq: 1, data: { reason: detail },
    } }, key)!.message;
    expect(error(otherGeneration).transcriptSessionId).toBe(otherGeneration);
    expect(upsertLiveMessage(fresh(), error(otherGeneration))).toHaveLength(3);
    expect(upsertLiveMessage(fresh(), error(generation))).toEqual(fresh());
  });

  it('never collapses unrelated errors, tool activity, foreign routes or conflicting generations', () => {
    const base = snapshot();
    const { runFailure: _kind, ...authored } = base;
    const others: WorkspaceMessage[] = [
      { ...authored, id: 'authored-error' },
      { ...base, id: 'tool', role: 'tool' },
      { ...base, sessionKey: 'foreign' },
      { ...base, transcriptSessionId: otherGeneration },
      { ...base, id: `${base.id}:lookalike` },
    ];
    expect(reconcileRunFailureNotices([...fresh(), ...others])).toEqual([...fresh(), ...others]);
    const { transcriptSessionId: _generation, ...unscopedBase } = base;
    const unscoped = { ...unscopedBase, id: `live-chat-${runId}`, runFailure: 'runtime' as const };
    const ambiguous = [...fresh(), { ...fresh()[1]!, id: 'second-generation', transcriptSessionId: otherGeneration }, unscoped];
    expect(reconcileRunFailureNotices(ambiguous)).toEqual(ambiguous);
  });
});
