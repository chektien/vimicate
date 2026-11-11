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
  // The steering prompt's own identity names the seal. A count of surviving
  // seals would reuse an ID once saved history has retired an earlier one.
  const sealed: WorkspaceMessage[] = live.text.trim() ? [{
    id: `live-item-${runId}-steer-${prompt.idempotencyKey ?? prompt.id}`, role: 'narration', text: live.text, source: 'live', state: 'complete', runId, steerSealed: true,
    ...(live.sessionKey ? { sessionKey: live.sessionKey } : {}),
    ...(live.timestamp ? { timestamp: live.timestamp } : {}),
    ...(live.transcriptSessionId ? { transcriptSessionId: live.transcriptSessionId } : {}),
  }] : [];
  // The continuation answers the steering prompt, so it carries no clock of
  // its own. The device clock that stamped the prompt is not host chronology,
  // and the live copy's earlier host time would sort it above the prompt.
  // Refresh places an untimed continuation by its run and publication slot.
  const { timestamp: _earlier, ...untimed } = live;
  const continued: WorkspaceMessage = { ...untimed, text: '' };
  return [...rows.slice(0, index), ...sealed, ...rows.slice(index + 1), prompt, continued];
}
