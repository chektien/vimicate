import type { GatewayPromptAttachment } from '../prompt/promptAttachments';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export function commandMessage(sessionKey: string, text: string, role: WorkspaceMessage['role'] = 'command'): WorkspaceMessage {
  const timestamp = String(Date.now());
  return { id: `command-${timestamp}-${Math.random().toString(36).slice(2)}`, role: role === 'error' ? 'command' : role, text, timestamp, sessionKey, source: 'live', state: role === 'error' ? 'error' : 'complete' };
}

export function removeRunLifecycle(messages: WorkspaceMessage[], sessionKey: string, runId: string) {
  return messages.filter((message) => !(message.role === 'run' && message.sessionKey === sessionKey && (!runId || message.runId === runId)));
}

export function localPromptMessage(id: string, idempotencyKey: string, sessionKey: string, text: string, attachments: Array<Pick<GatewayPromptAttachment, 'id' | 'filename' | 'mimeType' | 'byteCount' | 'uri'>>, runId = ''): WorkspaceMessage {
  return { id, role: 'user', text, timestamp: String(Date.now()), sessionKey, source: 'local', idempotencyKey, ...(runId ? { runId } : {}), ...(attachments.length ? { attachments: attachments.map((attachment) => ({ id: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType, byteCount: attachment.byteCount, ...(attachment.uri ? { uri: attachment.uri } : {}) })) } : {}) };
}
