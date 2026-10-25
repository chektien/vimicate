import { sameWorkspaceMessageExceptText } from '../gateway/transcriptPublicationEquality';
import { conciseToolSummary, toolActivityFromContent } from '../tooling/toolActivity';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { compileTranscriptMarkdown, machineDetailTranscriptLine, plainTranscriptMarkdownLine } from './transcriptMarkdown';
import { transcriptChronology } from './transcriptChronology';
import { transcriptGroupPositions, transcriptRolePresentation } from './transcriptPresentation';
import type { TranscriptRenderRow } from './transcriptRenderRows';
import { boundedExpandedTranscriptLine, MACHINE_FOLD_CHARACTER_LIMIT, MAX_EXPANDED_MESSAGE_ROWS, transcriptMessageIsFoldedByDefault, transcriptSourceLineCount } from './transcriptRowBudget';
import { transcriptSkillInvocationFromFollowingTool, transcriptSkillInvocationFromToolRows } from './transcriptSkillInvocation';
import { projectTranscriptDetailsDisclosure, type DisclosureLine } from './transcriptDetailsDisclosure';
import { isAsyncQuestionFallback } from '../questions/asyncQuestionPresentation';

export { MACHINE_FOLD_CHARACTER_LIMIT } from './transcriptRowBudget';
type PreparedMessage = {
  text: string;
  sourceLineCount: number;
  sourceLines?: string[];
  compiledConversation?: ReturnType<typeof compileTranscriptMarkdown>;
};
const preparedMessages = new WeakMap<WorkspaceMessage, PreparedMessage>();

/**
 * Builds only rows that can actually be shown. The older two-stage path first
 * compiled every raw tool-result line and only then collapsed it; a long
 * project could therefore allocate and reconcile tens of thousands of React
 * text rows even though the user saw one folded line per tool call.
 */
export function buildVisibleTranscriptRenderRows(messages: WorkspaceMessage[], expandedMessageIDs: ReadonlySet<string>) {
  const groups = transcriptGroupPositions(messages);
  const chronology = transcriptChronology(messages);
  const visible: TranscriptRenderRow[] = [];
  let sourceRow = 0;
  let groupEnd = -1;
  let groupCollapsed = false;
  let groupHeaderSkillMember = -1;
  const messageIndexByID = new Map(messages.map((message, index) => [message.id, index]));

  messages.forEach((message, messageIndex) => {
    if (messageIndex <= groupEnd && groupCollapsed) {
      sourceRow += transcriptSourceLineCount(message.text);
      return;
    }
    const presentation = transcriptRolePresentation(message.role);
    const prepared = preparedTranscriptMessage(message);
    const folded = foldableMessage(message, prepared.sourceLineCount);
    const collapsed = folded && !expandedMessageIDs.has(message.id);
    const sourceLines = collapsed ? null : preparedSourceLines(prepared);
    const sourceLineCount = prepared.sourceLineCount;
    const firstSourceRowInMessage = sourceRow;
    const lastSourceRowInMessage = sourceRow + sourceLineCount - 1;
    const inToolGroup = messageIndex <= groupEnd;
    const toolSkill = message.role === 'tool' && (inToolGroup
      ? messageIndex !== groupHeaderSkillMember
      : !transcriptSkillInvocationFromFollowingTool(messages, messageIndex - 1))
      ? transcriptSkillInvocationFromToolRows(messages, messageIndex, inToolGroup ? messageIndex : message.toolGroup ? messageIndexByID.get(message.toolGroup.lastMessageId) ?? messageIndex : messageIndex) : null;
    const inferredSkillInvocation = transcriptSkillInvocationFromFollowingTool(messages, messageIndex) ?? toolSkill ?? undefined;
    const shared = { messageIndex, message, presentation, groupPosition: groups[messageIndex] ?? 'standalone' as const, chronology: chronology[messageIndex] ?? {}, firstSourceRowInMessage, lastSourceRowInMessage, ...(inferredSkillInvocation ? { inferredSkillInvocation } : {}), ...(messageIndex <= groupEnd ? { toolGroupDepth: 1 } : {}) };

    // Keep the original source range for yank/search/history and one navigation
    // anchor for the card. Hidden fallback lines must not become invisible stops.
    if (isAsyncQuestionFallback(message)) {
      // All question states share one cell. Moving its card between source
      // rows on collapse leaves stale recycler measurements on ordinary text.
      visible.push({ ...shared, key: `${message.id}:question`, sourceRow, lineInMessage: 0,
        firstInMessage: true, lastInMessage: true, questionCardOnly: true,
        compiled: plainTranscriptMarkdownLine('Question') });
      sourceRow += sourceLineCount;
      return;
    }
    if (message.toolGroup) {
      groupEnd = messageIndexByID.get(message.toolGroup.lastMessageId) ?? messageIndex;
      groupHeaderSkillMember = -1;
      for (let member = messageIndex + 1; member <= groupEnd; member += 1) {
        const skill = transcriptSkillInvocationFromToolRows(messages, member, member);
        if (skill) {
          if (skill.label === inferredSkillInvocation?.label) groupHeaderSkillMember = member;
          break;
        }
      }
      groupCollapsed = !expandedMessageIDs.has(message.id);
      const hiddenLineCount = messages.slice(messageIndex + 1, groupEnd + 1)
        .reduce((count, member) => count + transcriptSourceLineCount(member.text), 0);
      visible.push({ ...shared, key: `${message.id}:fold`, sourceRow,
        lineInMessage: 0, firstInMessage: true, lastInMessage: true,
        lastSourceRowInMessage: groupCollapsed ? sourceRow + hiddenLineCount : sourceRow,
        compiled: plainTranscriptMarkdownLine(message.text),
        fold: { expanded: !groupCollapsed, hiddenLineCount } });
      sourceRow += sourceLineCount;
      return;
    }
    if (folded) {
      if (!expandedMessageIDs.has(message.id)) {
        visible.push(foldedMessageRow(message, sourceLineCount, firstSourceRowInMessage, shared));
        sourceRow += sourceLineCount;
        return;
      }
      const retained = (presentation.conversation ? sourceLines! : expandedMachineSourceLines(message, sourceLines!))
        .slice(0, MAX_EXPANDED_MESSAGE_ROWS)
        .map(boundedExpandedTranscriptLine);
      const compiled = presentation.conversation ? compileTranscriptMarkdown(retained.join('\n')) : null;
      const retainedRows: DisclosureLine[] = (message.role === 'assistant' || message.role === 'narration')
        ? projectTranscriptDetailsDisclosure(message.id, compiled!, firstSourceRowInMessage, expandedMessageIDs)
        : retained.flatMap((text, lineInMessage) => {
          const line = compiled?.[lineInMessage] ?? (lineInMessage === 0 ? plainTranscriptMarkdownLine(text) : machineDetailTranscriptLine(text));
          if (presentation.conversation && line.kind === 'blank') return [];
          return [{ compiled: line, lineInMessage }];
        });
      retainedRows.forEach(({ compiled: line, lineInMessage, ...disclosure }, renderedIndex) => visible.push({
        ...shared,
        // Preserve the fold anchor's identity when one collapsed row becomes
        // many visible rows. The recycler can then keep the reviewed row in
        // place instead of choosing the far edge of the inserted content.
        key: renderedIndex === 0 ? `${message.id}:fold` : `${message.id}:${lineInMessage}`,
        sourceRow: firstSourceRowInMessage + lineInMessage,
        lineInMessage,
        firstInMessage: renderedIndex === 0,
        lastInMessage: retained.length === sourceLineCount && renderedIndex === retainedRows.length - 1,
        compiled: line,
        ...(renderedIndex === 0 ? { fold: { expanded: true, hiddenLineCount: Math.max(0, sourceLineCount - 1) } } : {}),
        ...disclosure,
      }));
      if (retained.length < sourceLineCount) {
        const omitted = sourceLineCount - retained.length;
        visible.push({
          ...shared,
          key: `${message.id}:omitted:${retained.length}`,
          sourceRow: firstSourceRowInMessage + retained.length,
          lineInMessage: retained.length,
          firstInMessage: retainedRows.length === 0,
          lastInMessage: true,
          compiled: plainTranscriptMarkdownLine(`… [${omitted} more ${omitted === 1 ? 'line' : 'lines'} omitted from this expanded viewport]`),
          fold: { expanded: true, hiddenLineCount: omitted },
        });
      }
      sourceRow += sourceLineCount;
      return;
    }

    const compiled = presentation.conversation
      ? (prepared.compiledConversation ??= compileTranscriptMarkdown(message.text))
      : sourceLines!.map(plainTranscriptMarkdownLine);
    // Blank and disclosure tag lines retain source coordinates without adding
    // Vim stops. Complete assistant/narration disclosures use independent keys
    // in the same bounded fold cache as tool rows.
    const renderedLines: DisclosureLine[] = (message.role === 'assistant' || message.role === 'narration')
      ? projectTranscriptDetailsDisclosure(message.id, compiled, firstSourceRowInMessage, expandedMessageIDs)
      : sourceLines!.flatMap((text, lineInMessage) => {
        const line = compiled[lineInMessage] ?? plainTranscriptMarkdownLine(text);
        return presentation.conversation && line.kind === 'blank' ? [] : [{ compiled: line, lineInMessage }];
      });
    if (!renderedLines.length && (message.attachments?.length || message.approval)) renderedLines.push({ compiled: plainTranscriptMarkdownLine(''), lineInMessage: 0 });
    renderedLines.forEach(({ compiled: line, lineInMessage, ...disclosure }, renderedIndex) => {
      visible.push({
        ...shared,
        key: `${message.id}:${lineInMessage}`,
        sourceRow: firstSourceRowInMessage + lineInMessage,
        lineInMessage,
        firstInMessage: renderedIndex === 0,
        lastInMessage: renderedIndex === renderedLines.length - 1,
        compiled: line,
        ...disclosure,
      });
    });
    sourceRow += sourceLineCount;
  });
  return visible;
}

/**
 * FlashList keys identify mounted cells, but passing a fresh row object for
 * every unchanged key still makes React reconcile the whole visible window on
 * every live Gateway publication. Retain exact row identities when their
 * presentation inputs are unchanged so a cumulative frame only mutates the
 * rows that actually changed.
 */
export function retainStableTranscriptRenderRows(
  previous: readonly TranscriptRenderRow[],
  next: readonly TranscriptRenderRow[],
): TranscriptRenderRow[] {
  if (!previous.length || !next.length) return [...next];
  const previousByKey = new Map(previous.map((row) => [row.key, row]));
  let retained = 0;
  const result = next.map((row) => {
    const prior = previousByKey.get(row.key);
    if (!prior || !sameTranscriptRenderRow(prior, row)) return row;
    retained += 1;
    return prior;
  });
  return retained === next.length && previous.length === next.length
    ? previous as TranscriptRenderRow[]
    : result;
}

function sameTranscriptRenderRow(left: TranscriptRenderRow, right: TranscriptRenderRow) {
  return sameWorkspaceMessageExceptText(left.message, right.message)
    && left.sourceRow === right.sourceRow
    && left.messageIndex === right.messageIndex
    && left.lineInMessage === right.lineInMessage
    && left.firstInMessage === right.firstInMessage
    && left.lastInMessage === right.lastInMessage
    && sameCompiledTranscriptLine(left.compiled, right.compiled)
    && left.groupPosition === right.groupPosition
    && left.firstSourceRowInMessage === right.firstSourceRowInMessage
    // Only the first visible row consumes the whole message range for its
    // focused timestamp. Interior lines must not all churn when a live answer
    // appends another line; the former tail already invalidates via
    // lastInMessage and a folded row is also firstInMessage.
    && (!left.firstInMessage || left.lastSourceRowInMessage === right.lastSourceRowInMessage)
    && left.presentation.marker === right.presentation.marker
    && left.presentation.tone === right.presentation.tone
    && left.presentation.tier === right.presentation.tier
    && left.presentation.conversation === right.presentation.conversation
    && left.presentation.user === right.presentation.user
    && left.chronology.dividerLabel === right.chronology.dividerLabel
    && left.chronology.timeLabel === right.chronology.timeLabel
    && left.chronology.focusedTimeLabel === right.chronology.focusedTimeLabel
    && left.inferredSkillInvocation?.label === right.inferredSkillInvocation?.label
    && left.toolGroupDepth === right.toolGroupDepth
    && left.questionCardOnly === right.questionCardOnly
    && left.foldKey === right.foldKey
    && left.fold?.expanded === right.fold?.expanded
    && left.fold?.hiddenLineCount === right.fold?.hiddenLineCount
    && left.fold?.endSourceRow === right.fold?.endSourceRow;
}

function sameCompiledTranscriptLine(left: TranscriptRenderRow['compiled'], right: TranscriptRenderRow['compiled']) {
  return left === right || (left.source === right.source
    && left.kind === right.kind
    && left.marker === right.marker
    && left.indent === right.indent
    && left.headingLevel === right.headingLevel
    && sameCompiledTable(left.table, right.table));
}

function sameCompiledTable(left: TranscriptRenderRow['compiled']['table'], right: TranscriptRenderRow['compiled']['table']) {
  if (left === right) return true;
  if (!left || !right || left.header !== right.header || left.first !== right.first || left.last !== right.last
    || left.cells.length !== right.cells.length || left.columnWeights.length !== right.columnWeights.length) return false;
  return left.cells.every((cell, index) => cell.source === right.cells[index]?.source)
    && left.columnWeights.every((weight, index) => weight === right.columnWeights[index]);
}

export function visibleTranscriptRenderRows(rows: TranscriptRenderRow[], expandedMessageIDs: ReadonlySet<string>) {
  const visible: TranscriptRenderRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const first = rows[index]!;
    const messageRows: TranscriptRenderRow[] = [];
    while (index < rows.length && rows[index]!.messageIndex === first.messageIndex) messageRows.push(rows[index++]!);
    if (first.presentation.conversation) visible.push(...messageRows.filter((row) => row.compiled.kind !== 'blank'));
    else if (!foldableMachineMessage(messageRows)) visible.push(...messageRows);
    else if (expandedMessageIDs.has(first.message.id)) visible.push(...expandedMachineRows(messageRows));
    else visible.push(...foldedMachineRows(messageRows));
  }
  return visible;
}

export function transcriptRenderIndexForSourceRow(rows: TranscriptRenderRow[], sourceRow: number) {
  if (!rows.length) return 0;
  const exact = rows.findIndex((row) => row.sourceRow === sourceRow);
  if (exact >= 0) return exact;
  const containingFold = rows.findIndex((row) => (row.fold || row.questionCardOnly) && sourceRow >= row.sourceRow && sourceRow <= (row.fold?.endSourceRow ?? row.lastSourceRowInMessage));
  if (containingFold >= 0) return containingFold;
  const following = rows.findIndex((row) => row.sourceRow > sourceRow);
  return following >= 0 ? following : rows.length - 1;
}

export function transcriptNavigationSourceRows(rows: TranscriptRenderRow[]) {
  return rows.map((row) => row.sourceRow);
}

function foldableMachineMessage(rows: TranscriptRenderRow[]) {
  const first = rows[0];
  if (!first) return false;
  if (first.message.role === 'tool') return true;
  return first.message.text.length > MACHINE_FOLD_CHARACTER_LIMIT;
}

function foldableMessage(message: WorkspaceMessage, sourceLineCount: number) {
  return transcriptMessageIsFoldedByDefault(message, sourceLineCount);
}

function preparedTranscriptMessage(message: WorkspaceMessage) {
  const cached = preparedMessages.get(message);
  if (cached?.text === message.text) return cached;
  const prepared: PreparedMessage = { text: message.text, sourceLineCount: transcriptSourceLineCount(message.text) };
  preparedMessages.set(message, prepared);
  return prepared;
}

function preparedSourceLines(prepared: PreparedMessage) {
  return prepared.sourceLines ??= prepared.text.split('\n');
}

function expandedMachineSourceLines(message: WorkspaceMessage, sourceLines: string[]) {
  if (message.role !== 'tool' || !sourceLines.length) return sourceLines;
  const summary = message.tool?.summary || toolActivityFromContent(undefined, message.text)?.summary || '';
  return [summary, ...sourceLines.slice(1)];
}

function foldedMessageRow(message: WorkspaceMessage, lineCount: number, sourceRow: number, shared: Pick<TranscriptRenderRow, 'messageIndex' | 'message' | 'presentation' | 'groupPosition' | 'chronology' | 'firstSourceRowInMessage' | 'lastSourceRowInMessage'>): TranscriptRenderRow {
  const hiddenLineCount = Math.max(0, lineCount - 1);
  const conversation = shared.presentation.conversation;
  const semanticSummary = conversation
    ? conciseConversationSummary(message.text)
    : message.tool
      ? conciseToolSummary({ name: message.tool.name, phase: message.state ?? '', metadata: message.tool.summary })
      : machineHeadline(message);
  const summary = [semanticSummary, formattedDuration(message.tool?.durationMs)].filter(Boolean).join(' · ');
  const noun = hiddenLineCount === 1 ? 'line' : 'lines';
  const marker = hiddenLineCount ? `… [${hiddenLineCount} ${noun} folded]` : '… [details folded]';
  return {
    ...shared,
    key: `${message.id}:fold`,
    sourceRow,
    lineInMessage: 0,
    firstInMessage: true,
    lastInMessage: true,
    compiled: plainTranscriptMarkdownLine([summary, marker].filter(Boolean).join('  ')),
    fold: { expanded: false, hiddenLineCount },
  };
}

/**
 * Every machine row now publishes a brace-free semantic headline as its first
 * line; a legacy cached tool row falls back to its inferred identity.
 */
function machineHeadline(message: WorkspaceMessage) {
  if (message.role === 'tool') return toolActivityFromContent(undefined, message.text)?.summary ?? 'tool · activity';
  const firstLineEnd = message.text.indexOf('\n');
  const firstLine = (firstLineEnd < 0 ? message.text : message.text.slice(0, firstLineEnd)).trim().replace(/\s+/g, ' ');
  return firstLine.length > 140 ? `${firstLine.slice(0, 137).trimEnd()}…` : firstLine;
}

function conciseConversationSummary(text: string) {
  const firstLineEnd = text.indexOf('\n');
  const firstLine = (firstLineEnd < 0 ? text : text.slice(0, firstLineEnd)).trim().replace(/\s+/g, ' ');
  if (!firstLine) return 'long response';
  return firstLine.length > 140 ? `${firstLine.slice(0, 137).trimEnd()}…` : firstLine;
}

function foldedMachineRows(rows: TranscriptRenderRow[]) {
  const first = rows[0]!;
  const hiddenLineCount = Math.max(0, rows.length - 1);
  const semanticSummary = first.message.tool
    ? conciseToolSummary({ name: first.message.tool.name, phase: first.message.state ?? '', metadata: first.message.tool.summary })
    : machineHeadline(first.message);
  const summary = [semanticSummary, formattedDuration(first.message.tool?.durationMs)].filter(Boolean).join(' · ');
  const noun = hiddenLineCount === 1 ? 'line' : 'lines';
  const marker = hiddenLineCount ? `… [${hiddenLineCount} ${noun} folded]` : '… [details folded]';
  const folded: TranscriptRenderRow = {
    ...first,
    key: `${first.message.id}:fold`,
    lastInMessage: true,
    compiled: plainTranscriptMarkdownLine([summary, marker].filter(Boolean).join('  ')),
    fold: { expanded: false, hiddenLineCount },
  };
  return [folded];
}

function formattedDuration(durationMs: number | undefined) {
  if (!durationMs || durationMs < 1) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${Math.round(durationMs / 100) / 10}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function expandedMachineRows(rows: TranscriptRenderRow[]) {
  const summary = rows[0]?.message.tool?.summary || toolActivityFromContent(undefined, rows[0]?.message.text ?? '')?.summary || '';
  const retained = rows.slice(0, MAX_EXPANDED_MESSAGE_ROWS).map((row, index) => index === 0
    ? { ...row, key: `${row.message.id}:fold`, compiled: plainTranscriptMarkdownLine(summary), fold: { expanded: true, hiddenLineCount: Math.max(0, rows.length - 1) } }
    : { ...row, compiled: machineDetailTranscriptLine(row.compiled.source) });
  if (retained.length === rows.length) return retained;
  const last = retained.at(-1)!;
  retained[retained.length - 1] = {
    ...last,
    lastInMessage: true,
    compiled: plainTranscriptMarkdownLine(`${last.compiled.source}\n… [${rows.length - retained.length} more lines omitted from this expanded viewport]`),
  };
  return retained;
}
