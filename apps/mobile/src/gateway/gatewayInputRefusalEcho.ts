import { gatewayActiveRunInputNotice, gatewayResponseFailure } from './gatewayRequestDelivery';

type RefusalScope = { sessionKey: string; runId: string; expectedActiveRunId: string };
type Echo = { message: string; expiresAt: number };
const MAX_ECHOES = 64;
const ECHO_TTL_MS = 60_000;

/** Capture only identities, never prompt/attachment content. */
export function gatewayInputRefusalScope(method: string, params?: Record<string, unknown>): RefusalScope | undefined {
  if (method !== 'chat.send' || params?.queueMode !== 'steer' || params.steerPolicy !== 'require-active') return;
  const { sessionKey, idempotencyKey, expectedActiveRunId } = params;
  if (![sessionKey, idempotencyKey, expectedActiveRunId].every(nonempty)) return;
  return { sessionKey: sessionKey as string, runId: idempotencyKey as string, expectedActiveRunId: expectedActiveRunId as string };
}

/** The native handler responds with the structured refusal before broadcasting
 * its raw error for the same client operation. Submission owns that refusal
 * (including any queued fallback); the echo must not become a second failure.
 * This never authorizes a send, and unmatched/uncertain failures stay visible. */
export class GatewayInputRefusalEcho {
  private echoes = new Map<string, Echo>();
  clear() { this.echoes.clear(); }
  record(scope: RefusalScope | undefined, response: Record<string, unknown>, now = Date.now()) {
    this.prune(now);
    const error = record(response.error); const details = record(error.details); const payload = record(response.payload);
    if (!scope || response.ok !== false || error.code !== 'INVALID_REQUEST' || !nonempty(error.message)
      || details.inputDisposition !== 'not-dispatched' || details.expectedActiveRunId !== scope.expectedActiveRunId
      || details.activeRunId !== scope.expectedActiveRunId || payload.runId !== scope.runId
      || !gatewayActiveRunInputNotice(gatewayResponseFailure(error))) return;
    this.echoes.set(key(scope.sessionKey, scope.runId), { message: `ActiveSteerRejectedError: ${error.message}`, expiresAt: now + ECHO_TTL_MS });
    while (this.echoes.size > MAX_ECHOES) this.echoes.delete(this.echoes.keys().next().value!);
  }
  matches(frame: Record<string, unknown>, now = Date.now()) {
    this.prune(now);
    const payload = record(frame.payload);
    if (frame.type !== 'event' || frame.event !== 'chat' || payload.state !== 'error'
      || !nonempty(payload.sessionKey) || !nonempty(payload.runId)) return false;
    const echo = this.echoes.get(key(payload.sessionKey, payload.runId));
    return Boolean(echo && payload.errorMessage === echo.message);
  }
  private prune(now: number) { for (const [id, echo] of this.echoes) if (echo.expiresAt <= now) this.echoes.delete(id); }
}
function key(sessionKey: string, runId: string) { return JSON.stringify([sessionKey, runId]); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
