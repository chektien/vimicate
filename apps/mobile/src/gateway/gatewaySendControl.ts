import { gatewayUnsupportedActiveRunControl } from './gatewayRequestDelivery';
import type { GatewayPromptAttachment } from '../prompt/promptAttachments';

export type GatewaySendControl =
  | { queueMode: 'steer'; steerPolicy: 'require-active'; expectedActiveRunId: string }
  | { queueMode: 'interrupt'; expectedActiveRunId: string }
  | { queueMode: 'followup'; sessionId: string };

/** An explicit control request must name the run the person saw. Never fall
 * back to an unfenced session-wide cancellation. Followup is a separate user
 * turn, not steering and not authority to interrupt the current owner. */
export function gatewaySendControlFields(control?: 'steer' | GatewaySendControl) {
  if (!control) return {};
  if (control === 'steer') return { queueMode: control }; // Native async-answer delivery.
  if (control.queueMode === 'followup') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(control.sessionId)) throw new Error('Refresh this thread before queueing its next turn.');
    return { queueMode: 'followup', sessionId: control.sessionId };
  }
  if (!control.expectedActiveRunId.trim()) throw new Error('Refresh this thread before controlling its active run.');
  return control.queueMode === 'interrupt'
    ? { queueMode: 'interrupt', expectedActiveRunId: control.expectedActiveRunId }
    : { queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: control.expectedActiveRunId };
}

/** A new turn, a followup and an interrupt are acknowledged at admission. A
 * steer is acknowledged when the active run adopts it. Claude CLI adopts at
 * its next tool boundary, so that answer can trail a long-running tool. */
export function chatSendAckTimeoutMs(control?: 'steer' | GatewaySendControl) {
  return control === 'steer' || control?.queueMode === 'steer' ? 620_000 : 35_000;
}

export function chatSendParams(sessionKey: string, message: string, attachments: GatewayPromptAttachment[], idempotencyKey: string, control?: 'steer' | GatewaySendControl, replyToId?: string) {
  return {
    sessionKey, message, deliver: false, timeoutMs: 0, idempotencyKey, ...(replyToId ? { replyToId } : {}), ...gatewaySendControlFields(control),
    ...(attachments.length ? { attachments: attachments.map((attachment) => ({ type: 'file', mimeType: attachment.mimeType, fileName: attachment.filename, content: attachment.dataBase64 })) } : {}),
  };
}

export function activeRunSendControl(runId: string, interrupt: boolean): GatewaySendControl {
  return interrupt ? { queueMode: 'interrupt', expectedActiveRunId: runId }
    : { queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: runId };
}


/** OpenClaw 2026.10.10 dropped the run-fenced steer fields and steers natively.
 * Only steering degrades; a fenced interrupt never becomes an unfenced one.
 * A schema refusal precedes admission, so the retry reuses an unused
 * idempotency key. The refusal is remembered only for that Gateway endpoint. */
export class FencedSteerSupport {
  private unsupportedGateway: string | undefined;
  send<T>(gateway: string | undefined, control: 'steer' | GatewaySendControl | undefined, sendWith: (control?: 'steer' | GatewaySendControl) => Promise<T>): Promise<T> {
    gatewaySendControlFields(control); // An empty fence still fails before any frame.
    const native = control && control !== 'steer' && control.queueMode === 'steer';
    if (native && gateway && this.unsupportedGateway === gateway) return sendWith('steer');
    return sendWith(control).catch((error: unknown) => {
      if (!native || !gatewayUnsupportedActiveRunControl(error)) throw error;
      this.unsupportedGateway = gateway; return sendWith('steer');
    });
  }
}
