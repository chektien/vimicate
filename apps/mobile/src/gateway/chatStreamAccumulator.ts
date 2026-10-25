import type { GatewayFrame } from './gatewayEvents';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : '';
const MAX_RUNS = 64;

/**
 * Port of OpenClaw gateway-client mergeChatStreamMessage (2026.9.8). A frame
 * with `message` is a snapshot; a `deltaText` frame appends to the last text
 * block, or replaces it with `replace: true`; it needs a baseline otherwise.
 */
export function mergeChatStreamMessage(previous: unknown, payload: Record<string, unknown>): unknown {
  if (payload.message !== undefined) return payload.message;
  const delta = payload.deltaText;
  if (typeof delta !== 'string') return previous;
  const replace = payload.replace === true;
  if (!delta && !replace) return previous;
  if (!isRecord(previous) && !replace) return undefined;
  const message: Record<string, unknown> = isRecord(previous) ? previous : { role: 'assistant' };
  if (typeof message.content === 'string') return { ...message, content: replace ? delta : message.content + delta };
  const content = Array.isArray(message.content) ? [...message.content] : [];
  const isText = (block: unknown) => isRecord(block) && block.type === 'text';
  if (replace) return { ...message, content: [{ type: 'text', text: delta }, ...content.filter(block => !isText(block))] };
  const index = content.findLastIndex(isText);
  const block = content[index];
  if (isRecord(block) && isText(block)) content[index] = { ...block, text: `${typeof block.text === 'string' ? block.text : ''}${delta}` };
  else content.push({ type: 'text', text: delta });
  return { ...message, content };
}

/**
 * Since 2026.9.8 the Gateway sends a run's full chat `message` once and then
 * only `deltaText`. Restore the cumulative message on every chat frame so the
 * existing projection keeps working; without it the live row froze on the
 * first words ("Both of") until history caught up.
 */
export class ChatStreamAccumulator {
  private readonly messages = new Map<string, unknown>();

  normalize(frame: GatewayFrame): GatewayFrame {
    if (frame.event !== 'chat') return frame;
    const payload = record(frame.payload);
    const sessionKey = text(payload.sessionKey); const runId = text(payload.runId);
    if (!sessionKey || !runId) return frame;
    const key = `${sessionKey}\u0000${runId}`;
    const state = text(payload.state).toLowerCase();
    const merged = mergeChatStreamMessage(this.messages.get(key), payload);
    if (state === 'delta' || state === 'streaming') this.remember(key, merged);
    else if (['final', 'complete', 'completed', 'error', 'failed', 'aborted'].includes(state)) this.messages.delete(key);
    if (payload.message !== undefined || merged === undefined) return frame;
    return { ...frame, payload: { ...payload, message: merged } };
  }

  clear() { this.messages.clear(); }

  private remember(key: string, message: unknown) {
    this.messages.delete(key);
    if (message === undefined) return;
    this.messages.set(key, message);
    while (this.messages.size > MAX_RUNS) this.messages.delete(this.messages.keys().next().value!);
  }
}
