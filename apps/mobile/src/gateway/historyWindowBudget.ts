import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export const OLDER_REVIEW_BYTE_LIMIT = 4 * 1024 * 1024;

export function historyMessageBytes(message: WorkspaceMessage) {
  return JSON.stringify(message).length * 2;
}

export function olderReviewBytes(messages: WorkspaceMessage[]) {
  return messages.reduce((bytes, message) => bytes + historyMessageBytes(message), 0);
}
