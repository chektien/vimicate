import { skillNameFromArguments, successfulSkillReadResult } from './skillReadEvidence';
export const TOOL_SUMMARY_CHARACTER_LIMIT = 96;

export type ToolSummaryPhase = 'start' | 'update' | 'result' | 'error' | 'unknown';
export type ToolActivityKind = 'call' | 'result';
export type ToolActivityStatus = 'running' | 'ok' | 'failed';

/**
 * One runtime-neutral description of a single tool call or its result. Agent
 * runtimes disagree about the wire dialect — the Gateway's own `toolCall` /
 * `toolResult` parts, an external CLI's `tool_use` / `tool_result` parts, and
 * live `agent` tool frames all name the same identity. Every transcript owner
 * resolves that identity here so a tool never reaches the reader as prose.
 */
export type ToolActivity = {
  kind: ToolActivityKind;
  name: string;
  callId: string;
  status: ToolActivityStatus;
  /** Bounded, brace-free row headline. Safe to show while folded. */
  summary: string;
  /** Raw payload, retained for deliberate expansion. */
  detail: string;
  skillName?: string;
  resultSucceeded?: true;
};

type ToolSummaryInput = {
  name?: string;
  phase?: string;
  metadata?: unknown;
  argumentsValue?: unknown;
  fallbackDetail?: unknown;
};

const genericStatuses = new Set(['running', 'updating', 'completed', 'failed', 'activity']);
// A search names its subject, not the directory it scans: `query`/`pattern`
// outrank the path keys a search tool also carries.
const semanticKeys = ['summary', 'label', 'action', 'description', 'skill', 'command', 'cmd', 'query', 'pattern', 'url', 'path', 'filePath', 'file_path', 'filename'] as const;
const pathKeys = new Set(['path', 'filePath', 'file_path', 'filename']);
// A headline frames its action as `<tool> · <action>`, and a paired failure
// inserts `failed · ` between them. Reserve that framing so a long command
// loses its configuration options rather than its identifying operands.
const COMMAND_ACTION_BUDGET = TOOL_SUMMARY_CHARACTER_LIMIT - 24;

// A producer that kept no structure at all — its tool protocol survives only
// as text inside an assistant message — is recovered by
// `embeddedToolProtocol.ts`, which resolves its identity through this owner.
/** Classify one content part in any known tool dialect. */
export function toolContentPartKind(part: unknown): ToolActivityKind | null {
  if (!isRecord(part)) return null;
  const type = stringValue(part.type).toLowerCase().replace(/[^a-z]/g, '');
  if (!type.includes('tool')) return null;
  if (type.includes('toolresult') || type.includes('toolerror')) return 'result';
  if (type.includes('toolcall') || type.includes('tooluse')) return 'call';
  return null;
}

/** Every tool-shaped part of a content array, in any known dialect. */
export function toolContentParts(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content.flatMap(toolContentParts);
  return toolContentPartKind(content) ? [content as Record<string, unknown>] : [];
}

/**
 * True when a content array carries tool activity and nothing else. Such a
 * message is machine evidence, never an assistant answer.
 */
export function contentIsOnlyToolActivity(content: unknown) {
  if (!Array.isArray(content) || !content.length) return false;
  // Untyped text and strings are still authored content; filtering them out
  // before classification would discard their prose during projection.
  return content.every((part) => toolContentPartKind(part) !== null);
}

/**
 * Every tool activity a content array describes, in wire order. One assistant
 * message routinely interleaves prose with several tool parts; each part is a
 * separate execution and earns its own bounded row.
 */
export function toolActivitiesFromContent(content: unknown): ToolActivity[] {
  return toolContentParts(content).map(toolActivityFromPart);
}

/** Resolve the first tool activity described by a content array. */
export function toolActivityFromContent(content: unknown, fallbackText = ''): ToolActivity | null {
  const part = toolContentParts(content)[0];
  if (!part) return fallbackText ? inferredToolActivity(fallbackText) : null;
  return toolActivityFromPart(part);
}

function toolActivityFromPart(part: Record<string, unknown>): ToolActivity {
  const kind = toolContentPartKind(part) ?? 'call';
  const name = safeToolName(stringValue(part.name) || stringValue(part.toolName));
  const callId = toolCallIdentity(part);
  const failed = part.is_error === true || part.isError === true;
  const argumentsValue = kind === 'call' ? part.arguments ?? part.args ?? part.input : undefined;
  const skillName = kind === 'call' ? skillNameFromArguments(name, argumentsValue) : undefined;
  const detailValue = kind === 'call' ? argumentsValue : part.content ?? part.text ?? part.result ?? part.output;
  return {
    kind,
    name,
    callId,
    status: kind === 'call' ? 'running' : failed ? 'failed' : 'ok',
    ...(skillName ? { skillName } : {}),
    ...(kind === 'result' && !failed && successfulSkillReadResult(name, detailValue) ? { resultSucceeded: true as const } : {}),
    summary: conciseToolSummary({
      name,
      phase: kind === 'call' ? 'start' : failed ? 'error' : 'result',
      metadata: part.meta,
      argumentsValue,
      fallbackDetail: kind === 'call' ? part.command ?? part.cmd : undefined,
    }),
    detail: printableDetail(detailValue),
  };
}

/** Resolve the activity described by one live `agent` tool frame. */
export function toolActivityFromLiveEvent(data: Record<string, unknown>): ToolActivity {
  const phase = stringValue(data.phase);
  const kind: ToolActivityKind = phase === 'start' ? 'call' : 'result';
  const failed = phase === 'error' || data.isError === true;
  const name = safeToolName(stringValue(data.name));
  const skillName = phase === 'start' ? skillNameFromArguments(name, data.args) : undefined;
  const payload = phase === 'start' ? data.args : phase === 'update' ? data.partialResult : data.result;
  return {
    kind,
    name,
    callId: stringValue(data.toolCallId) || stringValue(data.toolUseId) || stringValue(data.tool_use_id),
    status: phase === 'start' || phase === 'update' ? 'running' : failed ? 'failed' : 'ok',
    ...(skillName ? { skillName } : {}),
    ...(phase === 'result' && !failed && successfulSkillReadResult(name, payload) ? { resultSucceeded: true as const } : {}),
    summary: conciseToolSummary({
      name,
      phase: failed ? 'error' : phase,
      metadata: data.meta,
      argumentsValue: phase === 'start' ? data.args : undefined,
    }),
    detail: printableDetail(payload),
  };
}

/**
 * Index every tool call a history page declares, by call id. A result row
 * names the tool its call named; without that pairing a page can only report
 * an anonymous result, which reads as unattributed machine noise.
 */
export function toolCallActivityIndex(rows: readonly unknown[]) {
  const activities = new Map<string, ToolActivity>();
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    for (const activity of toolActivitiesFromContent(raw.content ?? raw.text ?? raw.message ?? raw.body)) {
      if (activity.kind === 'call' && activity.callId) activities.set(activity.callId, activity);
    }
  }
  return activities;
}

/**
 * Re-attribute a result to its own call. A failure keeps its status ahead of
 * the recovered action so the row states the outcome in the text a reader —
 * or a screen reader — receives before any colour or marker.
 */
export function toolActivityPairedWithCall(activity: ToolActivity, calls: ReadonlyMap<string, ToolActivity>) {
  const call = activity.kind === 'result' && activity.callId ? calls.get(activity.callId) : undefined;
  if (!call) return activity;
  const named = { ...toolActivityNamed(activity, call.name), ...(call.skillName ? { skillName: call.skillName } : {}) };
  return named.status === 'failed'
    ? { ...named, summary: boundedSummary(`${call.name} · failed · ${summaryAction(call.summary)}`) }
    : { ...named, summary: call.summary };
}

/**
 * Re-attribute an activity to the identity its paired call declared. A result
 * frame often carries no name of its own; renaming it must rewrite its
 * headline too, or the row reads with two names.
 */
export function toolActivityNamed(activity: ToolActivity, name: string): ToolActivity {
  const safe = safeToolName(name);
  if (safe === activity.name) return activity;
  return { ...activity, name: safe, summary: boundedSummary(`${safe} · ${summaryAction(activity.summary)}`) };
}

function summaryAction(summary: string) {
  const separator = summary.indexOf('·');
  return separator < 0 ? summary.trim() : summary.slice(separator + 1).trim();
}

/**
 * The transcript row body for one tool activity: a brace-free headline the
 * folded row can show verbatim, followed by the retained raw payload.
 */
export function toolRowText(activity: ToolActivity) {
  return [activity.summary, activity.detail].filter(Boolean).join('\n');
}

/**
 * Headline plus retained detail for a machine payload that is not a tool call
 * — an approval request or an agent stream error. Structured payloads must
 * never reach the reader as an unfolded object literal.
 */
export function machineActivitySummary(value: unknown, label: string) {
  const nested = isRecord(value) ? ['arguments', 'args', 'input', 'params', 'request', 'data'].map((key) => value[key]) : [];
  const action = firstAction([value, ...nested], '');
  return { summary: boundedSummary(action || label), detail: printableDetail(value) };
}

/** Last resort for a stored row that kept only its rendered text. */
function inferredToolActivity(fallbackText: string): ToolActivity {
  const name = safeToolName(nameFromText(fallbackText));
  return {
    kind: 'result',
    name,
    callId: '',
    status: 'ok',
    summary: conciseToolSummary({ name, phase: 'unknown', fallbackDetail: detailFromText(fallbackText) }),
    detail: fallbackText,
  };
}

function toolCallIdentity(part: Record<string, unknown>) {
  return stringValue(part.toolCallId) || stringValue(part.toolUseId) || stringValue(part.tool_use_id) || stringValue(part.id);
}

function printableDetail(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const text = value.map((part) => isRecord(part) && typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n');
    if (text) return text;
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}


export function conciseToolSummary(input: ToolSummaryInput) {
  const name = safeToolName(input.name);
  const phase = normalizedPhase(input.phase);
  const action = firstAction([input.metadata, input.argumentsValue, input.fallbackDetail], name);
  const status = action || statusForPhase(phase);
  return boundedSummary(`${name} · ${status}`);
}

export function preferredToolSummary(previous: string | undefined, incoming: string) {
  if (!previous || !isGenericToolSummary(incoming) || isGenericToolSummary(previous)) return incoming;
  return previous;
}

export function isGenericToolSummary(summary: string) {
  const status = summary.split('·').at(-1)?.trim().toLowerCase() ?? '';
  return genericStatuses.has(status);
}

function firstAction(values: unknown[], toolName: string) {
  for (const value of values) {
    const action = actionFromValue(value, toolName, new Set());
    if (action) return action;
  }
  return '';
}

function actionFromValue(value: unknown, toolName: string, visited: Set<unknown>): string {
  if (value === undefined || value === null || visited.has(value)) return '';
  if (typeof value === 'string') return actionFromString(value, toolName, visited);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    visited.add(value);
    for (const item of value) {
      const action = actionFromValue(item, toolName, visited);
      if (action) return action;
    }
    return '';
  }
  if (!isRecord(value)) return '';
  visited.add(value);
  const changedPath = changeSummary(value, toolName);
  if (changedPath) return changedPath;
  for (const key of semanticKeys) {
    if (commandLikeKey(key) && typeof value[key] === 'string') {
      const command = commandSummary(value[key]);
      if (command) return command;
    }
    const candidate = actionFromValue(value[key], toolName, visited);
    if (candidate) return commandLikeKey(key) ? commandSummary(candidate)
      : pathKeys.has(key) ? shortenedPath(candidate) : sanitizeAction(candidate);
  }
  return '';
}

function actionFromString(value: string, toolName: string, visited: Set<unknown>) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return actionFromValue(JSON.parse(trimmed), toolName, visited); } catch { return ''; }
  }
  if (trimmed.toLowerCase() === toolName.toLowerCase()) return '';
  const withoutDuplicateName = trimmed.replace(new RegExp(`^${escapeRegExp(toolName)}\\s*(?:[·:—-]+)\\s*`, 'i'), '');
  return sanitizeAction(withoutDuplicateName);
}

function commandSummary(value: string) {
  const command = unwrappedShellCommand(value);
  const normalized = sanitizeAction(command);
  if (!normalized) return '';
  if (/<<|[{}]|```|\b(?:node|python\d*|ruby|perl|bash|sh|zsh)\s+(?:-[a-z]*[ce]|--eval)\b/i.test(command)) {
    const executable = normalized.match(/^\S+/)?.[0] ?? 'shell';
    return `${executable.replace(/[^\w.+/-]/g, '') || 'shell'} command`;
  }
  const action = commandAction(normalized.split(/\s*(?:&&|;|\|\|)\s*/).map((segment) => segment.trim()).filter(Boolean));
  const elided = action.length > COMMAND_ACTION_BUDGET ? withoutCommandOptions(action) : action;
  return elided.length < normalized.length ? `${elided} …` : elided;
}

/**
 * A chained command begins by arranging its working directory. That is setup,
 * not the action a reader is looking for, and sibling calls that share one
 * launcher and one directory would otherwise summarize identically.
 */
function commandAction(segments: string[]) {
  const [first = '', ...rest] = segments;
  if (!rest.length) return first;
  if (/^cd\s+\S+$/.test(first)) return rest[0]!;
  const launcher = first.match(/^(.*\S)\s+(['"])cd\s+\S+$/);
  return launcher ? `${launcher[1]} ${launcher[2]}${rest[0]}` : first;
}

/**
 * Sibling invocations of one launcher differ in their operands, not in the
 * credentials, hosts and settings they configure. Once a command cannot fit
 * the row, drop only the options that carry such a value — otherwise distinct
 * calls truncate to the same unreadable prefix. Plain short flags stay: they
 * are frequently the whole point of the call.
 */
function withoutCommandOptions(value: string) {
  const tokens = value.split(/\s+/);
  const kept = tokens[0] ? [tokens[0]] : [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];
    const configured = Boolean(next) && !next!.startsWith('-') && /[=/]/.test(next!);
    if (!token.startsWith('-') || !(configured || /[=/]/.test(token))) { kept.push(token); continue; }
    if (configured) index += 1;
  }
  return kept.join(' ') || value;
}

function unwrappedShellCommand(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:\/[^\s]+\/)?(?:zsh|bash|sh)\s+-[a-z]*c\s+(['"])([\s\S]*)\1$/i);
  return match?.[2]?.trim() || trimmed;
}

function changeSummary(value: Record<string, unknown>, toolName: string) {
  if (!toolName.toLowerCase().includes('patch') || !Array.isArray(value.changes) || !value.changes.length) return '';
  const first = value.changes.find(isRecord);
  if (!first) return 'update files';
  const path = stringValue(first.path);
  const kind = isRecord(first.kind) ? stringValue(first.kind.type) : stringValue(first.kind);
  const label = path.split('/').filter(Boolean).at(-1) || 'file';
  return `${kind || 'update'} ${label}`;
}

/** A folded row names the file, not the reader's whole home directory. */
function shortenedPath(value: string) {
  const normalized = sanitizeAction(value);
  if (/\s/.test(normalized) || !normalized.includes('/')) return normalized;
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 2 ? segments.slice(-2).join('/') : normalized;
}

function sanitizeAction(value: string) {
  return value
    .replace(/```[^`]*```/g, 'code')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim();
}

function boundedSummary(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= TOOL_SUMMARY_CHARACTER_LIMIT) return normalized;
  return `${normalized.slice(0, TOOL_SUMMARY_CHARACTER_LIMIT - 1).trimEnd()}…`;
}

function statusForPhase(phase: ToolSummaryPhase) {
  if (phase === 'start') return 'running';
  if (phase === 'update') return 'updating';
  if (phase === 'result') return 'completed';
  if (phase === 'error') return 'failed';
  return 'activity';
}

function normalizedPhase(value: string | undefined): ToolSummaryPhase {
  const phase = value?.trim().toLowerCase() ?? '';
  if (phase.includes('error') || phase.includes('fail')) return 'error';
  if (phase.includes('result') || phase.includes('complete') || phase.includes('end')) return 'result';
  if (phase.includes('update') || phase.includes('progress') || phase.includes('delta')) return 'update';
  if (phase.includes('start') || phase.includes('begin') || phase.includes('running')) return 'start';
  return 'unknown';
}

function nameFromText(text: string) {
  const newline = text.indexOf('\n');
  const candidate = text.slice(0, newline < 0 ? Math.min(text.length, 256) : Math.min(newline, 256)).replace(/\r$/, '').trim();
  return safeToolName(candidate);
}

function detailFromText(text: string) {
  let start = text.indexOf('\n');
  while (start >= 0 && start + 1 < text.length) {
    const next = text.indexOf('\n', start + 1);
    const end = next < 0 ? text.length : next;
    const line = text.slice(start + 1, Math.min(end, start + 4097)).replace(/\r$/, '').trim();
    if (line) return line;
    start = next;
  }
  return '';
}

/**
 * The identity a row may print. A producer that lost its tool's name — an
 * external CLI whose protocol reached the client as text — still gets one
 * bounded, brace-free identity rather than an arbitrary fragment of payload.
 */
export function safeToolName(value: string | undefined) {
  const candidate = value?.trim() ?? '';
  if (/^[\w.+:/-]{1,48}$/.test(candidate)) return candidate;
  return 'tool';
}

function commandLikeKey(value: typeof semanticKeys[number]) { return value === 'command' || value === 'cmd'; }
function stringValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function toolSkillEvidence(activity: ToolActivity) {
  return { ...(activity.skillName ? { skillName: activity.skillName } : {}),
    ...(activity.resultSucceeded && activity.status === 'ok' && successfulSkillReadResult(activity.name, activity.detail) ? { resultSucceeded: true as const } : {}) };
}
