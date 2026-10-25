import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { coalesceTranscriptIdentities, transcriptPublicationIdentity } from './transcriptIdentityWall';

const message = (id: string, text: string, overrides: Partial<WorkspaceMessage> = {}): WorkspaceMessage => ({ id, role: 'assistant', text, source: 'live', state: 'streaming', ...overrides });

function transcriptIdentitiesAreUnique(messages: WorkspaceMessage[]) {
  return new Set(messages.map(row => row.id)).size === messages.length
    && new Set(messages.map(transcriptPublicationIdentity)).size === messages.length;
}

describe('central transcript identity wall', () => {
  it('retires the exact retained Claude pending alias before an answer exists, without invented run metadata', () => {
    const canonical: WorkspaceMessage = { id: 'canonical-input', role: 'user', source: 'history', text: 'One input',
      sessionKey: 'route', transcriptSessionId: 'generation', idempotencyKey: 'followup:user', timestamp: '100',
      displayPosition: { source: 'sqlite', rawSeq: 23789 },
      cliProvenance: { kind: 'claude-native', sessionId: '00000000-0000-4000-b000-000000000113', externalId: 'native-input' } };
    const pending: WorkspaceMessage = { id: 'pending-input:custody', role: 'user', source: 'history', text: 'One input',
      sessionKey: 'route', transcriptSessionId: 'generation', runId: 'followup', inputReceiptRunId: 'followup',
      timestamp: '100', inputAcceptedAtMs: 100 };
    expect(coalesceTranscriptIdentities([pending, canonical])).toEqual([canonical]);
    expect(coalesceTranscriptIdentities([canonical, pending])).toEqual([canonical]);
    for (const change of [{ transcriptSessionId: 'other' }, { sessionKey: 'other' },
      { idempotencyKey: 'other:user' }, { idempotencyKey: 'followup:assistant' },
      { id: 'pending-input:fake' }, { timestamp: '101' }, { displayPosition: undefined },
      { cliProvenance: undefined }, { state: 'error' as const }]) {
      expect(coalesceTranscriptIdentities([pending, { ...canonical, ...change } as WorkspaceMessage])).toHaveLength(2);
    }
  });
  it('retains message identity when durable narration adds a stronger identity', () => {
    const live = message('live-item-run-pre', 'checking', { role: 'narration', runId: 'run', sessionKey: 'session' });
    const durable = { ...live, source: 'history' as const, state: 'complete' as const,
      transcriptSessionId: 'generation', narrationItemId: 'pre' };
    expect(transcriptIdentitiesAreUnique([live, durable])).toBe(false);
    for (const rows of [[live, durable], [durable, live]]) {
      const merged = coalesceTranscriptIdentities(rows);
      expect(merged).toEqual([durable]);
      expect(coalesceTranscriptIdentities([...merged, live])).toEqual([durable]);
    }
  });

  it('joins message aliases before coalescing their durable identity', () => {
    const live = message('live-item-run-pre', 'checking', { role: 'narration', runId: 'run', sessionKey: 'session' });
    const durable = { ...live, source: 'history' as const, state: 'complete' as const,
      transcriptSessionId: 'generation', narrationItemId: 'pre' };
    const native = { ...durable, id: 'native-preamble' };
    const merged = coalesceTranscriptIdentities([live, native, durable]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(durable);
    expect(coalesceTranscriptIdentities(merged)).toBe(merged);
  });

  it('retains exact locally authored command text when canonical metadata wins', () => {
    const local = message('local-command', ':Think high', { source: 'local', role: 'user', idempotencyKey: 'command-1' });
    const canonical = message('history-command', ':think high', { source: 'history', role: 'user', idempotencyKey: 'command-1:user', timestamp: 'canonical-time' });
    expect(coalesceTranscriptIdentities([canonical, local])).toEqual([{ ...canonical, text: ':Think high' }]);
  });

  it('publishes one row for an exact identity while preserving its first position', () => {
    const result = coalesceTranscriptIdentities([
      message('same', 'partial'), message('middle', 'other'), message('same', 'complete answer', { source: 'history', state: 'complete' }),
    ]);
    expect(result.map((row) => row.id)).toEqual(['same', 'middle']);
    expect(result[0]).toMatchObject({ text: 'complete answer', source: 'history', state: 'complete' });
    expect(transcriptIdentitiesAreUnique(result)).toBe(true);
  });

  it('retains a fuller recovered assistant over a clipped canonical copy', () => {
    const recovered = message('same', 'the complete recovered answer', { recovery: { sourceMessageId: 'same', state: 'recovered' } });
    const clipped = message('same', 'short… (truncated)', { source: 'history', state: 'complete', recovery: { sourceMessageId: 'same', state: 'available' } });
    expect(coalesceTranscriptIdentities([recovered, clipped])[0]).toMatchObject({ text: 'the complete recovered answer', recovery: { state: 'recovered' }, state: 'complete' });
  });

  it('does not regress terminal tool evidence to a later streaming duplicate', () => {
    const complete = message('tool', 'result', { role: 'tool', state: 'complete', tool: { name: 'bash', summary: 'checked health' } });
    const streaming = message('tool', 'raw', { role: 'tool', state: 'streaming', tool: { name: 'bash', summary: 'bash' } });
    expect(coalesceTranscriptIdentities([complete, streaming])[0]).toMatchObject({ state: 'complete', tool: { summary: 'checked health' } });
  });

  it('never deduplicates distinct turns merely because their text is identical', () => {
    const rows = coalesceTranscriptIdentities([message('one', 'repeat'), message('two', 'repeat')]);
    expect(rows).toHaveLength(2);
  });

  it('retires only a uniquely proven Codex pending-input custody alias', () => {
    const acceptedAt = 1789815458637;
    const route = 'agent:main:direct:vimicate-ios';
    const generation = '00000000-0000-4000-8000-000000000106';
    const runId = '00000000-0000-4000-b000-000000000104';
    const canonical: WorkspaceMessage = {
      id: 'canonical', text: 'and summarize progress', role: 'user', source: 'history', sessionKey: route,
      transcriptSessionId: generation, runId, inputAcceptedAtMs: acceptedAt,
      timestamp: String(acceptedAt), idempotencyKey: 'submission:user',
      displayPosition: { source: 'sqlite', rawSeq: 21280 },
    };
    const pending: WorkspaceMessage = {
      id: 'pending-input:custody', text: canonical.text, role: 'user', source: 'history', sessionKey: route,
      transcriptSessionId: generation, runId, inputAcceptedAtMs: acceptedAt,
      timestamp: String(acceptedAt),
    };

    expect(coalesceTranscriptIdentities([canonical, pending])).toEqual([canonical]);
    const receiptPending = { ...pending, runId: 'submission', inputReceiptRunId: 'submission' };
    expect(coalesceTranscriptIdentities([canonical, receiptPending])).toEqual([canonical]);
    expect(coalesceTranscriptIdentities([
      { ...canonical, idempotencyKey: 'different-submission:user' }, receiptPending,
    ])).toHaveLength(2);
    for (const control of [
      { ...pending, sessionKey: 'other-route' },
      { ...pending, transcriptSessionId: '11111111-1111-4111-8111-111111111111' },
      { ...pending, runId: 'other-run' },
      { ...pending, inputReceiptRunId: 'conflicting-receipt' },
      { ...pending, inputAcceptedAtMs: acceptedAt + 1, timestamp: String(acceptedAt + 1) },
      { ...pending, text: 'an intentional different prompt' },
      { ...pending, attachments: [{ id: 'image', filename: 'proof.png', mimeType: 'image/png' }] },
    ]) expect(coalesceTranscriptIdentities([canonical, control])).toHaveLength(2);

    const repeatedLater = { ...pending, id: 'pending-input:later', inputAcceptedAtMs: acceptedAt + 1,
      timestamp: String(acceptedAt + 1) };
    expect(coalesceTranscriptIdentities([canonical, pending, repeatedLater])).toEqual([canonical, repeatedLater]);
    const ambiguous = { ...pending, id: 'pending-input:ambiguous' };
    expect(coalesceTranscriptIdentities([canonical, pending, ambiguous])).toHaveLength(3);
  });

  it('requires an exact strong media snapshot before retiring a custody alias', () => {
    const acceptedAt = 1789834398410;
    const shared = {
      text: 'there is some serious out of order prompt displays in the transcript', role: 'user' as const,
      source: 'history' as const, sessionKey: 'agent:main:direct:vimicate-ios',
      transcriptSessionId: '00000000-0000-4000-8000-000000000106',
      runId: '00000000-0000-4000-8000-000000000103', inputAcceptedAtMs: acceptedAt,
      timestamp: String(acceptedAt),
    };
    const attachment = {
      id: 'canonical-generated-id', filename: 'report.png', mimeType: 'image/png', byteCount: 417975,
      uri: '/__openclaw__/assistant-media?source=media%3A%2F%2Finbound%2Freport.png',
      headers: { Authorization: 'Bearer scoped', Accept: 'image/png' },
    };
    const canonical: WorkspaceMessage = {
      ...shared, id: 'canonical-media', idempotencyKey: 'submission:user',
      displayPosition: { source: 'sqlite', rawSeq: 23134 }, attachments: [attachment],
    };
    const pending: WorkspaceMessage = {
      ...shared, id: 'pending-input:media-custody',
      attachments: [{ ...attachment, id: 'independently-generated-id', headers: { Accept: 'image/png', Authorization: 'Bearer scoped' } }],
    };

    expect(coalesceTranscriptIdentities([canonical, pending])).toEqual([canonical]);
    const controls: Array<WorkspaceMessage['attachments']> = [
      undefined,
      [{ ...pending.attachments![0]!, uri: `${pending.attachments![0]!.uri}-different` }],
      [{ ...pending.attachments![0]!, filename: 'different.png' }],
      [{ ...pending.attachments![0]!, byteCount: 417976 }],
      [{ ...pending.attachments![0]!, headers: { Accept: 'image/png' } }],
      [{ id: 'synthetic-only', filename: 'report.png', mimeType: 'image/png', byteCount: 417975 }],
    ];
    for (const attachments of controls) {
      const control = { ...pending };
      if (attachments) control.attachments = attachments;
      else delete control.attachments;
      expect(coalesceTranscriptIdentities([canonical, control])).toHaveLength(2);
    }

    const second = { ...attachment, id: 'second', filename: 'second.png', uri: `${attachment.uri}-second` };
    expect(coalesceTranscriptIdentities([
      { ...canonical, attachments: [attachment, second] },
      { ...pending, attachments: [second, attachment] },
    ])).toHaveLength(2);
  });

  it('coalesces duplicate upstream rows with one explicit submission identity', () => {
    const first = message('assistant-copy-one', 'same answer', { source: 'history', state: 'complete', idempotencyKey: 'submission-7:assistant' });
    const duplicate = message('assistant-copy-two', 'same answer', { source: 'history', state: 'complete', idempotencyKey: 'submission-7' });
    expect(coalesceTranscriptIdentities([first, duplicate])).toEqual([expect.objectContaining({ id: 'assistant-copy-one', text: 'same answer' })]);
    expect(transcriptIdentitiesAreUnique([first, duplicate])).toBe(false);
  });

  it('does not resurrect an obsolete image attempt while exact identities converge', () => {
    const oldAttempt = message('same', 'draft', { attachments: [{ id: 'old', filename: 'old.png', mimeType: 'image/png', uri: 'https://example.test/old.png' }] });
    const finalAttempt = message('same', 'final', { source: 'history', state: 'complete', attachments: [{ id: 'new', filename: 'new.png', mimeType: 'image/png', uri: 'https://example.test/new.png' }] });
    expect(coalesceTranscriptIdentities([oldAttempt, finalAttempt])[0]?.attachments).toEqual(finalAttempt.attachments);
    const { attachments: _discarded, ...finalWithoutMedia } = finalAttempt;
    expect(coalesceTranscriptIdentities([oldAttempt, finalWithoutMedia])[0]?.attachments).toBeUndefined();
  });
});

it('bridges primary user ID enrichment into an explicit submission alias', () => {
  const base: WorkspaceMessage = { id: 'u1', role: 'user', source: 'history', text: 'x', sessionKey: 's' };
  const enriched = { ...base, idempotencyKey: 'req:user' };
  const alias = { ...enriched, id: 'u2' };
  expect(coalesceTranscriptIdentities([base, enriched, alias])).toEqual([enriched]);
});
