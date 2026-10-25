import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { TranscriptHandoffVariant } from './transcriptVim';

export type TranscriptHandoffPayload = { text: string; caretOffset: number; shape: string };

export function composeTranscriptHandoff(message: WorkspaceMessage, lineInMessage: number, column: number, variant: TranscriptHandoffVariant): TranscriptHandoffPayload {
  const lines = message.text.split('\n');
  const safeLine = Math.max(0, Math.min(lines.length - 1, lineInMessage));
  // Inside a fenced block, blockquote or "quoted" span, hand over just that
  // excerpt; anywhere else, the whole response.
  const quoted = quotedRegionAt(lines, safeLine, column);
  if (quoted) {
    const { body, caretInBody } = placeEdit(quoted.lines, quoted.line, quoted.column, variant);
    const prefix = 'Below is an excerpt from your response with my edits applied. Apply this change.\n\n';
    return { text: prefix + body, caretOffset: prefix.length + caretInBody, shape: 'quoted' };
  }
  const { body, caretInBody } = placeEdit(lines, safeLine, column, variant);
  const shape = classifyShape(message.text);
  const preamble = preambleFor(shape, message.role);
  const prefix = `${preamble}\n\n`;
  return { text: prefix + body, caretOffset: prefix.length + caretInBody, shape };
}

function placeEdit(lines: string[], lineIndex: number, column: number, variant: TranscriptHandoffVariant) {
  const text = lines.join('\n');
  const safeLine = Math.max(0, Math.min(lines.length - 1, lineIndex));
  const line = lines[safeLine] ?? '';
  const lineStart = lines.slice(0, safeLine).reduce((total, value) => total + value.length + 1, 0);
  const lineEnd = lineStart + line.length;
  const sourceCursor = Math.max(lineStart, Math.min(lineEnd, lineStart + column));
  let body = text;
  let caretInBody = sourceCursor;
  if (variant === 'a') caretInBody = Math.min(lineEnd, sourceCursor + 1);
  if (variant === 'I') caretInBody = lineStart + (line.match(/^\s*/)?.[0].length ?? 0);
  if (variant === 'A') caretInBody = lineEnd;
  if (variant === 'o') {
    body = `${text.slice(0, lineEnd)}\n${text.slice(lineEnd)}`;
    caretInBody = lineEnd + 1;
  }
  if (variant === 'O') {
    body = `${text.slice(0, lineStart)}\n${text.slice(lineStart)}`;
    caretInBody = lineStart;
  }
  return { body, caretInBody };
}

type QuotedRegion = { lines: string[]; line: number; column: number };
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const BLOCKQUOTE = /^\s*>\s?/;

/** The quoted excerpt under the cursor: fenced block, blockquote run, or an inline "…" span. */
export function quotedRegionAt(lines: string[], line: number, column: number): QuotedRegion | null {
  // CommonMark pairing: a closing fence repeats the opening character, is at
  // least as long and has no info string. A fence still open at the end of the
  // text (a streaming answer) runs to the last line.
  let open = -1; let marker = '';
  for (let index = 0; index < lines.length; index += 1) {
    const fence = FENCE.exec(lines[index]!);
    if (!fence) continue;
    const run = fence[1]!;
    if (open < 0) { open = index; marker = run; continue; }
    if (run[0] !== marker[0] || run.length < marker.length || fence[2]!.trim()) continue;
    if (line >= open && line <= index) return fencedRegion(lines, open, index, line, column);
    open = -1;
  }
  if (open >= 0 && line >= open) return fencedRegion(lines, open, lines.length, line, column);
  const current = lines[line] ?? '';
  const quote = BLOCKQUOTE.exec(current);
  if (quote) {
    let start = line; while (start > 0 && BLOCKQUOTE.test(lines[start - 1]!)) start -= 1;
    let end = line; while (end < lines.length - 1 && BLOCKQUOTE.test(lines[end + 1]!)) end += 1;
    return { lines: lines.slice(start, end + 1).map(value => value.replace(BLOCKQUOTE, '')), line: line - start, column: Math.max(0, column - quote[0].length) };
  }
  for (const pattern of [/"([^"\n]+)"/g, /“([^”\n]+)”/g]) {
    for (const match of current.matchAll(pattern)) {
      const from = match.index! + 1; const to = from + match[1]!.length;
      if (column >= from - 1 && column <= to) return { lines: [match[1]!], line: 0, column: Math.max(0, Math.min(match[1]!.length, column - from)) };
    }
  }
  return null;
}

function fencedRegion(lines: string[], open: number, close: number, line: number, column: number): QuotedRegion | null {
  // A response that is one fenced block keeps the whole-response code handoff.
  const firstText = lines.findIndex(value => value.trim()); const lastText = lines.findLastIndex(value => value.trim());
  if (open === firstText && (close === lastText || close === lines.length)) return null;
  const inner = lines.slice(open + 1, close);
  if (!inner.some(value => value.trim())) return null;
  if (line === open) return { lines: inner, line: 0, column: 0 };
  if (line >= close) return { lines: inner, line: inner.length - 1, column: inner.at(-1)!.length };
  return { lines: inner, line: line - open - 1, column };
}

function classifyShape(text: string) {
  const nonBlank = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (nonBlank[0]?.startsWith('```') && nonBlank.at(-1)?.startsWith('```')) return 'code';
  if (/^(hi|hey|hello|dear)\b.*[,!]$/i.test(nonBlank[0] ?? '') || /^(best|regards|thanks|cheers|sincerely|warmly),?$/i.test(nonBlank.at(-1) ?? '')) return 'email';
  if (nonBlank.filter((line) => /^[-*+] \[[ xX]\]/.test(line)).length >= Math.max(1, nonBlank.length / 2)) return 'checklist';
  if (nonBlank.some((line) => /^#{1,6}\s/.test(line)) || nonBlank.filter((line) => /^[-*+]\s/.test(line)).length >= 2) return 'document';
  if (nonBlank.filter((line) => /^(today|yesterday|blockers?|in progress|done|next|shipped)\s*:/i.test(line)).length >= 2) return 'status';
  return 'generic';
}

function preambleFor(shape: string, role: WorkspaceMessage['role']) {
  if (shape === 'code') return 'Below is the code with my edits applied. Apply this change.';
  if (shape === 'email') return 'Below is the email draft with my edits applied. Update it and return the revised draft.';
  if (shape === 'checklist') return 'Below is the checklist with my edits applied. Update it accordingly.';
  if (shape === 'document') return 'Below is the document with my edits applied. Update it and return the revised version.';
  if (shape === 'status') return 'Below is the status update with my edits applied. Apply these changes and regenerate it.';
  return role === 'tool' ? 'I have edited the tool output below. Process this change accordingly.' : 'I have edited the response below. Process this change accordingly.';
}
