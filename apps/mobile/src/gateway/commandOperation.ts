import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export function beginCommandOperation(messages: WorkspaceMessage[], id: string, sessionKey: string, label: string) {
  return [...messages, commandOperationMessage(id, sessionKey, `${label} — loading…`, 'streaming')];
}

export function settleCommandOperation(messages: WorkspaceMessage[], id: string, text: string, failed = false) {
  return messages.map((message) => message.id === id ? { ...message, role: 'command' as const, text, state: failed ? 'error' as const : 'complete' as const } : message);
}

function commandOperationMessage(id: string, sessionKey: string, text: string, state: 'streaming' | 'complete'): WorkspaceMessage {
  return { id, role: 'command', text, sessionKey, source: 'live', state };
}
