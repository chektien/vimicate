import { useRef, type MutableRefObject } from 'react';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import type { OpenClawClient, GatewayStatus } from './OpenClawClient';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { SessionRunRegistry } from './sessionRunRegistry';
import type { useGatewaySubmission } from './useGatewaySubmission';
import { useAsyncGatewayQuestions } from './useAsyncGatewayQuestions';
import { useGatewayQueuedPrompts } from './useGatewayQueuedPrompts';

/** Compose the two independently acknowledged input surfaces under the same
 * endpoint, scene and conversation authority. Neither owns the active run. */
export function useGatewayConversationInputs(client: OpenClawClient, status: GatewayStatus, endpoint: string,
  authority: MutableRefObject<HistoryPublicationAuthority>, runRegistry: MutableRefObject<SessionRunRegistry>,
  selectedKey: string, projects: WorkspaceProject[], messages: WorkspaceMessage[], latestMessages: WorkspaceMessage[] | null,
  onStopConfirmed?: (sessionKey: string) => void) {
  const asyncSubmit = useRef<ReturnType<typeof useGatewaySubmission>>(async () => false);
  const asyncQuestions = useAsyncGatewayQuestions({ messages, latestMessages, endpoint, status, authority, submit: asyncSubmit });
  const queuedPrompts = useGatewayQueuedPrompts({ client, status, endpoint, authority, runRegistry,
    selectedSessionKey: selectedKey, selectedSessionId: projects.find(project => project.sessionKey === selectedKey)?.sessionId ?? '',
    messages: latestMessages ?? messages, ...(onStopConfirmed ? { onStopConfirmed } : {}) });
  return { asyncSubmit, asyncQuestions, queuedPrompts };
}
