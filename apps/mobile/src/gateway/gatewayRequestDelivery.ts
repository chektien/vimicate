/**
 * Whether a failed Gateway request had already been written to the socket.
 *
 * A request that never left the app is a refusal: the Gateway was never asked,
 * so a caller may withdraw whatever it published on the strength of the call.
 * A request that was written has an *unknown* outcome — the Gateway may have
 * accepted, run and durably stored it before the answer was lost — and no
 * caller may report it as a refusal. Only the transport knows which happened,
 * so it records the fact on the rejection it raises.
 */
const NON_STEERABLE_REASONS = ['tool_authority_mismatch', 'input_visibility_mismatch', 'run_not_ready', 'image_input_unsupported'] as const;
type NonSteerableReason = typeof NON_STEERABLE_REASONS[number];
export type GatewayQueueCandidate = { reason: NonSteerableReason; expectedActiveRunId: string; activeRunId: string };
export type GatewayRequestFailure = Error & { reachedGateway?: boolean; gatewayCode?: string; activeRunInputNotice?: string; runTargetRefusal?: { reason: string; expectedActiveRunId: string }; queueCandidate?: GatewayQueueCandidate };

export function gatewayRequestFailure(message: string, reachedGateway: boolean): GatewayRequestFailure {
  return Object.assign(new Error(message), { reachedGateway });
}

export function gatewayRequestReachedGateway(error: unknown): boolean {
  return error instanceof Error && (error as GatewayRequestFailure).reachedGateway === true;
}

export function gatewayRequestWasRefused(error: unknown): boolean {
  return error instanceof Error && (error as GatewayRequestFailure).reachedGateway === false;
}

/** A negative RPC response normally proves refusal. Active-run controls can
 * instead report an uncertain provider write; keep those prompts unreplayed. */
export function gatewayResponseFailure(value: unknown): GatewayRequestFailure {
  const error = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details as Record<string, unknown> : {};
  const message = typeof error.message === 'string' && error.message ? error.message : 'Gateway request failed';
  const unsupportedControl = error.code === 'INVALID_REQUEST' && /invalid chat.send params/i.test(message) && /steerPolicy|expectedActiveRunId/.test(message);
  const failure = gatewayRequestFailure(unsupportedControl ? 'Gateway runtime update required for safe active-run controls. Your draft was kept.' : message, details.inputDisposition === 'unconfirmed');
  if (typeof error.code === 'string') failure.gatewayCode = error.code;
  if (error.code === 'INVALID_REQUEST' && NON_STEERABLE_REASONS.includes(details.reason as NonSteerableReason) && details.inputDisposition === 'not-dispatched'
    && typeof details.expectedActiveRunId === 'string' && details.expectedActiveRunId.trim()
    && details.expectedActiveRunId === details.activeRunId) {
    failure.queueCandidate = { reason: details.reason as NonSteerableReason, expectedActiveRunId: details.expectedActiveRunId, activeRunId: details.expectedActiveRunId };
  }
  if (details.inputDisposition === 'not-dispatched' && ['active_run_changed', 'no_active_run'].includes(String(details.reason))
    && typeof details.expectedActiveRunId === 'string' && details.expectedActiveRunId.trim()) {
    failure.runTargetRefusal = { reason: String(details.reason), expectedActiveRunId: details.expectedActiveRunId };
  }
  if (details.inputDisposition === 'not-dispatched') {
    if (details.reason === 'tool_authority_mismatch') failure.activeRunInputNotice = 'Message not sent: the active run has different tool permissions. Your draft is kept. Wait for it to finish, or use :interrupt <prompt> to stop it and start a new turn.';
    if (details.reason === 'input_visibility_mismatch') failure.activeRunInputNotice = 'Message not sent: the active run cannot receive messages from this chat. Your draft is kept. Wait for it to finish, or use :interrupt <prompt> to stop it and start a new turn.';
    if (details.reason === 'run_not_ready' && typeof details.expectedActiveRunId === 'string' && details.expectedActiveRunId.trim()
      && details.activeRunId === details.expectedActiveRunId) failure.activeRunInputNotice = 'This run cannot accept messages right now. Your draft is kept. Try again shortly, or use :interrupt <prompt> to stop it and start a new turn.';
    if (failure.activeRunInputNotice) failure.message = failure.activeRunInputNotice;
  }
  return failure;
}

export function gatewayRunTargetRefusal(error: unknown) {
  return error instanceof Error ? (error as GatewayRequestFailure).runTargetRefusal : undefined;
}

/** Only a structured, confirmed refusal from the exact target can become a
 * separate turn. Text matching and uncertain provider writes never qualify. */
export function gatewayQueueCandidate(error: unknown, expectedRunId?: string): GatewayQueueCandidate | undefined {
  if (!(error instanceof Error) || gatewayRequestReachedGateway(error)) return undefined;
  const candidate = (error as GatewayRequestFailure).queueCandidate;
  if (!candidate || !NON_STEERABLE_REASONS.includes(candidate.reason) || typeof candidate.expectedActiveRunId !== 'string'
    || !candidate.expectedActiveRunId.trim() || candidate.activeRunId !== candidate.expectedActiveRunId
    || expectedRunId !== undefined && candidate.expectedActiveRunId !== expectedRunId) return undefined;
  return { ...candidate };
}

export function gatewayRunTruthReadUnavailable(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as GatewayRequestFailure).gatewayCode;
  return code === 'UNAVAILABLE' || (code === 'INVALID_REQUEST' && /unknown method.*vimicate\.runs\.read/i.test(error.message));
}

/** Confirmed input refusals are informational, not a failure of the running task. */
export function gatewayActiveRunInputNotice(error: unknown) {
  return error instanceof Error ? (error as GatewayRequestFailure).activeRunInputNotice : undefined;
}
