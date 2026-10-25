import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { sameTranscriptPublication } from './transcriptPublicationEquality';

const sessionKey = 'one';
const prompt: WorkspaceMessage = {
  id: 'canonical-prompt', role: 'user', text: 'Review the latest file.',
  source: 'history', sessionKey, idempotencyKey: 'request:user', timestamp: '1700000001000',
};
const partial: WorkspaceMessage = {
  id: 'canonical-answer', role: 'assistant', text: 'Draft',
  source: 'history', sessionKey, idempotencyKey: 'mirror:assistant', timestamp: '1700000004000',
};
const delta = projectGatewayEvent({ event: 'chat', payload: {
  sessionKey, runId: 'run-one', state: 'delta',
  message: { content: 'Draft', timestamp: 1700000003500 },
} }, sessionKey)!.message;
const assistants = (rows: WorkspaceMessage[]) => rows.filter((row) => row.role === 'assistant');

describe('streaming assistant handoff to a lagging canonical page', () => {
  it.each(['streaming', 'complete', 'error'] as const)('keeps a longer explicit-run prefix only until canonical %s authority', (state) => {
    const local: WorkspaceMessage = { id: 'local-p', role: 'user', source: 'local', text: 'review',
      sessionKey: 's', runId: 'r', idempotencyKey: 'r', timestamp: '1788265860000' };
    const canonical: WorkspaceMessage = { id: 'a', role: 'assistant', source: 'history', text: 'Draft',
      sessionKey: 's', runId: 'r', idempotencyKey: 'r:assistant', timestamp: '1788265861000', state };
    const growing: WorkspaceMessage = { id: 'live-chat-r', role: 'assistant', source: 'live', text: 'Draft continues in detail',
      sessionKey: 's', runId: 'r', timestamp: '1788265861000', state: 'streaming' };
    const rows = mergeLatestHistory([{ ...local, source: 'history' }, canonical], [local, growing], 's');
    expect(assistants(rows)).toEqual([expect.objectContaining(state === 'streaming'
      ? { id: growing.id, text: growing.text, source: 'live', state: 'streaming' }
      : { id: canonical.id, text: canonical.text, source: 'history', state })]);
  });

  it('keeps the live identity and growing body through repeated raw prefix refreshes', () => {
    let rows = [prompt, delta];
    let text = delta.text;
    for (let index = 0; index < 40; index += 1) {
      const before = rows;
      rows = mergeLatestHistory([prompt, { ...partial, text: index % 2 ? text : partial.text }], rows, sessionKey);
      expect(assistants(rows)).toEqual([expect.objectContaining({ id: delta.id, text, source: 'live', state: 'streaming' })]);
      expect(sameTranscriptPublication(before, rows)).toBe(true);
      expect(rows.at(-1)?.absorbedLiveIdentity).toBeUndefined();
      text += ` section-${index}`;
      rows = upsertLiveMessage(rows, { ...delta, text });
      expect(assistants(rows)).toHaveLength(1);
    }
  });

  it('hands off once the final arrives, then keeps later replay single', () => {
    let rows = mergeLatestHistory([prompt, partial], [prompt, delta], sessionKey);
    // Final snapshots may legitimately replace rather than extend the draft.
    const liveFinal = { ...delta, text: 'The review is complete.', state: 'complete' as const };
    rows = upsertLiveMessage(rows, liveFinal);
    const canonicalFinal = { ...partial, text: liveFinal.text };
    rows = mergeLatestHistory([prompt, canonicalFinal], rows, sessionKey);
    expect(assistants(rows)).toEqual([expect.objectContaining({
      id: partial.id, text: liveFinal.text, source: 'history', state: 'complete',
      absorbedLiveIdentity: { messageId: delta.id, runId: delta.runId },
    })]);
    expect(assistants(upsertLiveMessage(rows, liveFinal))).toHaveLength(1);
  });

  it('preserves the active media snapshot while canonical history is behind', () => {
    const attachments = [{ id: 'new-image', filename: 'new.png', mimeType: 'image/png', uri: 'https://example.test/new.png' }];
    const growing = { ...delta, text: 'Draft continues', attachments };
    const rows = mergeLatestHistory([prompt, partial], [prompt, growing], sessionKey);
    expect(assistants(rows)).toEqual([growing]);
    const cleared = upsertLiveMessage(rows, { ...growing, attachments: [] });
    expect(assistants(mergeLatestHistory([prompt, partial], cleared, sessionKey))[0]?.attachments).toBeUndefined();
  });

  it.each(['complete', 'error'] as const)('does not defer explicit canonical %s authority', (state) => {
    const canonical = { ...partial, state };
    const rows = mergeLatestHistory([prompt, canonical], [prompt, { ...delta, text: 'Draft continues' }], sessionKey);
    expect(assistants(rows)).toEqual([expect.objectContaining({ id: canonical.id, text: canonical.text, source: 'history', state })]);
  });

  it('does not suppress an equal reply from a different prompt', () => {
    const anotherPrompt = { ...prompt, id: 'other-prompt', idempotencyKey: 'other:user', timestamp: '1700000005000' };
    const laterDelta = { ...delta, timestamp: '1700000006000' };
    const rows = mergeLatestHistory([prompt, partial, anotherPrompt], [prompt, partial, anotherPrompt, laterDelta], sessionKey);
    expect(assistants(rows).map((row) => row.id)).toEqual([partial.id, delta.id]);
  });

  it('does not collapse two explicit canonical replies into the one active row', () => {
    const second = { ...partial, id: 'separate-answer', idempotencyKey: 'separate:assistant' };
    const rows = mergeLatestHistory([prompt, partial, second], [prompt, delta], sessionKey);
    expect(assistants(rows)).toHaveLength(2);
    expect(assistants(rows).some((row) => row.id === second.id)).toBe(true);
  });
});
