import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export type SealTextDigest = { length: number; hash: number; check: number };

/** Appended by the transcript cache when it keeps only a prefix of a long row. */
export const CACHED_PREVIEW_NOTICE = '\n… [cached preview truncated; canonical history is refreshing]';

/** Bounded evidence of a seal's exact text, for a cache that truncates the visible copy. */
export function sealTextDigest(text: string): SealTextDigest {
  let hash = 0x811c9dc5; let check = 5381;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash = Math.imul(hash ^ code, 0x01000193);
    check = (Math.imul(check, 33) + code) | 0;
  }
  return { length: text.length, hash: hash >>> 0, check: check >>> 0 };
}

/**
 * A run whose live copy is wholly sealed has no envelope left to match, so
 * its seals retire against saved history directly. A Claude step saved at or
 * after the prompt its first seal follows is that commentary when the run's
 * seals, in order, are exactly its text: one seal, or the fragments a steered
 * prompt split it into, with only line breaks between them. Seals the saved steps do not reach yet move below
 * them so the turn reads in order.
 */
export function retireSealsOfSealedRuns(result: WorkspaceMessage[]) {
  const runs = new Map<string, WorkspaceMessage[]>();
  for (const seal of result) {
    if (!seal.steerSealed || !seal.runId || !seal.sessionKey) continue;
    const key = `${seal.sessionKey}\u0000${seal.runId}`;
    runs.set(key, [...(runs.get(key) ?? []), seal]);
  }
  for (const seals of runs.values()) {
    const first = seals[0]!;
    if (result.some(row => row.source === 'live' && row.role === 'assistant' && row.id === `live-chat-${first.runId}`
      && row.sessionKey === first.sessionKey && (row.text || row.claudeNativeFullText))) continue;
    const steps = result.filter(row => row.source === 'history' && row.cliProvenance?.kind === 'claude-native'
      && (row.role === 'narration' || row.role === 'assistant') && row.sessionKey === first.sessionKey
      && (!first.transcriptSessionId || !row.transcriptSessionId || row.transcriptSessionId === first.transcriptSessionId)
      && time(row) !== null);
    let lastCovering: WorkspaceMessage | undefined;
    for (let index = 0; index < seals.length;) {
      const prompt = result.slice(0, result.indexOf(seals[index]!)).findLast(row => row.role === 'user' && row.sessionKey === first.sessionKey);
      const since = prompt?.source === 'history' ? time(prompt) : null;
      let covered = 0;
      const covering = since === null ? undefined : steps.find(step => time(step)! >= since && (covered = sealsCovering(step.text, seals, index)) > 0);
      if (!covering) { index += 1; continue; }
      for (const seal of seals.slice(index, index + covered)) remove(result, seal);
      if (!lastCovering || result.indexOf(covering) > result.indexOf(lastCovering)) lastCovering = covering;
      index += covered;
    }
    const uncovered = seals.find(seal => result.includes(seal));
    if (!lastCovering || !uncovered || result.indexOf(lastCovering) < result.indexOf(uncovered)) continue;
    const stretch = result.slice(result.indexOf(uncovered), result.indexOf(lastCovering)).filter(row => row.source === 'live'
      && row.runId === first.runId && row.sessionKey === first.sessionKey && row.role !== 'run');
    for (const row of stretch) remove(result, row);
    result.splice(result.indexOf(lastCovering) + 1, 0, ...stretch);
  }
}

/** How many seals from `start`, in the order they were split, are exactly this saved text. */
function sealsCovering(saved: string, seals: WorkspaceMessage[], start: number) {
  for (const text of new Set([saved, saved.trim()])) {
    let offset = 0;
    for (let index = start; index < seals.length; index += 1) {
      const length = sealedLength(text, offset, seals[index]!);
      if (!length) break;
      offset += length;
      if (!text.slice(offset).trim()) return index - start + 1;
      // A seal sheds the line breaks around it; the saved step keeps them.
      while (text[offset] === '\n') offset += 1;
    }
  }
  return 0;
}

/** The length of this seal's text at `offset`, or 0. Text the seal still holds is compared directly;
 * only a cache-truncated seal falls back to its retained prefix plus the digest of its full text. */
function sealedLength(text: string, offset: number, seal: WorkspaceMessage) {
  const digest = seal.sealText;
  // The cache restores a digest only for a row it truncated. Lengths prove
  // nothing: a preview plus its notice can be exactly as long as the full text.
  if (!digest || !seal.text.endsWith(CACHED_PREVIEW_NOTICE)) {
    return seal.text && text.startsWith(seal.text, offset) ? seal.text.length : 0;
  }
  const slice = text.slice(offset, offset + digest.length);
  const actual = sealTextDigest(slice);
  return slice.length === digest.length && slice.startsWith(seal.text.slice(0, -CACHED_PREVIEW_NOTICE.length))
    && actual.hash === digest.hash && actual.check === digest.check ? digest.length : 0;
}

function remove(rows: WorkspaceMessage[], row: WorkspaceMessage) {
  const index = rows.indexOf(row);
  if (index >= 0) rows.splice(index, 1);
}

function time(row: WorkspaceMessage) {
  if (!row.timestamp) return null;
  const numeric = Number(row.timestamp);
  const value = Number.isFinite(numeric) ? numeric : Date.parse(row.timestamp);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
