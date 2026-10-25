import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/**
 * Claude CLI keeps one cumulative live copy per run, and its commentary only
 * reaches history when the turn ends. When a prompt is steered into the
 * running turn, seal the text so far as a run-owned narration row above the
 * prompt and continue the live copy below it. uncoveredLiveChat crops the
 * sealed prefix from later frames; Claude native convergence retires both at
 * the end of the turn.
 */
export function sealLiveChatForSteer(rows: WorkspaceMessage[], prompt: WorkspaceMessage, runId: string): WorkspaceMessage[] {
  const id = `live-chat-${runId}`;
  const index = runId ? rows.findIndex(row => row.id === id && row.sessionKey === prompt.sessionKey
    && row.source === 'live' && row.role === 'assistant') : -1;
  if (index < 0) return [...rows, prompt];
  const live = rows[index]!;
  const count = rows.filter(row => row.steerSealed && row.runId === runId && row.sessionKey === prompt.sessionKey).length;
  const sealed: WorkspaceMessage[] = live.text.trim() ? [{
    id: `live-item-${runId}-steer-${count + 1}`, role: 'narration', text: live.text, source: 'live', state: 'complete', runId, steerSealed: true,
    ...(live.sessionKey ? { sessionKey: live.sessionKey } : {}),
    ...(live.timestamp ? { timestamp: live.timestamp } : {}),
    ...(live.transcriptSessionId ? { transcriptSessionId: live.transcriptSessionId } : {}),
  }] : [];
  // Client-stamped like the prompt, so chronology keeps it below the prompt.
  const continued: WorkspaceMessage = { ...live, text: '', ...(prompt.timestamp ? { timestamp: prompt.timestamp } : {}) };
  return [...rows.slice(0, index), ...sealed, ...rows.slice(index + 1), prompt, continued];
}
