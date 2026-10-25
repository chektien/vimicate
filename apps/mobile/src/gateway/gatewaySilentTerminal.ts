import { gatewayContentText } from '../workspace/historyMessageProjection';
import { assistantProtocolTextIsSilent } from './assistantProtocolProjection';

export function gatewayFrameHasSilentAssistant(frame: Record<string, unknown>) {
  if (frame.event !== 'chat') return false;
  const payload = record(frame.payload);
  if (String(payload.state ?? '').toLocaleLowerCase() !== 'final') return false;
  const message = record(payload.message);
  return assistantProtocolTextIsSilent(gatewayContentText(message.content ?? payload.message));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
