import { transcriptLineAt, type TranscriptBuffer } from './transcriptVim';

/** A visible review anchor is not necessarily the offscreen keyboard cursor. */
export type SessionTranscriptViewportPosition = {
  messageId: string;
  lineInMessage: number;
  endGap?: number;
  rowOffset: number;
};

export function captureSessionTranscriptViewportPosition(
  buffer: TranscriptBuffer, sourceRow: number, rowOffset: number | null | undefined,
): SessionTranscriptViewportPosition | null {
  if (rowOffset === null || rowOffset === undefined || !Number.isFinite(rowOffset)) return null;
  const line = transcriptLineAt(buffer, sourceRow);
  return line ? { messageId: line.messageId, lineInMessage: line.lineInMessage,
    rowOffset } : null;
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

/** The viewport publishes this only from its outgoing committed dataset. */
export type SessionViewportCapture = { kind: 'tail' } | {
  kind: 'anchor'; sourceRow: number; rowOffset: number; endGap: number; anchor?: Pick<SessionTranscriptViewportPosition, 'messageId' | 'lineInMessage'>;
};
export type SessionViewportEntry = { kind: 'tail' } | {
  kind: 'anchor'; sourceRow: number; rowOffset: number;
};
