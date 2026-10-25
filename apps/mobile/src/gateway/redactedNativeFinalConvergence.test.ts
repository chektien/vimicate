import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { claudeNativeLiveDiagnosis, reconcileClaudeNativeLive } from './claudeNativeLiveConvergence';
import { restoreObservedTokenRedaction } from './observedTokenRedaction';
import { retainingAbsorbedLiveIdentity } from './transcriptIdentityWall';

const sessionKey = 'synthetic-native-route';
const runId = 'synthetic-native-run';
const generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cliSession = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fullToken = 'abcdef012345678901234567890123456789wxyz';
const mask = 'abcdef…wxyz';
const answer = (token: string) => `Use https://example.test/reset-password?token=${token}&mode=reset to continue.`;
const fullText = answer(fullToken);
const maskedText = answer(mask);
function canonical(text = maskedText) {
  return messagesFromPayload({ sessionKey, sessionId: generation, messages: [
    { id: 'prompt', role: 'user', timestamp: 1_000, idempotencyKey: `${runId}:user`, content: 'Make a reset link',
      __openclaw: { importedFrom: 'claude-cli', cliSessionId: cliSession, externalId: 'native-prompt',
        transcriptPosition: { source: 'synthetic-window', rawSeq: 10 } } },
    { id: 'commentary', role: 'assistant', provider: 'claude-cli', stopReason: 'tool_use', timestamp: 2_000,
      content: 'Making the link.', __openclaw: { importedFrom: 'claude-cli', cliSessionId: cliSession, externalId: 'commentary' } },
    { id: 'answer', role: 'assistant', provider: 'claude-cli', stopReason: 'end_turn', timestamp: 4_000, content: text,
      __openclaw: { importedFrom: 'claude-cli', cliSessionId: cliSession, externalId: 'answer' } },
  ] });
}
function live(text = fullText): WorkspaceMessage {
  return projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId,
    state: 'final', message: { content: `Making the link.\n\n${text}`, timestamp: 2.002 } } }, sessionKey)!.message;
}
const assistants = (rows: WorkspaceMessage[]) => rows.filter(row => row.role === 'assistant');
function withoutProvenance({ cliProvenance: _removed, ...row }: WorkspaceMessage) { return row; }
function withoutGeneration({ transcriptSessionId: _removed, ...row }: WorkspaceMessage) { return row; }

describe('redacted native terminal identity', () => {
  it('recognizes the observed redaction and native terminal proof', () => {
    expect(restoreObservedTokenRedaction(maskedText, fullText)).toBe(fullText);
    expect(claudeNativeLiveDiagnosis([...canonical(), live()], live())).toBe('match');
  });
  it.each(['canonical-first', 'live-first'] as const)('retains one canonical final with the delivered action token for %s delivery', order => {
    const history = canonical();
    const rows = order === 'canonical-first' ? upsertLiveMessage(history, live())
      : mergeLatestHistory(history, [history[0]!, live()], sessionKey);
    expect(assistants(rows)).toHaveLength(1);
    expect(rows.map(row => row.id)).toEqual(['prompt', 'commentary', 'answer']);
    expect(rows.at(-1)).toMatchObject({ text: fullText, source: 'history', timestamp: '4000',
      absorbedLiveIdentity: { messageId: `live-chat-${runId}`, runId } });
  });

  it('repairs the retained early full answer and survives cache, refresh and repeated late finals', () => {
    const history = canonical();
    let rows = mergeLatestHistory(history, [history[0]!, live(), ...history.slice(1)], sessionKey);
    for (let index = 0; index < 3; index += 1) {
      rows = parsedTranscriptCache(serializedTranscriptCache(rows));
      rows = mergeLatestHistory(history, rows, sessionKey);
      rows = upsertLiveMessage(rows, live());
      expect(assistants(rows)).toHaveLength(1);
      expect(assistants(rows)[0]?.text).toBe(fullText);
      expect(rows.map(row => row.id)).toEqual(['prompt', 'commentary', 'answer']);
    }
  });

  it('repairs aggregate convergence and persisted cache directly without a live generation', () => {
    const history = canonical();
    const retained = [history[0]!, live(), ...history.slice(1)];
    expect(live().transcriptSessionId).toBeUndefined();
    for (const rows of [reconcileClaudeNativeLive(retained), parsedTranscriptCache(serializedTranscriptCache(retained))]) {
      expect(rows.map(row => row.id)).toEqual(['prompt', 'commentary', 'answer']);
      expect(assistants(rows)[0]?.text).toBe(fullText);
    }
  });

  it('never substitutes changed or missing narration for the exact native aggregate prefix', () => {
    for (const text of [`Different narration.\n\n${fullText}`, `${fullText}\n\nMaking the link.`]) {
      const incoming = { ...live(), text };
      expect(reconcileClaudeNativeLive([...canonical(), incoming]).some(row => row.id === incoming.id)).toBe(true);
    }
  });

  it('accepts multiple independently proven token redactions without changing any other bytes', () => {
    const full = `${fullText}\n${answer('abcdefdifferentinteriorwxyz')}`;
    const masked = `${maskedText}\n${maskedText}`;
    expect(assistants(upsertLiveMessage(canonical(masked), live(full)))).toHaveLength(1);
  });

  it.each([
    ['changed prose', maskedText.replace('continue', 'restart')],
    ['changed path', maskedText.replace('reset-password', 'another-path')],
    ['changed query name', maskedText.replace('token=', 'code=')],
    ['changed visible prefix', answer('ghijkl…wxyz')],
    ['changed visible suffix', answer('abcdef…abcd')],
    ['unrecognized mask', answer('abcdef***wxyz')],
    ['different unmasked token', answer('abcdefdifferentinteriorwxyz')],
  ])('does not infer identity from %s', (_label, text) => {
    expect(assistants(upsertLiveMessage(canonical(text), live()))).toHaveLength(2);
    expect(assistants(mergeLatestHistory(canonical(text), [canonical()[0]!, live()], sessionKey))).toHaveLength(2);
  });

  it('requires a genuine URL query token and a nonoverlapping full value', () => {
    for (const [masked, full] of [
      [`plain ?token=${mask}`, `plain ?token=${fullToken}`],
      [answer(mask), answer('abcdefwxyz')],
      [maskedText.replace('reset-password', 'api'), fullText.replace('reset-password', 'api')],
      [maskedText.replace('example.test', '[invalid]'), fullText.replace('example.test', '[invalid]')],
    ]) expect(assistants(upsertLiveMessage(canonical(masked), live(full)))).toHaveLength(2);
  });

  it('does not restore a known token across reused IDs in another generation or native source', () => {
    const previous = reconcileClaudeNativeLive([...canonical(), live()]).find(row => row.id === 'answer')!;
    const incoming = canonical().at(-1)!;
    for (const refreshed of [
      { ...incoming, transcriptSessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      withoutGeneration(incoming),
      { ...incoming, cliProvenance: { kind: 'claude-native' as const, sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', externalId: 'answer' } },
      { ...incoming, cliProvenance: { kind: 'claude-native' as const, sessionId: cliSession, externalId: 'different-native-answer' } },
      withoutProvenance(incoming),
      { ...incoming, text: maskedText.replace('mode=reset', 'mode=another') },
      { ...incoming, text: answer('abcdefanotheralreadyfullwxyz') },
    ]) {
      expect(retainingAbsorbedLiveIdentity(previous, refreshed).text).toBe(refreshed.text);
    }
  });

  it.each([
    ['missing generation', (rows: WorkspaceMessage[]) => rows.map(({ transcriptSessionId: _removed, ...row }) => row)],
    ['foreign prompt generation', (rows: WorkspaceMessage[]) => [{ ...rows[0]!, transcriptSessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, ...rows.slice(1)]],
    ['foreign native session', (rows: WorkspaceMessage[]) => rows.map(row => row.id === 'answer'
      ? { ...row, cliProvenance: { kind: 'claude-native' as const, sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', externalId: row.id } } : row)],
    ['unbound prompt', (rows: WorkspaceMessage[]) => [{ ...rows[0]!, idempotencyKey: 'other-run:user' }, ...rows.slice(1)]],
    ['non-native answer', (rows: WorkspaceMessage[]) => rows.map(row => row.id === 'answer' ? withoutProvenance(row) : row)],
    ['unproven external ID', (rows: WorkspaceMessage[]) => rows.map(row => row.id === 'answer' ? { ...row, id: 'unrelated-answer-id' } : row)],
    ['streaming answer', (rows: WorkspaceMessage[]) => rows.map(row => row.id === 'answer' ? { ...row, state: 'streaming' as const } : row)],
    ['foreign run answer', (rows: WorkspaceMessage[]) => rows.map(row => row.id === 'answer' ? { ...row, runId: 'other-run' } : row)],
    ['answer media', (rows: WorkspaceMessage[]) => rows.map(row => row.id === 'answer'
      ? { ...row, attachments: [{ id: 'image', filename: 'image.png', mimeType: 'image/png' }] } : row)],
  ] as const)('rejects %s', (_label, change) => {
    const history = change(canonical());
    const rows = upsertLiveMessage(history, live());
    expect(rows.some(row => row.id === `live-chat-${runId}`)).toBe(true);
  });

  it('does not collapse ambiguous or neighboring native terminal answers', () => {
    const history = canonical();
    const duplicate = { ...history[2]!, id: 'another-answer',
      cliProvenance: { kind: 'claude-native' as const, sessionId: cliSession, externalId: 'another-answer' } };
    for (const rows of [
      [...history, duplicate],
      [history[0]!, duplicate, ...history.slice(1)],
      [history[0]!, { ...history[0]!, id: 'another-prompt', idempotencyKey: 'other-run:user' }, ...history.slice(1)],
      [history[0]!, { ...history[0]!, id: 'ambiguous-prompt' }, ...history.slice(1)],
      [history[0]!, { ...history[0]!, role: 'boundary' as const }, ...history.slice(1)],
    ]) expect(upsertLiveMessage(rows, live()).some(row => row.id === `live-chat-${runId}`)).toBe(true);
  });

  it('rejects foreign live generation and incomplete live authority', () => {
    for (const change of [
      { transcriptSessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      { state: 'streaming' as const }, { id: 'different-message-in-same-run' },
    ]) expect(upsertLiveMessage(canonical(), { ...live(), ...change }).some(row => row.source === 'live')).toBe(true);
  });

  it('retains an explicit chat generation from the producer', () => {
    const projected = projectGatewayEvent({ event: 'chat', payload: { sessionKey, sessionId: generation,
      runId, state: 'final', message: { content: fullText } } }, sessionKey)!.message;
    expect(projected.transcriptSessionId).toBe(generation);
  });
});
