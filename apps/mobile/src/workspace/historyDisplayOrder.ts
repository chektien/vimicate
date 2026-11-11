import { transcriptInputAcceptedAt, type TranscriptDisplayPosition } from './transcriptMetadata';

type Positioned = { inputAcceptedAtMs?: number; timestamp?: string; displayPosition?: TranscriptDisplayPosition; role?: string; transcriptSessionId?: string; sessionKey?: string; source?: string };

/**
 * Legacy JSONL rows use embedded timestamps. Native SQLite rows use their
 * validated placement coordinates instead. Never sort across a native source
 * boundary; physical pagination offsets are not display coordinates.
 */
export function historyDisplayOrder<T extends Positioned>(messages: T[], eligible: (message: T) => boolean) {
  return composeSharedNarration(messages, base => orderedSegments(base, eligible));
}

/** Re-evaluate only shared/native gaps after optimistic rows join a page.
 * This does not timestamp-sort live details or move native base records. */
export function sharedNarrationDisplayOrder<T extends Positioned>(messages: T[]) {
  return composeSharedNarration(messages, base => base);
}

function composeSharedNarration<T extends Positioned>(messages: T[], orderBase: (base: T[]) => T[]) {
  const owners = new Set(messages.filter(row => row.displayPosition).map(row => row.transcriptSessionId).filter(Boolean));
  const shared = new Set(messages.filter(row => (row.role === 'narration' && !row.displayPosition || row.role === 'user' && transcriptInputAcceptedAt(row.inputAcceptedAtMs) !== undefined)
    && row.transcriptSessionId && owners.has(row.transcriptSessionId) && timestampMilliseconds(row.timestamp) !== null
    && (row.role !== 'user' || messages.some(candidate => candidate.displayPosition
      && candidate.transcriptSessionId === row.transcriptSessionId && candidate.sessionKey === row.sessionKey))));
  const canonical = orderBase(messages);
  const attachments = new Map<T, T[]>();
  const attached = new Set<T>();
  for (const row of shared) {
    if (row.role !== 'user') continue;
    const bundle: T[] = [];
    for (let index = canonical.indexOf(row) + 1; index < canonical.length; index++) {
      const candidate = canonical[index]!;
      if (candidate.displayPosition || shared.has(candidate) || candidate.role === 'boundary'
        || candidate.sessionKey !== row.sessionKey || candidate.transcriptSessionId && candidate.transcriptSessionId !== row.transcriptSessionId
        || candidate.source !== 'live' && candidate.source !== 'local') break;
      bundle.push(candidate); attached.add(candidate);
    }
    attachments.set(row, bundle);
  }
  const output = canonical.filter(row => !shared.has(row) && !attached.has(row));
  // Shared narration and accepted inputs own host-timed gaps. Delayed input
  // ingestion must not move an already-visible prompt behind later output.
  // Keep remaining native rows in their authoritative relative order, without
  // inventing rawSeq. Recompute from the canonical base after every page merge.
  for (const row of [...shared].sort((a, b) => placementTime(a)! - placementTime(b)!)) {
    const slot = canonical.indexOf(row);
    const anchor = row.displayPosition ? slot : canonical.findLastIndex(candidate => candidate.displayPosition && samePartition(candidate, row));
    const nativeSource = canonical[anchor]?.displayPosition?.source;
    const barrier = (candidate: T) => candidate.role === 'boundary'
      || !candidate.displayPosition && !shared.has(candidate) && candidate.source !== 'live' && candidate.source !== 'local'
        && (!candidate.sessionKey || !candidate.transcriptSessionId)
      || candidate.sessionKey && candidate.sessionKey !== row.sessionKey
      || candidate.transcriptSessionId && candidate.transcriptSessionId !== row.transcriptSessionId
      || nativeSource && candidate.displayPosition && candidate.displayPosition.source !== nativeSource;
    let begin = anchor;
    let end = anchor + 1;
    while (begin > 0 && !barrier(canonical[begin - 1]!)) begin--;
    while (end < canonical.length && !barrier(canonical[end]!)) end++;
    const interval = new Set(canonical.slice(Math.max(0, begin), end));
    const prior = row.role === 'user' ? canonical.slice(Math.max(0, begin), slot).findLast(candidate => samePartition(candidate, row)
      && !candidate.displayPosition?.activity && placementTime(candidate) !== null && placementTime(candidate)! <= placementTime(row)!) : undefined;
    const barrierRow = begin > 0 ? canonical[begin - 1] : undefined;
    const floor = prior ? output.indexOf(prior) + 1 : barrierRow ? output.indexOf(barrierRow) + 1 : 0;
    const owned = output.map((candidate, index) => ({ candidate, index })).filter(({ candidate, index }) => index >= floor && interval.has(candidate) && (
      samePartition(candidate, row) || localPromptInNativeTail(output, index, row)));
    const next = owned.find(({ candidate }) => timestampMilliseconds(candidate.timestamp) !== null
      && placementTime(candidate)! > placementTime(row)!);
    const at = next?.index ?? (owned.at(-1)?.index !== undefined ? owned.at(-1)!.index + 1 : floor);
    output.splice(at, 0, row, ...(attachments.get(row) ?? []));
  }
  return output.every((message, index) => message === messages[index]) ? messages : output;
}

/** An optimistic prompt has no native coordinate yet. It still owns a dated
 * gap in the same session's tail. Include it without fabricating rawSeq or
 * generation metadata, and never carry that ownership across a boundary. */
function localPromptInNativeTail<T extends Positioned>(rows: T[], index: number, narration: T) {
  const prompt = rows[index]!;
  if (prompt.source !== 'local' || prompt.role !== 'user' || !prompt.sessionKey
    || prompt.sessionKey !== narration.sessionKey || prompt.transcriptSessionId
    || timestampMilliseconds(prompt.timestamp) === null) return false;
  for (let before = index - 1; before >= 0; before -= 1) {
    const candidate = rows[before]!;
    if (candidate.role === 'boundary' || candidate.sessionKey && candidate.sessionKey !== prompt.sessionKey) return false;
    if (candidate.displayPosition) return candidate.transcriptSessionId === narration.transcriptSessionId;
  }
  return false;
}
function samePartition(left: Positioned, right: Positioned) {
  return left.role !== 'boundary' && right.role !== 'boundary'
    && left.sessionKey === right.sessionKey && left.transcriptSessionId === right.transcriptSessionId
    && (!left.displayPosition || !right.displayPosition || left.displayPosition.source === right.displayPosition.source);
}

function orderedSegments<T extends Positioned>(messages: T[], eligible: (message: T) => boolean) {
  const output: T[] = [];
  let begin = 0;
  while (begin < messages.length) {
    const first = messages[begin]!;
    const source = first.displayPosition?.source;
    const attachments = new Map<T, T[]>();
    const segment: T[] = [first];
    let anchor = first;
    let end = begin + 1;
    while (end < messages.length) {
      const candidate = messages[end]!;
      if (!samePartition(first, candidate) && !(source && !candidate.displayPosition && candidate.sessionKey === first.sessionKey
        && !candidate.transcriptSessionId && (candidate.source === 'local' || candidate.source === 'live'))) break;
      if (candidate.displayPosition?.source === source) {
        segment.push(candidate); anchor = candidate;
      } else if (source && !candidate.displayPosition && (candidate.source === 'local' || candidate.source === 'live')
        && candidate.sessionKey === first.sessionKey && (!candidate.transcriptSessionId || candidate.transcriptSessionId === first.transcriptSessionId)) {
        attachments.set(anchor, [...(attachments.get(anchor) ?? []), candidate]);
      } else break;
      end += 1;
    }
    const ordered = source === undefined ? legacyOrder(segment, eligible) : nativeOrder(segment);
    for (const row of ordered) output.push(row, ...(attachments.get(row) ?? []));
    begin = end;
  }
  return output.every((message, index) => message === messages[index]) ? messages : output;
}

function legacyOrder<T extends Positioned>(messages: T[], eligible: (message: T) => boolean) {
  const slots = messages.map((message, index) => ({ message, index, timestamp: timestampMilliseconds(message.timestamp) }));
  const sorted = slots.filter((entry) => eligible(entry.message) && entry.timestamp !== null)
    .sort((a, b) => a.timestamp! - b.timestamp! || a.index - b.index);
  let next = 0;
  return slots.map((entry) => eligible(entry.message) && entry.timestamp !== null ? sorted[next++]!.message : entry.message);
}

function nativeOrder<T extends Positioned>(messages: T[]) {
  const rows = messages.map((message) => ({ message, position: message.displayPosition! }));
  const stable = rows.filter((row) => !row.position.activity).sort((a, b) => a.position.rawSeq - b.position.rawSeq);
  const activities = rows.flatMap((row) => row.position.activity ? [{ ...row, activity: row.position.activity }] : []);
  if (!activities.length) return stable.map(row => row.message);
  activities.sort((a, b) => {
    const left = a.activity.afterRawSeq;
    const right = b.activity.afterRawSeq;
    return left === right ? a.position.rawSeq - b.position.rawSeq : left === null ? -1 : right === null ? 1 : left - right;
  });
  const output: T[] = [];
  let next = 0;
  const emitGap = (beforeRawSeq = Infinity) => {
    const cohorts = new Map<string, { firstSeq: number; rows: typeof activities }>();
    while (next < activities.length) {
      const row = activities[next]!;
      if (row.activity.afterRawSeq !== null && row.activity.afterRawSeq >= beforeRawSeq) break;
      const cohort = cohorts.get(row.activity.scopeId) ?? { firstSeq: row.position.rawSeq, rows: [] };
      cohort.firstSeq = Math.min(cohort.firstSeq, row.position.rawSeq);
      cohort.rows.push(row);
      cohorts.set(row.activity.scopeId, cohort);
      next += 1;
    }
    for (const cohort of [...cohorts.values()].sort((a, b) => a.firstSeq - b.firstSeq)) {
      cohort.rows.sort((a, b) => a.activity.startOrder - b.activity.startOrder || a.position.rawSeq - b.position.rawSeq);
      for (const row of cohort.rows) output.push(row.message);
    }
  };
  for (const row of stable) {
    emitGap(row.position.rawSeq);
    output.push(row.message);
  }
  emitGap();
  return output;
}

function placementTime(row: Positioned) {
  return row.role === 'user' && transcriptInputAcceptedAt(row.inputAcceptedAtMs) !== undefined ? row.inputAcceptedAtMs : timestampMilliseconds(row.timestamp);
}

function timestampMilliseconds(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
