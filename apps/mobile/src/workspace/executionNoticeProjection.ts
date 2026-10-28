import type { WorkspaceMessage } from './workspaceTypes';

const headline = 'Background command status';
const bodyPrefix = `${headline}\n`;
const driftPrefix = /^OpenClaw resumed this CLI session after prompt content changed\. Follow the current turn's instructions; changed=(?:system-prompt|prompt-tools|system-prompt,prompt-tools)\.\n\n/;

/** Execution wakes are agent input, not a new human prompt or task failure.
 * Keep their raw diagnostic available under existing folded tool activity. */
export function isInternalExecutionNotice(raw: Record<string, unknown>) {
  const provenance = raw.provenance;
  return raw.role === 'user' && provenance !== null && typeof provenance === 'object' && !Array.isArray(provenance)
    && 'kind' in provenance && provenance.kind === 'internal_system'
    && 'sourceTool' in provenance && provenance.sourceTool === 'exec';
}

export function projectExecutionNotice(message: WorkspaceMessage, raw: Record<string, unknown>): WorkspaceMessage {
  if (!isInternalExecutionNotice(raw)) return message;
  return foldedExecutionNotice(message);
}

function foldedExecutionNotice(message: WorkspaceMessage): WorkspaceMessage {
  return { ...message, role: 'tool', internalEvent: 'exec', text: bodyPrefix + message.text,
    tool: { name: 'exec', summary: headline } };
}

/** A legacy native CLI import can lose the original event provenance. Only
 * fold an exact copy witnessed by a typed event in this concrete session.
 * Never classify a user quote by an Exec-looking prefix alone. Run after page
 * merges and cache restore as the witness and import can arrive separately. */
export function foldedExecutionNoticeMirrors(messages: WorkspaceMessage[]) {
  // One bounded index per projection, not an event-by-import quadratic scan.
  const witnessed = new Map<string, number>();
  for (const row of messages) {
    if (row.internalEvent !== 'exec' || row.role !== 'tool' || row.cliProvenance?.kind === 'claude-native'
      || !row.sessionKey || !row.transcriptSessionId || !row.text.startsWith(bodyPrefix)) continue;
    const at = timestamp(row.timestamp);
    if (at === null) continue;
    const key = scopeTextKey(row, row.text.slice(bodyPrefix.length));
    witnessed.set(key, Math.min(witnessed.get(key) ?? at, at));
  }
  if (!witnessed.size) return messages;
  // Retain identity and raw bytes instead of deleting imports. Deletion would
  // depend on how pagination partitions identical legacy records. Both copies
  // stay inspectable inside activity, with no new conversational prompt.
  const mirrored = new Set(messages.filter(row => {
    if (row.role !== 'user' || row.cliProvenance?.kind !== 'claude-native' || row.displayPosition
      || row.idempotencyKey || !driftPrefix.test(row.text)) return false;
    const at = timestamp(row.timestamp);
    const eventAt = witnessed.get(scopeTextKey(row, row.text.replace(driftPrefix, '')));
    return at !== null && eventAt !== undefined && eventAt <= at;
  }));
  return mirrored.size ? messages.map(row => {
    if (!mirrored.has(row)) return row;
    const { attachments: _diagnosticPaths, ...retained } = row;
    return foldedExecutionNotice(retained);
  }) : messages;
}

function scopeTextKey(row: WorkspaceMessage, text: string) {
  return JSON.stringify([row.sessionKey, row.transcriptSessionId, text]);
}

function timestamp(value: string | undefined) {
  if (!value) return null;
  const result = Number.isFinite(Number(value)) ? Number(value) : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
