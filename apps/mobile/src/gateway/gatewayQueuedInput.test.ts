import { describe, expect, it, vi } from 'vitest';
import { cancelGatewayQueuedInput, gatewayQueuedInputAck, gatewayQueuedInputFromHistory, readGatewayQueuedInput, type GatewayQueuedInputScope } from './gatewayQueuedInput';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

const scope: GatewayQueuedInputScope = { sessionKey: 'agent:main:work', sessionId: '00000000-0000-4000-a000-000000000128', runId: 'followup-key', agentId: 'main' };
const receipt = { runId: scope.runId, state: 'pending', queued: true };
const history = (inputReceipts: unknown = [receipt], extra = {}) => ({ sessionKey: scope.sessionKey, sessionId: scope.sessionId, inputReceipts, ...extra });
const item = (state: string, extra = {}) => ({ id: 'pending-id', runId: scope.runId, state, acceptedAt: 100, message: { role: 'user' }, ...extra });
const claudeInput = () => ({ role: 'user', content: 'A single accepted followup', timestamp: 100,
  idempotencyKey: `${scope.runId}:user`, __openclaw: { id: 'canonical-input', importedFrom: 'claude-cli',
    cliSessionId: '00000000-0000-4000-b000-000000000113', externalId: 'native-input', recordTimestampMs: 200,
    transcriptPosition: { source: 'sqlite', rawSeq: 23789 } } });

describe('queued user input custody', () => {
  it('retires consumed Claude custody from the exact committed submission without run or acceptance metadata', async () => {
    const page = history([], { messages: [claudeInput()], pendingInputs: { items: [], total: 0 } });
    const projected = messagesFromPayload(page);
    expect(projected[0]?.runId).toBeUndefined(); expect(projected[0]?.inputAcceptedAtMs).toBeUndefined();
    expect(gatewayQueuedInputFromHistory(page, scope)).toEqual({ state: 'consumed', consumedByEventId: 'canonical-input' });
    const request = vi.fn(async () => history([], { messages: [], pendingInputs: { items: [], total: 33, nextBefore: 100 } }));
    expect(await readGatewayQueuedInput({ request }, scope, projected)).toEqual({ state: 'consumed', consumedByEventId: 'canonical-input' });
    expect(request.mock.calls).toHaveLength(1);
  });

  it('does not replace contradictory or malformed custody with an otherwise exact canonical prompt', () => {
    const projected = messagesFromPayload(history([], { messages: [claudeInput()] }));
    for (const payload of [
      history([], { inputReceipts: undefined }), history('malformed'), history([receipt, receipt]), history([{ ...receipt, runId: 'other' }]),
      history([], { sessionId: 'other-generation' }), history([], { pendingInputs: [] }),
      history([], { pendingInputs: { items: [item('interrupted')] } }),
      history([], { pendingInputs: { items: [item('queued', { queued: true })] } }),
      history([], { pendingInputs: { items: [null] } }),
    ]) expect(gatewayQueuedInputFromHistory(payload, scope, projected)).toEqual({ state: 'unknown' });
    expect(gatewayQueuedInputFromHistory(history([receipt]), scope, projected)).toEqual({ state: 'queued' });
    expect(gatewayQueuedInputFromHistory(history([{ runId: scope.runId, state: 'pending', cancelled: true }]), scope, projected))
      .toEqual({ state: 'interrupted', reason: 'cancelled' });
  });
  it('distinguishes early admission from confirmed queue custody', () => {
    expect(gatewayQueuedInputAck({ runId: scope.runId, status: 'started' }, scope.runId)).toEqual({ state: 'accepted' });
    expect(gatewayQueuedInputFromHistory(history(), scope)).toEqual({ state: 'queued' });
    expect(gatewayQueuedInputFromHistory(history([{ runId: scope.runId, state: 'pending' }], {
      pendingInputs: { items: [item('queued')], total: 1 },
    }), scope)).toEqual({ state: 'unknown' });
  });
  it.each([undefined, {}, { runId: 'other', status: 'started' }, { runId: scope.runId, status: 'ok' },
    { runId: scope.runId, status: 'in_flight' }, { runId: scope.runId, status: 'queued' },
    { runId: scope.runId, status: 'started', messageSeq: '1' }, { runId: scope.runId, status: 'started', messageSeq: 0 },
    { runId: scope.runId, status: 'started', interruptedActiveRun: 'true' }, { runId: scope.runId, status: 'started', serverTiming: [] },
  ])('does not mistake an ambiguous ACK for acceptance: %j', payload => {
    expect(gatewayQueuedInputAck(payload, scope.runId)).toEqual({ state: 'unknown' });
  });
  it('returns exact canonical consumption even when the display page excludes it', () => {
    expect(gatewayQueuedInputFromHistory(history([{ runId: scope.runId, state: 'consumed', consumedByEventId: 'canonical-user' }]), scope))
      .toEqual({ state: 'consumed', consumedByEventId: 'canonical-user' });
  });
  it('preserves interrupted and cancelled custody without implying replay', () => {
    expect(gatewayQueuedInputFromHistory(history([{ runId: scope.runId, state: 'pending' }], { pendingInputs: { items: [item('interrupted')] } }), scope))
      .toEqual({ state: 'interrupted', reason: 'interrupted' });
    expect(gatewayQueuedInputFromHistory(history([{ runId: scope.runId, state: 'pending', cancelled: true }]), scope))
      .toEqual({ state: 'interrupted', reason: 'cancelled' });
  });
  it.each([
    history([], { sessionId: 'other-generation' }), history([receipt], { sessionKey: 'another-thread' }),
    history([receipt], { sessionInfo: { sessionId: 'successor' } }), history([receipt], { sessionInfo: { agentId: 'another-agent' } }),
    history([]), history([receipt, receipt]), history([{ ...receipt, runId: 'other' }]), history('invalid'),
    history([{ ...receipt, queued: false }]), history([{ ...receipt, cancelled: true }]), history([{ ...receipt, state: 'failed' }]),
    history([{ runId: scope.runId, state: 'consumed', consumedByEventId: '' }]),
    history([{ runId: scope.runId, state: 'consumed', consumedByEventId: 'event', queued: true }]),
    history([receipt], { pendingInputs: { items: [item('interrupted')] } }),
    history([receipt], { pendingInputs: { items: [item('queued')] } }),
    history([receipt], { pendingInputs: { items: [item('queued', { queued: true }), item('queued', { queued: true })] } }),
    history([receipt], { pendingInputs: [] }),
  ])('fails closed for missing, contradictory, malformed or wrong-generation proof: %j', payload => {
    expect(gatewayQueuedInputFromHistory(payload, scope)).toEqual({ state: 'unknown' });
  });
  it('requests exact input receipts independently of display pagination', async () => {
    // Native chat.history rejects sessionId without messageId; anchored
    // history in turn returns no input receipts. Read current, then fence it.
    const request = vi.fn(async (_method, params) => {
      if (params.sessionId !== undefined && params.messageId === undefined) throw new Error('sessionId requires messageId');
      return history();
    });
    expect(await readGatewayQueuedInput({ request }, scope)).toEqual({ state: 'queued' });
    expect(request).toHaveBeenCalledWith('chat.history', {
      sessionKey: scope.sessionKey, agentId: scope.agentId, inputRunIds: [scope.runId], limit: 1,
    });
  });
  it('rejects a successor generation returned by a current-history receipt read', async () => {
    const request = vi.fn().mockResolvedValue(history([receipt], { sessionId: 'successor' }));
    expect(await readGatewayQueuedInput({ request }, scope)).toEqual({ state: 'unknown' });
    expect(await cancelGatewayQueuedInput({ request }, scope)).toEqual({ state: 'unknown' });
    expect(request.mock.calls.every(([method]) => method === 'chat.history')).toBe(true);
  });
  it('does not issue a request with missing concrete identity', async () => {
    const request = vi.fn();
    expect(await readGatewayQueuedInput({ request }, { ...scope, sessionId: '' })).toEqual({ state: 'unknown' });
    expect(request).not.toHaveBeenCalled();
  });
  it('withdraws only the exact proven queued input and requires exact abort confirmation', async () => {
    const request = vi.fn().mockResolvedValueOnce(history()).mockResolvedValueOnce({ ok: true, aborted: true, runIds: [scope.runId] });
    expect(await cancelGatewayQueuedInput({ request }, scope)).toEqual({ state: 'cancelled' });
    expect(request).toHaveBeenLastCalledWith('chat.abort', { sessionKey: scope.sessionKey, agentId: scope.agentId, runId: scope.runId, discardPendingInput: true });
  });
  it.each([{ ok: true, aborted: false, runIds: [] }, { ok: true, aborted: true, runIds: ['other'] },
    { ok: true, aborted: true, runIds: [scope.runId, 'other'] }, { aborted: true, runIds: [scope.runId] }, null,
  ])('does not confirm cancellation after an uncertain or racing withdrawal: %j', result => {
    const request = vi.fn().mockResolvedValueOnce(history()).mockResolvedValueOnce(result);
    return expect(cancelGatewayQueuedInput({ request }, scope)).resolves.toEqual({ state: 'unknown' });
  });
  it('does not abort staged-only or interrupted input', async () => {
    const request = vi.fn().mockResolvedValue(history([{ runId: scope.runId, state: 'pending' }]));
    expect(await cancelGatewayQueuedInput({ request }, scope)).toEqual({ state: 'unknown' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('preserves transport failure provenance for the caller instead of reporting a successful cancellation', async () => {
    const failure = new Error('connection lost');
    const request = vi.fn().mockResolvedValueOnce(history()).mockRejectedValueOnce(failure);
    await expect(cancelGatewayQueuedInput({ request }, scope)).rejects.toBe(failure);
  });
});

it('finds exact committed image input behind newer activity when the app tail is absent', async () => {
  const committed = { ...claudeInput(), __openclaw: { ...claudeInput().__openclaw,
    media: [{ url: 'media://fixture.png', kind: 'image', sizeBytes: 866050 }] } };
  const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => history([], {
    messages: params?.limit === 1 ? [{ role: 'assistant', content: 'later activity' }] : [committed, { role: 'assistant', content: 'later activity' }],
    pendingInputs: { items: [], total: 0 },
  }));
  expect(await readGatewayQueuedInput({ request }, scope)).toEqual({ state: 'consumed', consumedByEventId: 'canonical-input' });
  expect(request.mock.calls.map(call => call[1]?.limit)).toEqual([1, 64]);
  expect(request.mock.calls.every(call => call[0] === 'chat.history')).toBe(true);
});

it('bounds missing-receipt lookup and never turns wrong-generation, cancelled or absent proof into pickup', async () => {
  for (const second of [history([], { messages: [] }), history([], { sessionId: 'other', messages: [claudeInput()] }),
    history([{ runId: scope.runId, state: 'pending', cancelled: true }], { messages: [claudeInput()] })]) {
    const request = vi.fn().mockResolvedValueOnce(history([])).mockResolvedValueOnce(second);
    const result = await readGatewayQueuedInput({ request }, scope);
    expect(result.state).not.toBe('consumed'); expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([method]) => method === 'chat.history')).toBe(true);
  }
  for (const first of [history([], { sessionId: 'other' }), history([], { pendingInputs: { items: [null] } }),
    history([], { pendingInputs: { items: [item('interrupted')] } }), history([receipt])]) {
    const request = vi.fn().mockResolvedValue(first);
    await readGatewayQueuedInput({ request }, scope); expect(request).toHaveBeenCalledTimes(1);
  }
});
it('does not cancel an input discovered committed by the bounded lookup', async () => {
  const request = vi.fn().mockResolvedValueOnce(history([])).mockResolvedValueOnce(history([], { messages: [claudeInput()] }));
  expect(await cancelGatewayQueuedInput({ request }, scope)).toEqual({ state: 'unknown' });
  expect(request.mock.calls.every(([method]) => method === 'chat.history')).toBe(true);
});
