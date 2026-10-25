import { expect, it, vi } from 'vitest';
import { gatewayRequestFailure, gatewayResponseFailure } from './gatewayRequestDelivery';
import { sendWithQueuedFallback } from './queuedPromptSubmission';

const sessionId = '00000000-0000-4000-8000-000000000106';
const refused = (reason = 'tool_authority_mismatch', disposition = 'not-dispatched') => gatewayResponseFailure({
  code: 'INVALID_REQUEST', message: 'strict refusal', details: {
    reason, inputDisposition: disposition, expectedActiveRunId: 'cron', activeRunId: 'cron',
  },
});
const scheduled = (patch: Record<string, unknown> = {}, session: Record<string, unknown> = {}) => ({ session: {
  key: 'notes', sessionId, hasActiveRun: true, activeRunId: 'cron', status: 'running',
  activeRunOrigin: { kind: 'scheduled', runId: 'cron', sessionId, ...patch }, ...session } });
function fixture() {
  const calls: string[] = [];
  const send = vi.fn(async (..._args: unknown[]) => { calls.push('send'); throw refused(); });
  const readSessionRunTruth = vi.fn(async (_key: string): Promise<Record<string, unknown>> => { calls.push('origin'); return scheduled(); });
  const tracking = { prepare: vi.fn(async () => { calls.push('persist'); }), accepted: vi.fn(async () => {}), failed: vi.fn(async () => {}) };
  const options = { client: { send, readSessionRunTruth } as never, sessionKey: 'notes', sessionId, text: 'my next task', outbound: 'context\nmy next task',
    attachments: [{ id: 'file', filename: 'a.png', mimeType: 'image/png', byteCount: 1, dataBase64: 'YQ==' }],
    submissionId: 'send-one', control: { queueMode: 'steer' as const, steerPolicy: 'require-active' as const, expectedActiveRunId: 'cron' },
    tracking, ownsFallback: vi.fn(() => true), onFollowupIdentity: vi.fn(),
  };
  return { options, send, readSessionRunTruth, tracking, calls };
}

it('persists one distinct followup identity before sending unchanged content after confirmed refusal', async () => {
  const f = fixture();
  f.send.mockImplementationOnce(async () => { f.calls.push('strict'); throw refused(); })
    .mockImplementationOnce(async () => { f.calls.push('followup'); return { runId: 'send-one:followup', status: 'started' } as never; });
  const result = await sendWithQueuedFallback(f.options);
  expect(f.calls).toEqual(['strict', 'origin', 'persist', 'followup']);
  expect(f.readSessionRunTruth).toHaveBeenCalledExactlyOnceWith('notes');
  expect(f.send).toHaveBeenNthCalledWith(2, 'notes', f.options.outbound, f.options.attachments, 'send-one:followup', { queueMode: 'followup', sessionId });
  expect(f.tracking.prepare).toHaveBeenCalledWith(expect.objectContaining({ originalSubmissionId: 'send-one', runId: 'send-one:followup', sessionId, predecessorRunId: 'cron' }));
  expect(f.options.onFollowupIdentity).toHaveBeenCalledExactlyOnceWith('send-one:followup');
  expect(result.followupRunId).toBe('send-one:followup');
  expect(f.tracking.accepted).toHaveBeenCalledWith('send-one:followup', result.payload);
});

it.each(['active_run_changed', 'no_active_run', 'unknown'])('does not queue a %s refusal', async reason => {
  const f = fixture(); f.send.mockRejectedValue(refused(reason));
  await expect(sendWithQueuedFallback(f.options)).rejects.toThrow();
  expect(f.send).toHaveBeenCalledOnce(); expect(f.tracking.prepare).not.toHaveBeenCalled();
});
it.each([gatewayRequestFailure('timeout', true), refused('tool_authority_mismatch', 'unconfirmed')])('never retries an uncertain strict send', async error => {
  const f = fixture(); f.send.mockRejectedValue(error);
  await expect(sendWithQueuedFallback(f.options)).rejects.toBe(error);
  expect(f.send).toHaveBeenCalledOnce(); expect(f.tracking.prepare).not.toHaveBeenCalled();
});
it('keeps successful steering unchanged', async () => {
  const f = fixture(); f.send.mockResolvedValue({ runId: 'original' } as never);
  expect((await sendWithQueuedFallback(f.options)).followupRunId).toBe('');
  expect(f.tracking.prepare).not.toHaveBeenCalled(); expect(f.send).toHaveBeenCalledOnce();
  expect(f.readSessionRunTruth).not.toHaveBeenCalled();
});
it.each([
  ['missing concrete generation', scheduled({}, { sessionId: undefined })],
  ['another live target', scheduled({}, { activeRunId: 'other' })],
  ['another generation', scheduled({}, { sessionId: '00000000-0000-4000-a000-000000000145' })],
  ['another route', scheduled({}, { key: 'other' })],
  ['a malformed payload', null],
])('keeps the original steering refusal for %s', async (_label, payload) => {
  const f = fixture(); const error = refused(); f.send.mockRejectedValue(error);
  f.readSessionRunTruth.mockResolvedValue(payload as never);
  await expect(sendWithQueuedFallback(f.options)).rejects.toBe(error);
  expect(f.send).toHaveBeenCalledOnce(); expect(f.tracking.prepare).not.toHaveBeenCalled();
  expect(f.options.onFollowupIdentity).not.toHaveBeenCalled();
});
it('keeps the original refusal when an older host cannot read origin', async () => {
  const f = fixture(); const error = refused(); f.send.mockRejectedValue(error);
  f.readSessionRunTruth.mockRejectedValue(gatewayResponseFailure({ code: 'INVALID_REQUEST', message: 'unknown method: vimicate.runs.read' }));
  await expect(sendWithQueuedFallback(f.options)).rejects.toBe(error);
  expect(f.send).toHaveBeenCalledOnce(); expect(f.tracking.prepare).not.toHaveBeenCalled();
});
it('rechecks ownership after the origin read', async () => {
  const f = fixture(); const error = refused(); f.send.mockRejectedValue(error);
  f.options.ownsFallback.mockReturnValueOnce(true).mockReturnValue(false);
  await expect(sendWithQueuedFallback(f.options)).rejects.toBe(error);
  expect(f.readSessionRunTruth).toHaveBeenCalledOnce(); expect(f.tracking.prepare).not.toHaveBeenCalled();
});
it('does not queue without concrete session identity or after successor/scene retirement', async () => {
  for (const option of [{ sessionId: undefined }, { ownsFallback: () => false }]) {
    const f = fixture(); await expect(sendWithQueuedFallback({ ...f.options, ...option })).rejects.toThrow();
    expect(f.send).toHaveBeenCalledOnce(); expect(f.tracking.prepare).not.toHaveBeenCalled();
  }
});
it('does not send after durable preparation fails', async () => {
  const f = fixture(); f.tracking.prepare.mockRejectedValue(new Error('storage full'));
  await expect(sendWithQueuedFallback(f.options)).rejects.toThrow('storage full');
  expect(f.send).toHaveBeenCalledOnce(); expect(f.options.onFollowupIdentity).not.toHaveBeenCalled();
});
it('rechecks ownership after local persistence', async () => {
  const f = fixture(); f.options.ownsFallback.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
  await expect(sendWithQueuedFallback(f.options)).rejects.toThrow('active task changed');
  expect(f.send).toHaveBeenCalledOnce(); expect(f.tracking.failed).toHaveBeenCalledOnce();
});
it('keeps a lost or malformed followup acknowledgement unconfirmed without further send', async () => {
  for (const value of [null, { runId: 'wrong', status: 'started' }, { runId: 'send-one:followup', status: 'ok' }]) {
    const f = fixture(); f.send.mockRejectedValueOnce(refused()).mockImplementationOnce(async () => {
      if (!value) throw gatewayRequestFailure('timed out', true);
      return value as never;
    });
    await expect(sendWithQueuedFallback(f.options)).rejects.toMatchObject({ reachedGateway: true });
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.tracking.accepted).not.toHaveBeenCalled();
    expect(f.tracking.failed).toHaveBeenCalledOnce();
  }
});

it.each(['ordinary', 'announcement', 'scheduled'])('queues after exact refusal independently of %s origin', async kind => {
  const f = fixture(); f.readSessionRunTruth.mockResolvedValue(scheduled({ kind }) as never);
  f.send.mockRejectedValueOnce(refused()).mockResolvedValueOnce({ runId: 'send-one:followup', status: 'started' } as never);
  expect((await sendWithQueuedFallback(f.options)).followupRunId).toBe('send-one:followup');
  expect(f.send).toHaveBeenCalledTimes(2);
});
it.each(['input_visibility_mismatch', 'run_not_ready', 'image_input_unsupported'])('queues one independently admitted turn after confirmed %s non-dispatch', async reason => {
  const f = fixture(); f.send.mockRejectedValueOnce(refused(reason)).mockResolvedValueOnce({ runId: 'send-one:followup', status: 'started' } as never);
  expect((await sendWithQueuedFallback(f.options)).followupRunId).toBe('send-one:followup');
  expect(f.send).toHaveBeenCalledTimes(2);
});
it('does not depend on origin metadata for ordinary or announcement work', async () => {
  const f = fixture(); f.readSessionRunTruth.mockResolvedValue({ session: { key: 'notes', sessionId, activeRunId: 'cron', hasActiveRun: true } } as never);
  f.send.mockRejectedValueOnce(refused()).mockResolvedValueOnce({ runId: 'send-one:followup', status: 'started' } as never);
  expect((await sendWithQueuedFallback(f.options)).followupRunId).toBe('send-one:followup');
});
// A non-injectable run has no steering target, so the audited read names it
// only as the separate attached current run.
const attached = (session: Record<string, unknown> = {}) => ({ session: { key: 'notes', sessionId, hasActiveRun: true, attachedRunId: 'cron', status: 'running', ...session } });
it('queues after run_not_ready when the audited read names the same attached current run', async () => {
  const f = fixture(); f.readSessionRunTruth.mockResolvedValue(attached() as never);
  f.send.mockImplementationOnce(async () => { throw refused('run_not_ready'); })
    .mockImplementationOnce(async () => ({ runId: 'send-one:followup', status: 'started' }) as never);
  expect((await sendWithQueuedFallback(f.options)).followupRunId).toBe('send-one:followup');
  expect(f.send).toHaveBeenNthCalledWith(2, 'notes', f.options.outbound, f.options.attachments, 'send-one:followup', { queueMode: 'followup', sessionId });
});
it.each([
  ['run_not_ready', attached({ attachedRunId: 'successor' })],
  ['run_not_ready', attached({ sessionId: '00000000-0000-4000-8000-000000000160' })],
  ['run_not_ready', attached({ hasActiveRun: false })],
  ['run_not_ready', attached({ activeRunId: 'successor' })],
  ['run_not_ready', attached({ attachedRunId: undefined })],
  ['tool_authority_mismatch', attached()],
  ['input_visibility_mismatch', attached()],
  ['image_input_unsupported', attached()],
])('does not treat attached identity as queue proof for %s with %j', async (reason, truth) => {
  const f = fixture(); f.readSessionRunTruth.mockResolvedValue(truth as never);
  const error = refused(reason); f.send.mockRejectedValueOnce(error);
  await expect(sendWithQueuedFallback(f.options)).rejects.toBe(error);
  expect(f.tracking.prepare).not.toHaveBeenCalled(); expect(f.send).toHaveBeenCalledOnce();
});
