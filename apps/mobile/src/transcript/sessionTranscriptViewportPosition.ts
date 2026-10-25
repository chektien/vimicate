import { transcriptLineAt, type TranscriptBuffer } from './transcriptVim';

/** A visible review anchor is not necessarily the offscreen keyboard cursor. */
export type SessionTranscriptViewportPosition = {
  messageId: string;
  lineInMessage: number;
  viewPosition: number;
  viewportOwned: boolean;
};

export function captureSessionTranscriptViewportPosition(
  buffer: TranscriptBuffer, sourceRow: number, viewPosition: number | null | undefined, viewportOwned: boolean,
): SessionTranscriptViewportPosition | null {
  if (viewPosition === null || viewPosition === undefined || !Number.isFinite(viewPosition)) return null;
  const line = transcriptLineAt(buffer, sourceRow);
  return line ? { messageId: line.messageId, lineInMessage: line.lineInMessage,
    viewPosition: Math.max(0, Math.min(1, viewPosition)), viewportOwned } : null;
}

export function resolveSessionTranscriptViewportPosition(buffer: TranscriptBuffer, position: SessionTranscriptViewportPosition | undefined) {
  if (!position) return null;
  const messageIndex = buffer.messages?.findIndex(message => message.id === position.messageId) ?? -1;
  const first = buffer.firstRowByMessage[messageIndex];
  if (first === undefined) return null;
  const row = first + position.lineInMessage;
  const line = transcriptLineAt(buffer, row);
  return line?.messageId === position.messageId && line.lineInMessage === position.lineInMessage ? row : null;
}
