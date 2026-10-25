import { refreshIntentForGatewayEvent } from '../gateway/gatewayEvents';
import { asyncQuestionHistory } from './asyncQuestionHistory';
import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent } from '../gateway/gatewayEventProjection';
import { parseAsyncQuestion, formatAsyncAnswer } from './asyncQuestionContract';
const wire = { itemId: 'native-question-1', questions: [{ title: 'Which route?', options: ['First', 'Second'] }, { title: 'Notes?' }] };
const raw = (extra = {}) => ({ role: 'assistant', content: [{ type: 'text', text: 'Which route? First or Second. Notes?' }], openclawAsyncDelivery: wire, __openclaw: { id: 'q-message', runId: 'origin' }, ...extra });
const project = (rows: unknown[]) => messagesFromPayload({ sessionKey: 'session:a', messages: rows });
describe('Codex async question wire boundary', () => {
  it('projects top-level assistant metadata in its originating message and scoped live frame', () => {
    expect(project([raw()])[0]).toMatchObject({ id: 'q-message', sessionKey: 'session:a', asyncQuestion: wire });
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'session:a', runId: 'origin', state: 'delta', message: raw() } }, 'session:a')?.message).toMatchObject({ asyncQuestion: wire, id: 'live-async-origin-native-question-1' });
    expect(projectGatewayEvent({ event: 'chat', payload: { runId: 'origin', state: 'delta', message: raw() } }, 'session:a')).toBeNull();
  });
  it('rejects unsupported structures atomically and keeps their readable fallback', () => {
    for (const bad of [{ ...wire, questions: [] }, { ...wire, itemId: 'x'.repeat(257) }, { ...wire, questions: [{ title: 'x', options: [] }] }, { ...wire, questions: [{ title: 'x', options: ['x'.repeat(257)] }] }, { ...wire, questions: Array(13).fill({ title: 'x' }) }]) {
      expect(parseAsyncQuestion(bad)).toBeUndefined();
      expect(project([raw({ openclawAsyncDelivery: bad })])[0]?.text).toContain('Which route?');
    }
    expect(parseAsyncQuestion({ ...wire, questions: Array(12).fill({ title: 'x'.repeat(4096), options: Array(4).fill('y'.repeat(256)) }) })).toBeDefined();
    expect(project([raw({ role: 'user' })])[0]?.asyncQuestion).toBeUndefined();
  });
  it('matches Control UI UTF-8 quote clipping, newline replacement and answer joining exactly', () => {
    const question = { ...wire, questions: [{ title: '😀'.repeat(129) + '\nextra' }, { title: 'Line\r\ntwo' }] };
    expect(formatAsyncAnswer(question, { answers: { '0': ['yes', 'maybe'], '1': ['note'] } })).toBe(`> ${'😀'.repeat(128)}\n\nyes, maybe\n\n> Line  two\n\nnote`);
  });
  it('does not expose local paths or declared secret questions in authored prose or the card', () => {
    const row = project([raw({ content: '/Users/person/private/key.txt token', openclawAsyncDelivery: { itemId: 'secret', questions: [{ title: 'secret-value /Users/person/private', options: ['secret-option'], isSecret: true }] } })])[0]!;
    expect(JSON.stringify(row)).not.toContain('secret-value'); expect(JSON.stringify(row)).not.toContain('secret-option'); expect(row.text).toContain('Answer elsewhere');
    const path = project([raw({ content: 'Read /Users/person/private/file.txt', openclawAsyncDelivery: { itemId: 'path', questions: [{ title: 'Use /Users/person/private/file.txt?' }] } })])[0]!;
    expect(path.text).not.toContain('/Users/person'); expect(path.asyncQuestion?.questions[0]?.title).not.toContain('/Users/person'); expect(formatAsyncAnswer(path.asyncQuestion!, { answers: { '0': ['yes'] } })).toBe('> Use /Users/person/private/file.txt?\n\nyes');
  });
});
describe('async reminder retirement', () => {
  const terminal = (runId: string, extra = {}) => ({ role: 'assistant', content: 'Done', __openclaw: { runId, runTerminal: true }, ...extra });
  const user = (runId: string) => ({ role: 'user', content: 'continue', __openclaw: { runId } });
  it('keeps origin completion, commentary, overlap, failed and interrupted runs pending', () => {
    for (const tail of [[terminal('origin')], [user('overlap'), terminal('overlap')], [terminal('origin'), user('later'), terminal('later', { stopReason: 'error' })], [terminal('origin'), user('later'), terminal('later', { channel: 'commentary' })]]) {
      expect(asyncQuestionHistory(project([raw(), ...tail]))[0]?.boundary).toBeUndefined();
    }
  });
  it('retires only after a later successful run following origin settlement, including restart recovery', () => {
    expect(asyncQuestionHistory(project([raw(), terminal('origin'), user('later'), terminal('later')]))[0]?.boundary).toBeDefined();
    const recovery = { role: 'user', content: 'recover', provenance: { kind: 'internal_system', sourceTool: 'main_session_restart_recovery' }, __openclaw: { runId: 'recovered' } };
    expect(asyncQuestionHistory(project([raw(), recovery]))[0]?.boundary).toBeUndefined();
    expect(asyncQuestionHistory(project([raw(), recovery, terminal('recovered')]))[0]?.boundary).toBeDefined();
  });
  it('confirms only saved user answers and conservatively handles identical question headings', () => {
    const answer = formatAsyncAnswer(wire, { answers: { '0': ['Second'], '1': ['notes'] } });
    const rows = project([raw(), { role: 'user', content: answer, __openclaw: { id: 'reply', replyToId: 'q-message' } }]);
    expect(asyncQuestionHistory(rows)[0]?.confirmedText).toBe(answer);
    expect(asyncQuestionHistory([rows[0]!, { id: 'local', role: 'user', text: answer, source: 'local' }])[0]?.confirmedText).toBeUndefined();
  });
});

it('projects async session.message records immediately and refreshes them during active runs', () => {
  const frame = { event: 'session.message', payload: { sessionKey: 'session:a', message: raw() } };
  expect(projectGatewayEvent(frame, 'session:a')?.message.asyncQuestion).toEqual(wire); expect(refreshIntentForGatewayEvent(frame, 'session:a').refreshDuringRun).toBe(true);
});

it('never mistakes accepted pending-input custody for a saved canonical async answer', () => {
  const answer = formatAsyncAnswer(wire, { answers: { '0': ['Second'], '1': ['notes'] } });
  const payload = { sessionKey: 'session:a', messages: [raw()], pendingInputs: { items: [{ id: 'custody', runId: 'origin', state: 'queued', acceptedAt: 123, message: { content: answer, idempotencyKey: 'answer-uuid' } }] } };
  expect(asyncQuestionHistory(messagesFromPayload(payload))[0]?.confirmedText).toBeUndefined();
});
