import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { canonicalQueuedPromptEvent, canonicalQueuedPromptWireRows } from './queuedPromptConsumption';

const scope = { sessionKey: 'route', sessionId: 'generation', runId: 'operation:followup' };
const canonical: WorkspaceMessage = { id: 'canonical', role: 'user', source: 'history', text: 'not an identity',
  sessionKey: scope.sessionKey, transcriptSessionId: scope.sessionId, idempotencyKey: `${scope.runId}:user`,
  displayPosition: { source: 'sqlite', rawSeq: 23789 } };

describe('canonical queued-prompt consumption identity', () => {
  it('requires one unique committed input, never an execution run or textual match', () => {
    expect(canonicalQueuedPromptEvent([canonical], scope)).toBe('canonical');
    expect(canonicalQueuedPromptEvent([canonical, { ...canonical, text: 'a richer rendering' }], scope)).toBe('canonical');
    expect(canonicalQueuedPromptEvent([canonical, { ...canonical, id: 'another-claim' }], scope)).toBeUndefined();
    expect(canonicalQueuedPromptEvent([{ ...canonical, text: 'completely different' }], scope)).toBe('canonical');
    for (const change of [
      { role: 'assistant' as const }, { source: 'local' as const }, { source: 'live' as const },
      { sessionKey: 'other' }, { transcriptSessionId: 'other' }, { transcriptSessionId: undefined },
      { id: 'pending-input:copied-metadata' }, { id: '' }, { id: 'x'.repeat(513) },
      { idempotencyKey: scope.runId }, { idempotencyKey: `${scope.runId}:assistant` },
      { idempotencyKey: `${scope.runId}:user:user` }, { idempotencyKey: `${scope.runId}:USER` },
      { idempotencyKey: 'different:user', runId: scope.runId }, { displayPosition: undefined },
      { displayPosition: { source: 'sqlite', rawSeq: -1 } }, { state: 'streaming' as const },
      { state: 'error' as const }, { recovery: { sourceMessageId: 'canonical', state: 'available' as const } },
    ]) expect(canonicalQueuedPromptEvent([{ ...canonical, ...change } as WorkspaceMessage], scope)).toBeUndefined();
  });

  it('bounds the inspected snapshot and requires explicit concrete scope', () => {
    expect(canonicalQueuedPromptEvent(Array(4097).fill(canonical), scope)).toBeUndefined();
    expect(canonicalQueuedPromptEvent([canonical], { ...scope, sessionId: '' })).toBeUndefined();
    expect(canonicalQueuedPromptEvent([canonical], { ...scope, runId: '' })).toBeUndefined();
  });

  it('projects only current page identity metadata without parsing or retaining user content', () => {
    const wire = { role: 'user', content: 'private input must not become retained helper text',
      __openclaw: { id: canonical.id, idempotencyKey: canonical.idempotencyKey, transcriptPosition: canonical.displayPosition } };
    const rows = canonicalQueuedPromptWireRows({ sessionKey: scope.sessionKey, sessionId: scope.sessionId, messages: [wire] });
    expect(canonicalQueuedPromptEvent(rows, scope)).toBe(canonical.id);
    expect(rows[0]?.text).toBe('');
    for (const messages of [[null], [{ ...wire, state: 'error' }], [{ ...wire, role: 'assistant' }], Array(4097).fill(wire)]) {
      expect(canonicalQueuedPromptWireRows({ ...scope, messages })).toEqual([]);
    }
  });
});
