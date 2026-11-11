import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { isStaleCumulativePrefix } from './liveMessageConvergence';
import { sealTextDigest } from './sealedRunRetirement';

type Upsert = (rows: WorkspaceMessage[], message: WorkspaceMessage) => WorkspaceMessage[];

/**
 * Claude CLI streams one cumulative live copy per run, and this transport
 * tags none of it as commentary. Text that precedes a tool call is commentary,
 * the same rule saved history applies through a step's `tool_use` stop reason.
 * Mark a Claude CLI run's live text and tool frames where the runtime is
 * known; the wire observer below resolves a tool's mark into the text to seal.
 */
export function markToolBoundaryCandidate(message: WorkspaceMessage, agentRuntime: string | undefined): WorkspaceMessage {
  return agentRuntime === 'claude-cli' && message.source === 'live' && message.runId
    && (message.role === 'tool' && message.id.startsWith(`live-tool-${message.runId}-`)
      || message.role === 'assistant' && message.id === `live-chat-${message.runId}`) ? { ...message, toolBoundaryChatText: '' } : message;
}

/**
 * Wire-order memory of each marked run's latest cumulative live text. The
 * Gateway flushes its chat delta before a tool start, while the publication
 * buffer can let later text overtake the tool row, so the text to seal is
 * fixed when a tool's first frame arrives, not when its row is published.
 * A run's entry ends with its final frame, error or lifecycle end.
 */
export class ToolBoundaryChatTexts {
  private static readonly MAX_RUNS = 16;
  private static readonly MAX_TEXT_LENGTH = 262_144;
  private texts = new Map<string, string>();

  /** Remember a marked live chat frame, or resolve a marked tool frame. Always clears the mark. */
  observe(message: WorkspaceMessage, first: boolean): WorkspaceMessage {
    const key = `${message.sessionKey ?? ''}\u0000${message.runId ?? ''}`;
    if (message.role === 'run' && (message.state === 'complete' || message.state === 'error')) this.texts.delete(key);
    if (message.toolBoundaryChatText === undefined) return message;
    const { toolBoundaryChatText: _mark, ...row } = message;
    if (row.role === 'assistant') {
      const previous = this.texts.get(key);
      this.texts.delete(key);
      const frame = row.state === 'streaming' && !row.attachments?.length ? rawLiveText(row) : '';
      const text = frame && previous && isStaleCumulativePrefix(previous, frame) ? previous : frame;
      if (text && text.length <= ToolBoundaryChatTexts.MAX_TEXT_LENGTH) this.texts.set(key, text);
      while (this.texts.size > ToolBoundaryChatTexts.MAX_RUNS) this.texts.delete(this.texts.keys().next().value ?? '');
      return row;
    }
    const text = first ? this.texts.get(key) : undefined;
    return text ? { ...row, toolBoundaryChatText: text } : row;
  }

  get size() { return this.texts.size; }
  clear() { this.texts.clear(); }
}

/**
 * Seal the run's live text published before this tool as a run-owned
 * narration row in the live copy's slot, then publish the tool below it. Text
 * that already streamed after the tool started continues below the tool.
 * uncoveredLiveChat crops the sealed prefix from later frames, and Claude
 * native convergence retires each seal once saved history covers it.
 * A marked live chat frame only sheds its mark here.
 */
export function upsertSealingToolBoundary(rows: WorkspaceMessage[], incoming: WorkspaceMessage, upsert: Upsert): WorkspaceMessage[] {
  const { toolBoundaryChatText: snapshot, ...tool } = incoming;
  const index = snapshot && tool.runId && !rows.some(row => row.id === tool.id && row.sessionKey === tool.sessionKey)
    ? rows.findIndex(row => row.id === `live-chat-${tool.runId}` && row.sessionKey === tool.sessionKey
      && row.source === 'live' && row.role === 'assistant' && row.state !== 'error' && !row.attachments?.length)
    : -1;
  if (!snapshot || index < 0 || !tool.id.startsWith(`live-tool-${tool.runId}-`)) return upsert(rows, tool);
  const live = rows[index]!;
  const raw = rawLiveText(live);
  // The visible text is the uncovered tail of the raw envelope. A tail that
  // does not reach back to the boundary means the text before it is covered.
  const later = raw.length - snapshot.length;
  if (!raw.startsWith(snapshot) || later > live.text.length) return upsert(rows, tool);
  const text = live.text.slice(0, live.text.length - later).replace(/\n+$/, '');
  if (!text.trim()) return upsert(rows, tool);
  const remainder = live.text.slice(live.text.length - later).replace(/^\n+/, '');
  // The tool's own identity names the seal: a count of surviving seals would
  // reuse an ID once saved history has retired an earlier one.
  const sealed: WorkspaceMessage = {
    id: `live-item-${tool.runId}-tool-${tool.id.slice(`live-tool-${tool.runId}-`.length)}`, role: 'narration', text, source: 'live', state: 'complete', runId: tool.runId!, steerSealed: true,
    sealText: sealTextDigest(text),
    ...(live.sessionKey ? { sessionKey: live.sessionKey } : {}),
    ...(live.timestamp ? { timestamp: live.timestamp } : {}),
    ...(live.transcriptSessionId ? { transcriptSessionId: live.transcriptSessionId } : {}),
  };
  if (rows.some(row => row.id === sealed.id && row.sessionKey === sealed.sessionKey)) return upsert(rows, tool);
  const published = upsert([...rows.slice(0, index), sealed, ...rows.slice(index + 1)], tool);
  // Host-stamped like the tool, so chronology keeps the continuation below it.
  return remainder ? [...published, { ...live, text: remainder, claudeNativeFullText: raw, ...(tool.timestamp ? { timestamp: tool.timestamp } : {}) }] : published;
}

function rawLiveText(chat: WorkspaceMessage) {
  return chat.chatCumulativeText ?? chat.claudeNativeFullText ?? chat.text;
}
