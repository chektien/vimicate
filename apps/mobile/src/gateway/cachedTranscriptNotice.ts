import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { isClientFailureIdentity } from './clientFailureIdentity';

// Keep the complete action inside the ordinary 140-character machine headline.
export const CACHED_NOTICE_PREFIX = 'Cached notice, not current status. Refresh and check this conversation. Do not resend while delivery is unknown.\nTechnical details\n';

export function isCachedTranscriptNotice(message: Pick<WorkspaceMessage, 'role' | 'text' | 'cachedNotice'>) {
  return message.cachedNotice === true && message.role === 'system' && message.text.startsWith(CACHED_NOTICE_PREFIX);
}

/** Old caches kept projected text but lost the custom event's typed evidence.
 * Preserve those bytes without guessing failure, input custody or current state.
 * Authored/local rows and live response fragments are not disposable previews. */
export function legacyTranscriptNoticePreview(message: WorkspaceMessage): WorkspaceMessage {
  if (isCachedTranscriptNotice(message)) return message;
  const legacyHistory = message.source === 'history' && (message.role === 'system' || message.role === 'error');
  if (!legacyHistory && !isClientFailure(message)) return message;
  const { state: _oldState, runFailure: _oldFailure, ...retained } = message;
  return { ...retained, role: 'system', cachedNotice: true, text: CACHED_NOTICE_PREFIX + message.text };
}

function isClientFailure(message: WorkspaceMessage) {
  if (message.source !== 'live' || message.role !== 'error' || !message.sessionKey) return false;
  return isClientFailureIdentity(message);
}
