import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptChronology, type TranscriptChronology } from './transcriptChronology';
import { compileTranscriptMarkdown, plainTranscriptMarkdownLine, type CompiledMarkdownLine } from './transcriptMarkdown';
import { transcriptGroupPositions, transcriptRolePresentation, type TranscriptGroupPosition, type TranscriptRolePresentation } from './transcriptPresentation';
import { transcriptReadSkills } from './transcriptSkillInvocation';

export type TranscriptRenderRow = {
  key: string;
  sourceRow: number;
  messageIndex: number;
  lineInMessage: number;
  firstInMessage: boolean;
  lastInMessage: boolean;
  message: WorkspaceMessage;
  compiled: CompiledMarkdownLine;
  presentation: TranscriptRolePresentation;
  groupPosition: TranscriptGroupPosition;
  chronology: TranscriptChronology;
  firstSourceRowInMessage: number;
  lastSourceRowInMessage: number;
  readSkills?: string[];
  toolGroupDepth?: number;
  questionCardOnly?: boolean;
  foldKey?: string;
  fold?: { expanded: boolean; hiddenLineCount: number; endSourceRow?: number };
};

export function buildTranscriptRenderRows(messages: WorkspaceMessage[]): TranscriptRenderRow[] {
  const groups = transcriptGroupPositions(messages);
  const chronology = transcriptChronology(messages);
  let sourceRow = 0;
  return messages.flatMap((message, messageIndex) => {
    const presentation = transcriptRolePresentation(message.role);
    const sourceLines = message.text.split('\n');
    const compiledLines = presentation.conversation
      ? compileTranscriptMarkdown(message.text)
      : sourceLines.map(plainTranscriptMarkdownLine);
    const firstSourceRowInMessage = sourceRow;
    const lastSourceRowInMessage = sourceRow + sourceLines.length - 1;
    const readSkills = transcriptReadSkills(messages, messageIndex, messageIndex);
    return sourceLines.map((text, lineInMessage) => ({
      key: `${message.id}:${lineInMessage}`,
      sourceRow: sourceRow++,
      messageIndex,
      lineInMessage,
      firstInMessage: lineInMessage === 0,
      lastInMessage: lineInMessage === sourceLines.length - 1,
      message,
      compiled: compiledLines[lineInMessage] ?? plainTranscriptMarkdownLine(text),
      presentation,
      groupPosition: groups[messageIndex] ?? 'standalone',
      chronology: chronology[messageIndex] ?? {},
      firstSourceRowInMessage,
      lastSourceRowInMessage,
      ...(readSkills.length ? { readSkills } : {}),
    }));
  });
}
