import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { transcriptLineAt, type TranscriptBuffer } from '../transcript/transcriptBuffer';
import type { TranscriptVimState } from '../transcript/transcriptVim';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { QuestionEntry, QuestionKeyResult } from './questionDraft';

type Options = {
  buffer: TranscriptBuffer;
  navigation: TranscriptVimState;
  sourceRows: readonly number[];
  messages: readonly WorkspaceMessage[];
  event: HardwareKeyEvent;
  handle: (message: WorkspaceMessage, event: HardwareKeyEvent, entry?: QuestionEntry) => QuestionKeyResult;
  reveal: (sourceRow: number) => void;
  select: (navigation: TranscriptVimState) => void;
};
/** A card is a continuation of its source message, not a hidden Enter mode.
 * Only uncounted normal vertical steps enter it. Counts, operators, visual
 * selections and search keep the transcript's existing source coordinates. */
export function routeTranscriptQuestionKey({ buffer, navigation, sourceRows, messages, event, handle, select, reveal }: Options): boolean {
  if (navigation.pending || navigation.count || navigation.visualMode || event.command || event.control || event.option) return false;
  const key = normalizedHardwareKey(event);
  const line = transcriptLineAt(buffer, navigation.cursor.row);
  const current = line && messages[line.messageIndex];
  const anchor = (index: number) => select({ ...navigation, cursor: { row: buffer.lastRowByMessage[index]!, column: 0 }, desiredColumn: 0, followTail: false });
  if (current?.question || current?.asyncQuestion) {
    const result = handle(current, event);
    if (result === 'before') { anchor(line!.messageIndex); reveal(buffer.lastRowByMessage[line!.messageIndex]!); return true; }
    if (result === 'after') return false;
    if (result) { anchor(line!.messageIndex); return true; }
    if (key === 'j' && navigation.cursor.row === buffer.lastRowByMessage[line!.messageIndex]) {
      if (handle(current, event, 'forward')) { anchor(line!.messageIndex); return true; }
    }
  }
  if (key === 'k') {
    const index = sourceRows.indexOf(navigation.cursor.row);
    const previousRow = sourceRows[index - 1];
    const previous = previousRow === undefined ? undefined : transcriptLineAt(buffer, previousRow);
    const message = previous && messages[previous.messageIndex];
    if (previous && previous.messageIndex !== line?.messageIndex && previousRow === buffer.lastRowByMessage[previous.messageIndex]
      && (message?.question || message?.asyncQuestion) && handle(message, event, 'backward')) {
      anchor(previous.messageIndex); return true;
    }
  }
  return false;
}
