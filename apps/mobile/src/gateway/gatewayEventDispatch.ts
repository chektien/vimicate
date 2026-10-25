import type { GatewayFrame } from './gatewayEvents';

export function dispatchGatewayEventSafely(
  frame: GatewayFrame,
  publish: (frame: GatewayFrame) => void,
  onFailure: (error: unknown) => void,
) {
  try {
    publish(frame);
    return true;
  } catch (error) {
    try { onFailure(error); } catch { /* Preserve the original containment boundary. */ }
    return false;
  }
}
