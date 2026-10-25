import { conciseToolSummary, safeToolName, type ToolActivity } from './toolActivity';

/**
 * The prose an assistant message actually authored, separated from the tool
 * protocol its runtime failed to keep structured. `activities` are ordinary
 * tool activities and belong to `toolActivity.ts`; this module only recovers
 * the structure a producer dropped.
 */
export type EmbeddedToolProtocol = { prose: string; activities: ToolActivity[] };

// A runtime that emits its tool traffic as text frames the payload with
// protocol markers a reader never asked for: a bare `function results` token,
// an XML wrapper, or the single-character remains of one. Classification is
// structural — a whole marker line, never a runtime or model name, and never a
// token merely mentioned inside a sentence or quoted in a fenced block.
const MARKER_QUICK_RE = /(?:^|\n)[^\n]{0,4}(?:antml:)?(?:function[ _-]?(?:calls?|results?|response)|tool[ _-]?(?:calls?|results?|use)|invoke|parameter)\b/i;
const GLYPH_QUICK_RE = /(?:^|\n)[ \t]*[^\s0-9A-Za-z][ \t]*(?:\n|$)/;
const XML_MARKER_RE = /^<\/?\s*(?:antml:)?(?:function[_-]?(?:calls?|results?|response)|tool[_-]?(?:calls?|results?|use)|invoke|parameter)\b[^\n]*>$/i;
const BARE_MARKER_RE = /^(?:antml:)?(?:function[ _-]?(?:calls?|results?|response)|tool[ _-]?(?:calls?|results?|use))$/i;
const RESULT_MARKER_RE = /result|response/i;
const INVOKED_NAME_RE = /\bname\s*=\s*["']([^"']{1,48})["']/i;
const MAX_PAYLOAD_PARSE_CHARACTERS = 8_192;

type LineKind = 'glyph' | 'call-marker' | 'result-marker' | 'payload' | 'json' | 'blank' | 'prose';

/**
 * Recover the executions a model-authored row describes in text alone. A
 * prompt the user wrote and a machine row that already resolved its own
 * identity are not re-read as protocol.
 */
export function conversationalToolProtocol(role: string, text: string) {
  return role === 'assistant' || role === 'narration' ? embeddedToolProtocolFromText(text) : null;
}

/**
 * Recover the tool executions an assistant message describes in text alone.
 * Returns `null` — leaving the message untouched — unless the text opens a
 * protocol region: a marker line, or an object payload framed by marker
 * glyphs. Fenced blocks are authored evidence and are never scanned.
 */
export function embeddedToolProtocolFromText(text: string): EmbeddedToolProtocol | null {
  if (!text || (!MARKER_QUICK_RE.test(text) && !GLYPH_QUICK_RE.test(text))) return null;
  const lines = text.split('\n');
  const kinds = classifiedLines(lines);
  const anchor = kinds.findIndex((kind, index) => isAnchor(kinds, kind, index));
  if (anchor < 0) return null;
  let start = anchor;
  while (start > 0 && (kinds[start - 1] === 'glyph' || kinds[start - 1] === 'blank')) start -= 1;
  return {
    prose: lines.slice(0, start).join('\n').trimEnd(),
    activities: activitiesFromRegion(lines.slice(start), kinds.slice(start)),
  };
}

/**
 * A marker line opens a region on its own. A bare object payload does not: an
 * answer is allowed to end in one. It opens a region only when the producer's
 * own framing sits immediately above it.
 */
function isAnchor(kinds: LineKind[], kind: LineKind, index: number) {
  if (kind === 'call-marker' || kind === 'result-marker') return true;
  if (kind !== 'json') return false;
  let above = index - 1;
  while (above >= 0 && kinds[above] === 'blank') above -= 1;
  return above >= 0 && kinds[above] === 'glyph';
}

function classifiedLines(lines: string[]): LineKind[] {
  let fence = '';
  return lines.map((line) => {
    const trimmed = line.trim();
    const marker = trimmed.match(/^(`{3,}|~{3,})/)?.[1] ?? '';
    if (marker) { fence = fence && marker[0] === fence ? '' : fence || marker[0]!; return 'prose'; }
    if (fence) return 'prose';
    if (!trimmed) return 'blank';
    if (isMarkerLine(trimmed)) return RESULT_MARKER_RE.test(trimmed) ? 'result-marker' : 'call-marker';
    if (trimmed.length <= 2 && !/[0-9A-Za-z]/.test(trimmed)) return 'glyph';
    return parsedPayload(trimmed) === undefined ? 'payload' : 'json';
  });
}

function isMarkerLine(trimmed: string) {
  return XML_MARKER_RE.test(trimmed) || BARE_MARKER_RE.test(trimmed.replace(/^<|>$/g, ''));
}

function parsedPayload(trimmed: string) {
  const bracketed = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!bracketed || trimmed.length > MAX_PAYLOAD_PARSE_CHARACTERS) return undefined;
  try { return JSON.parse(trimmed) as unknown; } catch { return undefined; }
}

type ProtocolFrame = { name: string; call: string[]; result: string[]; phase: 'call' | 'result' };

/**
 * One tool execution per invocation the region describes. The result the
 * producer printed after its own result marker belongs to the call above it,
 * so a call/result pair publishes one row rather than two anonymous halves.
 */
function activitiesFromRegion(lines: string[], kinds: LineKind[]) {
  const frames: ProtocolFrame[] = [];
  let frame = emptyFrame();
  let framed = false;
  const close = () => { if (frame.call.length || frame.result.length) frames.push(frame); frame = emptyFrame(); };
  lines.forEach((line, index) => {
    const kind = kinds[index];
    if (kind === 'glyph') { framed = true; return; }
    if (kind === 'call-marker') {
      if (frame.result.length) close();
      frame.name ||= line.match(INVOKED_NAME_RE)?.[1]?.trim() ?? '';
      frame.phase = 'call';
      framed = true;
      return;
    }
    if (kind === 'result-marker') { frame.phase = 'result'; framed = true; return; }
    // A result body routinely prints an object of its own. Only an invocation
    // the producer framed itself opens the next execution.
    if (kind === 'json' && framed && frame.result.length) close();
    const bucket = frame.phase === 'call' ? frame.call : frame.result;
    if (kind === 'blank') { if (bucket.length) bucket.push(line); return; }
    framed = false;
    bucket.push(line);
  });
  close();
  return frames.map(activityFromFrame);
}

function activityFromFrame(frame: ProtocolFrame): ToolActivity {
  const call = trimmedBlock(frame.call);
  const result = trimmedBlock(frame.result);
  const name = safeToolName(frame.name);
  return {
    kind: result ? 'result' : 'call',
    name,
    callId: '',
    status: result ? 'ok' : 'running',
    summary: conciseToolSummary({
      name: frame.name,
      phase: result ? 'result' : 'start',
      argumentsValue: parsedPayload(call) ?? call,
      fallbackDetail: result.split('\n')[0],
    }),
    detail: [call, result].filter(Boolean).join('\n'),
  };
}

function emptyFrame(): ProtocolFrame { return { name: '', call: [], result: [], phase: 'call' }; }
function trimmedBlock(lines: string[]) { return lines.join('\n').replace(/^\s*\n/, '').trimEnd(); }
