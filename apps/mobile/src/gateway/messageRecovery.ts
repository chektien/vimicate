import { type WorkspaceAttachment, type WorkspaceMessage } from '../workspace/workspaceTypes';
import { gatewayAttachments, gatewayContentText, messagesFromPayload } from '../workspace/historyMessageProjection';
import { assistantTextIsGatewayIncomplete, assistantTextIsGatewayOversizedPlaceholder } from './messageCompleteness';

/** Loading is owned by a live request, never by a stored transcript row. */
export function inactiveMessageRecovery(recovery: WorkspaceMessage['recovery']): WorkspaceMessage['recovery'] {
  return recovery?.state === 'loading' ? { sourceMessageId: recovery.sourceMessageId, state: 'available' } : recovery;
}

export function recoveredAssistantContent(payload: Record<string, unknown>, workspacePath = '') {
  const source = record(payload.message) || record(payload.item) || record(payload.result) || payload;
  const content = source.content ?? source.text ?? source.message ?? source.body;
  return { text: gatewayContentText(content), attachments: gatewayAttachments(source, workspacePath) };
}

export function terminalRecoveryDetail(payload: Record<string, unknown>) {
  if (payload.ok !== false) return undefined;
  switch (payload.unavailableReason) {
    case 'not_found': return 'full response unavailable: message was not found';
    case 'not_visible': return 'full response unavailable: message is not visible';
    case 'oversized': return 'full response unavailable: message is too large to return';
    default: return 'full response unavailable';
  }
}

/** Use the history projector for structured tool traffic, retaining its rows and media. */
export function recoveredToolRows(message: WorkspaceMessage, payload: Record<string, unknown>, sessionKey: string, workspacePath = '') {
  const source = record(payload.message) || record(payload.item) || record(payload.result);
  if (!source) return [];
  const rows = messagesFromPayload({ sessionKey, messages: [source] }, workspacePath);
  if (!rows.some(row => row.role === 'tool')) return [];
  return rows.map((row, index): WorkspaceMessage => {
    const { recovery: _priorRecovery, ...base } = message;
    return {
      ...base, ...row, id: index === 0 ? message.id : `${message.id}#tool-${index}`,
      ...(index === 0 ? { recovery: { ...message.recovery!, state: 'recovered' as const } } : {}),
    };
  });
}

export function messageByApplyingRecovery(message: WorkspaceMessage, text: string, attachments: WorkspaceAttachment[]) {
  const mergedAttachments = mergeAttachments(message.attachments ?? [], attachments);
  const priorContentLength = assistantTextIsGatewayOversizedPlaceholder(message.text)
    ? 0 : message.text.replace(/(?:\.\.\.|…)?\(truncated\)(?:\.\.\.|…)?\s*$/i, '').length;
  const fuller = text.trim().length > priorContentLength && !assistantTextIsGatewayIncomplete(text);
  if (!fuller) return { ...message, recovery: { ...message.recovery!, state: 'failed' as const, detail: 'full response is not available yet · tap to retry' } };
  return { ...message, text, ...(mergedAttachments.length ? { attachments: mergedAttachments } : {}), recovery: { ...message.recovery!, state: 'recovered' as const } };
}

function mergeAttachments(current: WorkspaceAttachment[], recovered: WorkspaceAttachment[]) {
  const result = [...current]; const seen = new Set(current.map(identity));
  for (const attachment of recovered) if (!seen.has(identity(attachment))) { result.push(attachment); seen.add(identity(attachment)); }
  return result;
}
function identity(attachment: WorkspaceAttachment) { return `${attachment.mimeType}\u0000${attachment.uri ?? ''}\u0000${attachment.filename}`; }
function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
