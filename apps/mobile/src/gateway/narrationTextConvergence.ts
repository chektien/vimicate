import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** An absent live coordinate may be enriched, but an explicit conflict cannot. */
export function narrationOwnershipConflicts(left: WorkspaceMessage, right: WorkspaceMessage) {
  return left.sessionKey !== right.sessionKey
    || Boolean(left.runId && right.runId && left.runId !== right.runId)
    || Boolean(left.transcriptSessionId && right.transcriptSessionId && left.transcriptSessionId !== right.transcriptSessionId)
    || Boolean(left.narrationItemId && right.narrationItemId && left.narrationItemId !== right.narrationItemId);
}

/** Shared narration records and item frames publish cumulative text snapshots.
 * Choose bytes only after explicit item identity, independently of which row
 * owns source, lifecycle state, timestamps and durable authority metadata. */
export function sameNarrationIdentity(preferred: WorkspaceMessage, alternate: WorkspaceMessage) {
  if (preferred.role !== 'narration' || alternate.role !== 'narration'
    || !preferred.sessionKey || !preferred.runId || preferred.runId !== alternate.runId
    || narrationOwnershipConflicts(preferred, alternate)) return false;
  return preferred.id === alternate.id
    || Boolean(preferred.transcriptSessionId && preferred.transcriptSessionId === alternate.transcriptSessionId
      && preferred.narrationItemId && preferred.narrationItemId === alternate.narrationItemId);
}

export function cumulativeNarrationText(preferred: WorkspaceMessage, alternate: WorkspaceMessage) {
  return sameNarrationIdentity(preferred, alternate) && alternate.text.length > preferred.text.length && alternate.text.startsWith(preferred.text)
    ? alternate.text : preferred.text;
}

/** Never let identical row IDs collapse explicitly distinct narration owners. */
export function narrationMessageIdentity(message: WorkspaceMessage) {
  return JSON.stringify(['narration-message', message.sessionKey ?? '', message.runId ?? '',
    message.transcriptSessionId ?? '', message.narrationItemId ?? '', message.id]);
}

/** Enrich a same-ID alias only when every compatible owner agrees. Preserve
 * ambiguous aliases instead of binding them to whichever copy arrived first. */
export function identifyNarrationMessageOwners(messages: WorkspaceMessage[]) {
  const byID = new Map<string, WorkspaceMessage[]>();
  for (const row of messages) if (row.role === 'narration') {
    const key = JSON.stringify([row.sessionKey, row.id]);
    byID.set(key, [...(byID.get(key) ?? []), row]);
  }
  let changed = false;
  const identified = messages.map(row => {
    if (row.role !== 'narration') return row;
    const candidates = (byID.get(JSON.stringify([row.sessionKey, row.id])) ?? [])
      .filter(candidate => !narrationOwnershipConflicts(row, candidate));
    const fields = ['runId', 'transcriptSessionId', 'narrationItemId'] as const;
    const identity: Partial<WorkspaceMessage> = {};
    for (const field of fields) {
      const values = new Set(candidates.map(candidate => candidate[field]).filter(Boolean));
      if (values.size > 1) return row;
      const value = values.values().next().value;
      if (value && !row[field]) identity[field] = value;
    }
    if (!Object.keys(identity).length) return row;
    changed = true;
    return { ...row, ...identity };
  });
  return changed ? identified : messages;
}

/** A legacy transport ID can encode colliding run/item tuples. Retain its
 * first admitted fact, never emit duplicate render IDs or blend owners. */
export function rejectConflictingNarrationIDs(messages: WorkspaceMessage[]) {
  const groups = new Map<string, WorkspaceMessage[]>();
  for (const row of messages) if (row.role === 'narration') {
    const key = JSON.stringify([row.sessionKey, row.id]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const rejected = new Set<WorkspaceMessage>();
  for (const rows of groups.values()) {
    if (rows.some(left => rows.some(right => narrationOwnershipConflicts(left, right)))) {
      for (const row of rows.slice(1)) rejected.add(row);
    }
  }
  return rejected.size ? messages.filter(row => !rejected.has(row)) : messages;
}
