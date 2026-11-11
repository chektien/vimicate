/** OpenClaw 2026.10.10 steers natively. With the local steer-outcome-ack
 * Gateway patch its acknowledgement says whether the running turn took a
 * steered prompt. "not-steered" is final: the prompt runs as its own turn,
 * after the current one if that is still running. "steered" is the runtime's
 * acceptance; a run ending in the same instant can still return the prompt to
 * its own turn. Absent or unknown values are reported as unknown. */
export type GatewaySteerOutcome = 'steered' | 'not-steered';

export function gatewaySteerOutcome(payload: unknown): GatewaySteerOutcome | undefined {
  const outcome = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).steerOutcome : undefined;
  return outcome === 'steered' || outcome === 'not-steered' ? outcome : undefined;
}

export function gatewaySteerOutcomeNotice(payload: unknown): string {
  switch (gatewaySteerOutcome(payload)) {
    case 'steered': return 'Steered into the running turn.';
    case 'not-steered': return 'Could not steer. Queued to run as its own turn after the current one.';
    default: return 'Sent while a run was active. The Gateway did not report whether it steered or queued.';
  }
}
