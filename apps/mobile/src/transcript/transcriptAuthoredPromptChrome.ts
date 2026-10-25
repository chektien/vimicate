import type { WorkspaceMessageRole } from '../workspace/workspaceTypes';

export type TranscriptAuthoredPromptChrome = {
  band: boolean;
  active: boolean;
  topEdge: boolean;
  bottomEdge: boolean;
};

/**
 * Authored prompts are navigation landmarks, not chat bubbles. Keep the
 * policy role-based so optimistic, live and restored user turns receive the
 * same band without inspecting or labelling their text.
 */
export function transcriptAuthoredPromptChrome(
  role: WorkspaceMessageRole,
  firstInMessage: boolean,
  lastInMessage: boolean,
  current: boolean,
): TranscriptAuthoredPromptChrome {
  const band = role === 'user';
  return {
    band,
    active: band && current,
    topEdge: band && firstInMessage,
    bottomEdge: band && lastInMessage,
  };
}
