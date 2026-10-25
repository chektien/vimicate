export const gatewayOversizedHistoryPlaceholder = '[chat.history omitted: message too large]';

export function historyMessageRecoveryDescriptor(role: string, text: string, metadata: unknown, rawID: string) {
  if (role !== 'assistant' || !(assistantTextIsGatewayTruncated(text) || assistantHistoryOmissionIsRecoverable(text, metadata))) return undefined;
  const sourceMessageId = concreteGatewayMessageID(rawID);
  return sourceMessageId
    ? { sourceMessageId, state: 'available' as const }
    : { sourceMessageId, state: 'unavailable' as const, detail: 'full response unavailable: no concrete Gateway message id' };
}

export function assistantTextIsGatewayTruncated(text: string) {
  return /(?:\.\.\.|…)?\(truncated\)(?:\.\.\.|…)?\s*$/i.test(text.trimEnd());
}

export function assistantHistoryOmissionIsRecoverable(text: string, metadata: unknown) {
  if (!assistantTextIsGatewayOversizedPlaceholder(text) || !record(metadata)) return false;
  return metadata.truncated === true && metadata.reason === 'oversized';
}

export function assistantTextIsGatewayOversizedPlaceholder(text: string) {
  return text === gatewayOversizedHistoryPlaceholder;
}

export function assistantTextIsGatewayIncomplete(text: string) {
  return assistantTextIsGatewayTruncated(text) || assistantTextIsGatewayOversizedPlaceholder(text);
}

export function concreteGatewayMessageID(value: string) {
  const normalized = value.trim();
  return normalized && !/^history-(?:offset|synthetic|[0-9a-z]+)$/i.test(normalized) ? normalized : '';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
