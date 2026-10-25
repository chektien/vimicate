import { useEffect, type RefObject } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { SessionRunRegistry } from './sessionRunRegistry';
import { reconcileNewerTranscriptCompletion } from './transcriptRunTruth';

type Input = {
  messageSessionKey: string;
  visibleMessages: readonly WorkspaceMessage[];
  runRegistry: RefObject<SessionRunRegistry>;
  sessionMessages: (sessionKey: string) => WorkspaceMessage[];
  persistRuns: () => void;
  publishSelectedRun: (sessionKey?: string) => void;
};

/** Reconciles a stale terminal marker from the newest canonical transcript. */
export function useTranscriptRunTruth({ messageSessionKey, visibleMessages, runRegistry, sessionMessages, persistRuns, publishSelectedRun }: Input) {
  useEffect(() => {
    if (!messageSessionKey) return;
    if (!reconcileNewerTranscriptCompletion(runRegistry.current, messageSessionKey, sessionMessages(messageSessionKey))) return;
    persistRuns();
    publishSelectedRun(messageSessionKey);
  }, [messageSessionKey, persistRuns, publishSelectedRun, runRegistry, sessionMessages, visibleMessages]);
}
