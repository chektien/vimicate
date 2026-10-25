import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { gatewayContentText } from '../workspace/historyMessageProjection';

/** OpenClaw chat deltas are a cumulative envelope, while each item-preamble
 * has its own durable publication identity. Only a live, nonterminal envelope
 * with an exact ordered item prefix may shed those segments. A terminal reply
 * is taken only from the run lifecycle, never inferred from equal text,
 * a stale canonical answer, or paragraph separators. */
export function uncoveredLiveChat(chat: WorkspaceMessage, rows: WorkspaceMessage[]): WorkspaceMessage {
  if (!isLiveChat(chat) || chat.chatCumulativeText === undefined) return chat;
  const final = exactTerminalReply(chat, rows);
  // Lifecycle terminal text is producer evidence, not the display-normalized
  // chat/history payload. Never resurrect its MEDIA lines or replace the
  // authoritative managed attachments with host-source guesses.
  if (final !== null) return { ...chat, text: gatewayContentText(final), state: 'complete' };
  const preambles = ownedPreambles(chat, rows);
  // A steer-sealed prefix stays above its prompt even in the final frame.
  const steered = preambles.some(row => row.steerSealed);
  if (chat.state === 'complete' && !steered) return chat;
  if (!preambles.length) return chat;
  const raw = chat.chatCumulativeText;
  for (let start = 0; start < preambles.length; start += 1) {
    let remaining = raw;
    let consumed = 0;
    for (let index = start; index < preambles.length; index += 1) {
      const text = preambles[index]!.text;
      if (!text) break;
      if (remaining === text) {
        remaining = '';
        consumed += 1;
        break;
      }
      if (remaining.startsWith(`${text}\n\n`)) remaining = remaining.slice(text.length + 2);
      // A steer can arrive mid-sentence, so its seal needs no paragraph break.
      else if (preambles[index]!.steerSealed && remaining.startsWith(text)) remaining = remaining.slice(text.length).replace(/^\n+/, '');
      else break;
      consumed += 1;
    }
    if (consumed) {
      if (steered) return { ...chat, text: remaining, claudeNativeFullText: raw };
      return remaining === chat.text ? chat : { ...chat, text: remaining };
    }
  }
  return chat;
}

/** A late item or lifecycle receipt may replace a chat row already painted.
 * Recompute from its retained raw envelope, not from its previously cropped
 * text: equal-text finals and replay after a partial refresh must survive. */
export function reconcileChatAfterRunDetail(rows: WorkspaceMessage[], detail: WorkspaceMessage) {
  if (detail.role !== 'narration' && !detail.terminalReplyText) return rows;
  if (!detail.runId || !detail.sessionKey) return rows;
  let changed = false;
  const reconciled = rows.flatMap(row => {
    if (!isLiveChat(row) || row.runId !== detail.runId || row.sessionKey !== detail.sessionKey) return [row];
    const next = uncoveredLiveChat(row, rows);
    if (next === row) return [row];
    changed = true;
    return next.text || next.attachments?.length ? [next] : [];
  });
  return changed ? reconciled : rows;
}

function exactTerminalReply(chat: WorkspaceMessage, rows: WorkspaceMessage[]) {
  const lifecycle = rows.find(row => row.role === 'run' && row.sessionKey === chat.sessionKey
    && row.runId === chat.runId && row.terminalReplyText
    && (!row.transcriptSessionId || !chat.transcriptSessionId || row.transcriptSessionId === chat.transcriptSessionId));
  return lifecycle?.terminalReplyText ?? null;
}

function ownedPreambles(chat: WorkspaceMessage, rows: WorkspaceMessage[]) {
  const seen = new Set<string>();
  return rows.filter(row => row.role === 'narration' && row.runId === chat.runId
    && row.sessionKey === chat.sessionKey
    && (!row.transcriptSessionId || !chat.transcriptSessionId || row.transcriptSessionId === chat.transcriptSessionId)
    && (Boolean(row.narrationItemId) || row.id.startsWith(`live-item-${chat.runId}-`)))
    .filter(row => {
      const identity = row.narrationItemId || row.id;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

function isLiveChat(row: WorkspaceMessage) {
  return row.role === 'assistant' && row.source === 'live' && Boolean(row.runId && row.sessionKey)
    && row.id === `live-chat-${row.runId}`;
}
