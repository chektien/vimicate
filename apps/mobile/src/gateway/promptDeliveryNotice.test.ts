import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { sessionFailureNotice } from './sessionFailureNotice';
import { projectGatewayEvent } from './gatewayEventProjection';
import { buildVisibleTranscriptRenderRows } from '../transcript/transcriptVisibleRows';
import { promptSubmissionFailure } from './promptDeliveryNotice';
import { commandMessage } from './submissionMessages';

const protectedError = 'Protected Codex continuation requires a current parent-local inference relay; the native thread is claimed by active work.';
const generation = '11111111-1111-4111-8111-111111111111';
const failure = { role: 'custom', customType: 'run-failed-before-reply', content: `Your request could not be completed. ${protectedError}`,
  openclawRunError: { runId: 'request', summary: protectedError }, __openclaw: { id: 'failure', runId: 'request' } };
const prompt = { role: 'user', content: 'A synthetic request', idempotencyKey: 'request:user' };

describe('actionable prompt delivery notices', () => {
  it('shows saved input separately from assistant-start failure and keeps the next step unfolded', () => {
    const rows = messagesFromPayload({ sessionKey: 'one', sessionId: generation, messages: [prompt, failure] });
    const error = rows.find(row => row.role === 'error')!;
    expect(error).toMatchObject({ id: 'failure', runId: 'request', state: 'error' });
    const headline = error.text.split('\n')[0]!;
    expect(headline).toContain('Message saved');
    expect(headline).toContain('recovery');
    expect(headline).toContain(':status');
    expect(headline).toContain('Do not resend');
    expect(headline).not.toContain('parent-local');
    expect(error.text).toContain(protectedError);
    const visible = buildVisibleTranscriptRenderRows([error], new Set());
    expect(visible).toHaveLength(1);
    expect(visible[0]?.compiled.source).toContain(':status');
    expect(visible[0]?.compiled.source).toContain('Do not resend or reset this conversation.');
    expect(visible[0]?.compiled.source).not.toContain('parent-local');
  });
  it('keeps the entire uncertain-delivery action visible on a folded local notice', () => {
    const notice = promptSubmissionFailure(new Error('chat.send timed out'), true);
    const [row] = buildVisibleTranscriptRenderRows([commandMessage('one', notice.text, 'error')], new Set());
    expect(row?.fold?.expanded).toBe(false);
    expect(row?.compiled.source).toContain('Do not resend while delivery is unknown.');
    expect(row?.compiled.source).not.toContain('chat.send timed out');
  });
  it.for([
    [],
    [{ ...prompt, idempotencyKey: 'different:user' }],
    [{ ...prompt, sessionKey: 'other' }],
    [{ ...prompt, sessionId: '22222222-2222-4222-8222-222222222222' }],
    [{ ...prompt, provenance: { kind: 'inter_session' } }],
    [{ ...prompt, __openclaw: { idempotencyKey: 'other:user' } }],
  ])('does not invent saved-user-input evidence from absent or incompatible prompts', prompts => {
    const error = messagesFromPayload({ sessionKey: 'one', sessionId: generation, messages: [...prompts, failure] }).find(row => row.role === 'error')!;
    expect(error.text.split('\n')[0]).not.toContain('Message saved');
    expect(error.text.split('\n')[0]).toContain('Refresh');
  });
  it('does not reinterpret authored lookalikes as system failures', () => {
    const [row] = messagesFromPayload({ sessionKey: 'one', messages: [{ ...failure, role: 'user' }] });
    expect(row?.role).toBe('user');
    expect(row?.text).toBe(failure.content);
  });
  it('does not claim scoped saved-input proof when the history page has no route', () => {
    const error = messagesFromPayload({ messages: [prompt, failure] }).find(row => row.role === 'error')!;
    expect(error.text.split('\n')[0]).not.toContain('Message saved');
  });
  it.for([
    { sessionKey: 'other' },
    { sessionId: '22222222-2222-4222-8222-222222222222' },
    { runId: 'other' },
    { __openclaw: { runId: 'other' } },
  ])('does not join a conflicting failure marker to a saved prompt', scope => {
    const rows = messagesFromPayload({ sessionKey: 'one', sessionId: generation, messages: [prompt, { ...failure, ...scope }] });
    expect(rows.some(row => row.role === 'error')).toBe(false);
    expect(rows.some(row => row.text.includes('Message saved'))).toBe(false);
  });
  it('explains session and live failures without pretending an error alone proves input custody', () => {
    const notice = sessionFailureNotice({ key: 'one', status: 'failed', lastRunId: 'request', lastRunError: protectedError })!;
    expect(notice.text.split('\n')[0]).toContain('recovery');
    expect(notice.text.split('\n')[0]).toContain('Do not resend');
    expect(notice.text.split('\n')[0]).not.toContain('Message saved');
    const live = projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'request', state: 'error', errorMessage: protectedError } }, 'one')!.message;
    expect(live.text.split('\n')[0]).toContain('recovery');
    expect(live.text).toContain(protectedError);
  });
  it('keeps background-result failures distinct from a new rejected prompt', () => {
    const notice = sessionFailureNotice({ key: 'one', status: 'failed', lastRunId: 'announce:child', lastRunError: 'delivery unavailable' })!;
    expect(notice.text.split('\n')[0]).toContain('Background result');
    expect(notice.text.split('\n')[0]).toContain('completed work');
    expect(notice.text.split('\n')[0]).toContain('Refresh');
    const live = projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'announce:child', state: 'error', errorMessage: 'delivery unavailable' } }, 'one')!.message;
    expect(live.text.split('\n')[0]).toContain('Background result');
  });
});
