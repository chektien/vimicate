import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptMessageIsFoldedByDefault, transcriptSourceLineCount } from './transcriptRowBudget';

export type TranscriptLine = {
  messageId: string;
  messageIndex: number;
  lineInMessage: number;
  role: WorkspaceMessage['role'];
  text: string;
};

export type TranscriptBuffer = {
  lines: TranscriptLine[];
  firstRowByMessage: number[];
  lastRowByMessage: number[];
  messages?: readonly WorkspaceMessage[];
};

export function createTranscriptBuffer(messages: WorkspaceMessage[]): TranscriptBuffer {
  const lines: TranscriptLine[] = [];
  const firstRowByMessage: number[] = [];
  const lastRowByMessage: number[] = [];
  messages.forEach((message, messageIndex) => {
    appendTranscriptMessage(lines, firstRowByMessage, lastRowByMessage, message, messageIndex);
  });
  return { lines, firstRowByMessage, lastRowByMessage, messages };
}

/**
 * Appending an optimistic prompt must not split and reconstruct all existing
 * tool output. Keep the prior immutable buffer and append only the changed
 * suffix, while folded messages retain canonical coordinates sparsely.
 */
export function updatedTranscriptBuffer(
  previousMessages: readonly WorkspaceMessage[],
  previous: TranscriptBuffer,
  messages: readonly WorkspaceMessage[],
): TranscriptBuffer {
  if (messages === previousMessages) return previous;
  let sharedPrefix = 0;
  while (
    sharedPrefix < previousMessages.length
    && sharedPrefix < messages.length
    && previousMessages[sharedPrefix] === messages[sharedPrefix]
  ) sharedPrefix += 1;
  if (sharedPrefix === messages.length && sharedPrefix === previousMessages.length) return previous;
  const previousChanged = previousMessages[sharedPrefix];
  const nextChanged = messages[sharedPrefix];
  const cumulative = previousChanged && nextChanged
    && previousChanged.id === nextChanged.id
    && nextChanged.text.startsWith(previousChanged.text);
  if (!sharedPrefix && !cumulative) return createTranscriptBuffer([...messages]);
  const cumulativeMaterialized = Boolean(cumulative && previousChanged && nextChanged
    && !transcriptMessageIsFoldedByDefault(previousChanged, transcriptSourceLineCount(previousChanged.text))
    && !transcriptMessageIsFoldedByDefault(nextChanged, transcriptSourceLineCount(nextChanged.text)));
  const changedTextStart = cumulativeMaterialized && previousChanged
    ? Math.max(0, previousChanged.text.lastIndexOf('\n') + 1)
    : 0;
  const stableChangedLines = cumulativeMaterialized && previousChanged
    ? countLineBreaksBefore(previousChanged.text, changedTextStart)
    : 0;
  const retainedLineCount = cumulativeMaterialized
    ? (previous.firstRowByMessage[sharedPrefix] ?? previous.lines.length) + stableChangedLines
    : previous.firstRowByMessage[sharedPrefix] ?? previous.lines.length;
  const lines = sparseTranscriptPrefix(previous.lines, retainedLineCount);
  const firstRowByMessage = previous.firstRowByMessage.slice(0, sharedPrefix);
  const lastRowByMessage = previous.lastRowByMessage.slice(0, sharedPrefix);
  messages.slice(sharedPrefix).forEach((message, offset) => {
    const messageIndex = sharedPrefix + offset;
    if (cumulativeMaterialized && offset === 0) {
      appendMaterializedTranscriptText(
        lines,
        firstRowByMessage,
        lastRowByMessage,
        message,
        messageIndex,
        message.text.slice(changedTextStart),
        stableChangedLines,
        previous.firstRowByMessage[messageIndex] ?? lines.length,
      );
      return;
    }
    const priorFirst = offset === 0 ? previous.lines[previous.firstRowByMessage[messageIndex] ?? -1] : undefined;
    appendTranscriptMessage(lines, firstRowByMessage, lastRowByMessage, message, messageIndex, priorFirst);
  });
  return { lines, firstRowByMessage, lastRowByMessage, messages };
}

function appendTranscriptMessage(
  lines: TranscriptLine[],
  firstRowByMessage: number[],
  lastRowByMessage: number[],
  message: WorkspaceMessage,
  messageIndex: number,
  reusableFirst?: TranscriptLine,
) {
  const first = lines.length;
  const lineCount = transcriptSourceLineCount(message.text);
  firstRowByMessage[messageIndex] = first;
  lastRowByMessage[messageIndex] = first + lineCount - 1;
  if (!transcriptMessageIsFoldedByDefault(message, lineCount)) {
    appendMaterializedTranscriptText(lines, firstRowByMessage, lastRowByMessage, message, messageIndex, message.text, 0, first);
    return;
  }
  lines.length = first + lineCount;
  const text = sourceLineText(message, 0);
  lines[first] = reusableFirst?.messageId === message.id
    && reusableFirst.lineInMessage === 0
    && reusableFirst.text === text
    ? reusableFirst
    : { messageId: message.id, messageIndex, lineInMessage: 0, role: message.role, text };
}

function appendMaterializedTranscriptText(
  lines: TranscriptLine[],
  firstRowByMessage: number[],
  lastRowByMessage: number[],
  message: WorkspaceMessage,
  messageIndex: number,
  sourceText: string,
  firstLineInMessage: number,
  firstRow: number,
) {
  firstRowByMessage[messageIndex] = firstRow;
  const messageLines = sourceText.split('\n');
  (messageLines.length ? messageLines : ['']).forEach((text, lineOffset) => lines.push({
    messageId: message.id,
    messageIndex,
    lineInMessage: firstLineInMessage + lineOffset,
    role: message.role,
    text,
  }));
  lastRowByMessage[messageIndex] = Math.max(firstRow, lines.length - 1);
}

function sparseTranscriptPrefix(source: TranscriptLine[], length: number) {
  const prefix = new Array<TranscriptLine>(length);
  Object.keys(source).forEach((key) => {
    const index = Number(key);
    if (index < length) prefix[index] = source[index]!;
  });
  return prefix;
}

type SourceLineIndex = { text: string; starts: number[]; complete: boolean };
const sourceLineIndexes = new WeakMap<WorkspaceMessage, SourceLineIndex>();

function sourceLineText(message: WorkspaceMessage, lineInMessage: number) {
  if (lineInMessage === 0 && message.role === 'tool' && message.tool?.summary.trim()) return message.tool.summary;
  let index = sourceLineIndexes.get(message);
  if (!index || index.text !== message.text) {
    index = { text: message.text, starts: [0], complete: false };
    sourceLineIndexes.set(message, index);
  }
  while (!index.complete && index.starts.length <= lineInMessage) {
    const start = index.starts.at(-1) ?? 0;
    const newline = index.text.indexOf('\n', start);
    if (newline < 0) index.complete = true;
    else index.starts.push(newline + 1);
  }
  const start = index.starts[lineInMessage];
  if (start === undefined) return '';
  const newline = index.text.indexOf('\n', start);
  return index.text.slice(start, newline < 0 ? index.text.length : newline);
}

export function transcriptLineAt(buffer: TranscriptBuffer, row: number): TranscriptLine | undefined {
  if (row < 0 || row >= buffer.lines.length) return undefined;
  const materialized = buffer.lines[row];
  if (materialized) return materialized;
  const messages = buffer.messages;
  if (!messages?.length) return undefined;
  let lower = 0;
  let upper = buffer.firstRowByMessage.length - 1;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const first = buffer.firstRowByMessage[middle] ?? 0;
    const last = buffer.lastRowByMessage[middle] ?? first;
    if (row < first) upper = middle - 1;
    else if (row > last) lower = middle + 1;
    else {
      const message = messages[middle];
      if (!message) return undefined;
      const lineInMessage = row - first;
      return {
        messageId: message.id,
        messageIndex: middle,
        lineInMessage,
        role: message.role,
        text: sourceLineText(message, lineInMessage),
      };
    }
  }
  return undefined;
}

function countLineBreaksBefore(value: string, end: number) {
  let count = 0;
  for (let index = 0; index < end; index += 1) if (value.charCodeAt(index) === 10) count += 1;
  return count;
}
