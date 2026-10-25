import type { SessionRunRegistry } from './sessionRunRegistry';

type StopClient = { abort(sessionKey: string, runId: string): Promise<unknown> };

/** Shared receipt owner for the Stop button and :stop. Transport success alone
 * is not cancellation evidence, and no receipt proves lifecycle settlement.
 */
export async function requestGatewayStop(client: StopClient, registry: SessionRunRegistry, sessionKey: string, runId: string) {
  const settle = registry.beginStopRequest(sessionKey, runId);
  try {
    const payload = await client.abort(sessionKey, runId);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Stop result is unconfirmed. Refresh this thread to check its run.');
    const receipt = payload as Record<string, unknown>;
    if (receipt.ok !== true || typeof receipt.aborted !== 'boolean' || !Array.isArray(receipt.runIds)
      || receipt.runIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('Stop result is unconfirmed. Refresh this thread to check its run.');
    const confirmed = receipt.aborted && receipt.runIds.includes(runId);
    settle(confirmed);
    return confirmed ? 'Stop accepted.' : 'Gateway did not stop this run.';
  } finally {
    // Idempotent settlement also retires rejected, malformed and lost receipts.
    settle(false);
  }
}
