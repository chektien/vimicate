import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { convergedTranscriptRepresentation } from './transcriptIdentityWall';
import { restoreObservedTokenRedaction } from './observedTokenRedaction';

export type ClaudeNativeLiveMatch = {
  live: WorkspaceMessage;
  lastNative: WorkspaceMessage;
  footer: WorkspaceMessage | undefined;
  queued: WorkspaceMessage[];
  coveredLength: number;
  fullyCovered: boolean;
  restoredFinalText?: string;
};

/** Claude's native turn owns text coverage, the live tail and queued inputs. */
export function reconcileClaudeNativeLive(messages: WorkspaceMessage[], previouslyProven: ClaudeNativeLiveMatch[] = []) {
  const result = [...messages];
  const matches = claudeNativeLiveMatches(messages);
  for (const match of previouslyProven) if (!matches.some(candidate => candidate.live.id === match.live.id
    && candidate.live.sessionKey === match.live.sessionKey)) matches.push(match);
  for (const { live, lastNative, footer, queued, coveredLength, fullyCovered, restoredFinalText } of matches) {
    let nativeAnchor = result.find(row => row.id === lastNative.id && row.source === 'history'
      && row.sessionKey === lastNative.sessionKey && row.transcriptSessionId === lastNative.transcriptSessionId);
    if (!nativeAnchor) continue;
    if (restoredFinalText) {
      // The proven aggregate aliases this native answer. Preserve its slot and
      // prose, restoring only an exactly recognized, previously delivered URL
      // token. Remember the envelope identity so late replay cannot reopen it.
      const canonical = { ...nativeAnchor, state: 'complete' as const,
        text: restoreObservedTokenRedaction(nativeAnchor.text, restoredFinalText) ?? nativeAnchor.text };
      const replacement = convergedTranscriptRepresentation(canonical, live);
      result[result.indexOf(nativeAnchor)] = replacement;
      nativeAnchor = replacement;
    }
    // Native history now holds the commentary the steer seals stood in for.
    for (const sealed of result.filter(row => row.steerSealed && row.runId === live.runId && row.sessionKey === live.sessionKey)) remove(result, sealed);
    const fullText = cumulativeText(live);
    // A previously proven match can refer to a copy the merge has since
    // replaced; retire the published row with the same live identity.
    const published = result.find(row => row.source === 'live' && row.id === live.id
      && row.sessionKey === live.sessionKey && row.runId === live.runId) ?? live;
    if (fullyCovered && live.state === 'complete' || coveredLength === fullText.length) {
      remove(result, published);
      // A footer re-derived from the live answer leaves the merge with it;
      // a turn with no end-turn answer would then lose its completion row.
      if (footer && !result.includes(footer) && !turnHasCompletion(result, nativeAnchor)) result.splice(result.indexOf(nativeAnchor) + 1, 0, footer);
    } else if (coveredLength) {
      const index = result.indexOf(published);
      if (index >= 0) result[index] = { ...live, text: fullText.slice(coveredLength).replace(/^\n\n?/, ''), claudeNativeFullText: fullText };
    }
    const visibleLive = result.find(row => row.source === 'live' && row.id === live.id
      && row.sessionKey === live.sessionKey && row.runId === live.runId);
    if (visibleLive) moveAfter(result, visibleLive, nativeAnchor);
    if (footer) moveAfter(result, footer, visibleLive ?? nativeAnchor);
    for (const input of queued) remove(result, input);
    const anchor = footer ?? visibleLive ?? nativeAnchor;
    if (result.includes(anchor)) result.splice(result.indexOf(anchor) + 1, 0, ...queued);
  }
  return result;
}

export function provenClaudeNativeLive(messages: WorkspaceMessage[]): ClaudeNativeLiveMatch[] {
  return claudeNativeLiveMatches(messages).filter(match => match.live.state === 'complete'
    && match.fullyCovered && Boolean(match.footer));
}

function claudeNativeLiveMatches(messages: WorkspaceMessage[]): ClaudeNativeLiveMatch[] {
  const matches: ClaudeNativeLiveMatch[] = [];
  for (const live of messages) {
    if (live.source !== 'live' || live.role !== 'assistant' || !live.sessionKey || !live.runId
      || live.id !== `live-chat-${live.runId}` || !cumulativeText(live) || live.attachments?.length || live.recovery) continue;
    let footers = messages.filter(row => isRunFooter(row, live));
    if (footers.length > 1) continue;
    const candidates = nativeCandidates(messages, live);
    if (candidates.length !== 1) continue;
    if (live.state === 'complete' && !footers.length) footers = savedAnswerFooters(messages, live, candidates[0]!.lastNative);
    if (live.state === 'complete' && footers.length !== 1 && !candidates[0]!.restoredFinalText) continue;
    matches.push({ live, ...candidates[0]!, footer: footers[0] });
  }
  return matches;
}

function nativeCandidates(rows: WorkspaceMessage[], live: WorkspaceMessage, trace?: string[]) {
  // Bound the live row's time against this turn's first text part and last
  // native row. Five seconds admits clock skew at either turn edge.
  const TURN_EDGE_TOLERANCE_MS = 5_000;
  const liveAt = time(live);
  const footerAt = live.state === 'complete' ? time(rows.find(row => isRunFooter(row, live)) ?? live) : null;
  const liveText = cumulativeText(live);
  const scoped = rows.filter(row => row.source === 'history' && row.sessionKey === live.sessionKey
    && row.transcriptSessionId && (!live.transcriptSessionId || row.transcriptSessionId === live.transcriptSessionId)
    && time(row) !== null).sort((a, b) => time(a)! - time(b)!);
  const texts = scoped.filter((row): row is WorkspaceMessage & { cliProvenance: { kind: 'claude-native'; sessionId: string; externalId: string } } => row.cliProvenance?.kind === 'claude-native'
    && (row.role === 'narration' || row.role === 'assistant') && Boolean(row.text.trim())
    && !row.displayPosition && !row.attachments?.length && !row.recovery
    && row.state !== 'streaming' && row.state !== 'error'
    && row.id === row.cliProvenance.externalId);
  const candidates: Array<Omit<ClaudeNativeLiveMatch, 'live' | 'footer'>> = [];
  for (const first of texts) {
    const firstProvenance = first.cliProvenance;
    if (!liveText.startsWith(first.text) && !first.text.startsWith(liveText)
      && !restoreObservedTokenRedaction(first.text, liveText)) { trace?.push('text'); continue; }
    const firstAt = time(first)!;
    // The first live frame can arrive untimed; the row then keeps the time of
    // its first timed frame, which can be any later moment of the same turn
    // (the second commentary was 5ms apart in the reproduced case). The row's time
    // must fall inside this turn's native window; the upper bound is below.
    if (liveAt !== null && liveAt < firstAt - TURN_EDGE_TOLERANCE_MS) { trace?.push('time'); continue; }
    const positionedPrompt = scoped.filter(row => row.role === 'user' && row.displayPosition
      && row.transcriptSessionId === first.transcriptSessionId
      && row.idempotencyKey?.endsWith(':user') && time(row)! <= firstAt)
      .findLast(row => !scoped.some(candidate => candidate.role === 'user'
        && candidate.cliProvenance?.kind === 'claude-native'
        && time(candidate)! > time(row)! && time(candidate)! < firstAt));
    const nativeBoundary = scoped.findLast(row => row !== first
      && time(row)! <= Math.min(liveAt ?? firstAt, firstAt)
      && row.transcriptSessionId === first.transcriptSessionId
      && (row.role === 'boundary' || row.role === 'assistant' && (row.displayPosition
        || row.cliProvenance?.kind === 'claude-native')
        || row.role === 'user' && row.cliProvenance?.kind === 'claude-native'));
    // Positioned inputs accepted before the native answer are queued inside
    // this turn. After that answer, a positioned native prompt starts the next
    // turn. Tool-result-only native user messages project as tool rows above.
    const answerAt = scoped.find(row => time(row)! >= firstAt && row.role === 'assistant'
      && row.cliProvenance?.kind === 'claude-native');
    const endRow = scoped.find(row => time(row)! > firstAt && (row.role === 'boundary'
      || row.role === 'user' && row.cliProvenance?.kind === 'claude-native'
        && (!row.displayPosition || answerAt && time(row)! > time(answerAt)!)));
    const end = endRow ? time(endRow)! : Infinity;
    // History still shows this turn open: no later prompt, no end-turn answer.
    // A streaming copy holding its whole first commentary is this turn's copy
    // whatever its stamp. A reconnect stamps the first frame with the current
    // time, and a retired copy's next frame can arrive untimed. The reproduced
    // turn repeated its whole commentary below the saved rows.
    const openTurn = live.state !== 'complete' && !endRow && !answerAt && liveText.startsWith(first.text);
    const start = nativeBoundary ?? positionedPrompt;
    // An unpositioned run needs both a prior native boundary and its own first
    // frame time. Otherwise an equal-text earlier turn can masquerade as it.
    if (!start || time(start)! >= firstAt || start.transcriptSessionId !== first.transcriptSessionId
      || !positionedPrompt && (liveAt === null && !openTurn || !nativeBoundary)) { trace?.push('boundary'); continue; }
    const startAt = time(start)!;
    // A completed live row can be untimed. A later native prompt already before
    // that row, or a timed footer beyond the native turn, rules out this copy.
    if (liveAt === null && live.state === 'complete' && (footerAt !== null
      ? footerAt < firstAt - TURN_EDGE_TOLERANCE_MS || footerAt >= end
      : endRow && rows.indexOf(endRow) < rows.indexOf(live))) { trace?.push('time'); continue; }
    if (scoped.some(row => row.cliProvenance?.kind === 'claude-native'
      && row.transcriptSessionId !== start.transcriptSessionId
      && time(row)! >= firstAt && time(row)! < end)) { trace?.push('generation'); continue; }
    const nativeWindow = scoped.filter((row): row is WorkspaceMessage & { cliProvenance: { kind: 'claude-native'; sessionId: string; externalId: string } } => time(row)! > startAt && time(row)! < end
      && row.cliProvenance?.kind === 'claude-native');
    if (nativeWindow.some(row => row.cliProvenance.sessionId !== firstProvenance.sessionId
      || row.runId && row.runId !== live.runId)) { trace?.push('window'); continue; }
    const parts = nativeWindow.filter(row => (row.role === 'narration' || row.role === 'assistant') && row.text.trim());
    if (!parts.length || parts[0] !== first || parts.some(row => !texts.includes(row))
      || new Set(parts.map(row => row.cliProvenance?.kind === 'claude-native'
        ? row.cliProvenance.externalId : '')).size !== parts.length) { trace?.push('parts'); continue; }
    if (scoped.some(row => row.role === 'assistant' && row.cliProvenance?.kind !== 'claude-native'
      && time(row)! > startAt && time(row)! < end)) { trace?.push('foreign'); continue; }
    if (liveAt !== null && !openTurn && liveAt > time(nativeWindow.at(-1)!)! + TURN_EDGE_TOLERANCE_MS) { trace?.push('late'); continue; }
    const exactCoverage = coveredPrefix(parts.map(row => row.text), liveText);
    const coverage = exactCoverage?.fullyCovered ? exactCoverage
      : redactedTerminalCoverage(scoped, start, parts, nativeWindow.at(-1)!, live) ?? exactCoverage;
    if (!coverage) { trace?.push('coverage'); continue; }
    if (live.state === 'complete' && !coverage.fullyCovered) { trace?.push('partial'); continue; }
    // Only inputs that became their own native turn were queued behind this
    // one; they move after its answer. A steered input has Gateway position
    // but no native provenance: Claude absorbed it mid-turn, so it keeps its
    // send position, matching a fresh history load.
    const queued = scoped.filter(row => row.role === 'user' && row.displayPosition
      && row.cliProvenance?.kind === 'claude-native'
      && row.idempotencyKey?.endsWith(':user') && row !== start && row !== positionedPrompt
      && time(row)! > startAt && time(row)! < end);
    const lastNative = nativeWindow.at(-1)!;
    candidates.push({ lastNative, queued, ...coverage });
  }
  return candidates;
}

/** A redacted final needs stronger identity than the exact-text legacy path.
 * Bind one positioned native prompt to the live run, one concrete generation
 * and native CLI session, and exactly one terminal native answer. Commentary
 * must be the exact ordered prefix, never dropped or matched by similarity. */
function redactedTerminalCoverage(scoped: WorkspaceMessage[], prompt: WorkspaceMessage,
  parts: WorkspaceMessage[], lastNative: WorkspaceMessage, live: WorkspaceMessage) {
  const native = prompt.cliProvenance;
  if (live.state !== 'complete' || prompt.role !== 'user' || !prompt.displayPosition
    || !prompt.transcriptSessionId || native?.kind !== 'claude-native'
    || prompt.idempotencyKey !== `${live.runId}:user` || prompt.runId && prompt.runId !== live.runId
    || live.transcriptSessionId && live.transcriptSessionId !== prompt.transcriptSessionId
    || scoped.filter(row => row.role === 'user' && row.idempotencyKey === prompt.idempotencyKey).length !== 1) return null;
  const final = parts.at(-1)!;
  if (final !== lastNative || final.role !== 'assistant' || parts.filter(row => row.role === 'assistant').length !== 1
    || final.asyncMessage || final.asyncQuestion || final.absorbedLiveIdentity
    || parts.some(row => row.transcriptSessionId !== prompt.transcriptSessionId
      || row.cliProvenance?.kind !== 'claude-native' || row.cliProvenance.sessionId !== native.sessionId
      || row.id !== row.cliProvenance.externalId)) return null;
  for (const joiner of ['\n\n', '\n']) {
    const prefix = parts.length > 1 ? `${parts.slice(0, -1).map(row => row.text).join(joiner)}${joiner}` : '';
    const full = cumulativeText(live);
    if (!full.startsWith(prefix)) continue;
    const restoredFinalText = restoreObservedTokenRedaction(final.text, full.slice(prefix.length));
    if (restoredFinalText) return { coveredLength: full.length, fullyCovered: true, restoredFinalText };
  }
  return null;
}

/** Why a live Claude row is or is not retired, for `:diagnostics`. */
export function claudeNativeLiveDiagnosis(messages: WorkspaceMessage[], live: WorkspaceMessage) {
  if (live.source !== 'live' || live.role !== 'assistant') return 'not-live-assistant';
  if (!live.runId || live.id !== `live-chat-${live.runId}` || !live.text || live.attachments?.length || live.recovery) return 'shape';
  const footers = messages.filter(row => isRunFooter(row, live));
  if (footers.length > 1) return `footer=${footers.length}`;
  const trace: string[] = [];
  const candidates = nativeCandidates(messages, live, trace);
  const counts = [...new Set(trace)].map(reason => `${reason}:${trace.filter(item => item === reason).length}`).join(',');
  if (candidates.length !== 1) return `candidates=${candidates.length} ${counts || 'no-native-text'}`;
  if (live.state === 'complete' && !footers.length && !candidates[0]!.restoredFinalText) {
    const saved = savedAnswerFooters(messages, live, candidates[0]!.lastNative);
    if (saved.length !== 1) return `footer=0 saved=${saved.length}`;
  }
  return 'match';
}

/**
 * The run's completed footer. A history refresh can re-derive it from the live
 * answer itself as `history-run-<live id>`; that is still this run's footer.
 */
function isRunFooter(row: WorkspaceMessage, live: WorkspaceMessage) {
  return row.role === 'run' && row.runId === live.runId && row.sessionKey === live.sessionKey && row.state === 'complete'
    && (row.source === 'live' && row.id === `live-run-${live.runId}` || row.source === 'history' && row.id === `history-run-${live.id}`);
}

/**
 * A completed live copy stamped at its first commentary sorts above the turn's
 * tool rows, so history rebuilds the footer from the saved end-turn answer
 * instead (`history-run-<answer id>`). That footer is still this run's
 * completion when it belongs to exactly the native answer the copy matched.
 */
function savedAnswerFooters(rows: WorkspaceMessage[], live: WorkspaceMessage, lastNative: WorkspaceMessage) {
  if (lastNative.role !== 'assistant') return [];
  return rows.filter(row => row.role === 'run' && row.state === 'complete' && row.source === 'history'
    && row.sessionKey === live.sessionKey && row.id === `history-run-${lastNative.id}`);
}

function turnHasCompletion(rows: WorkspaceMessage[], anchor: WorkspaceMessage) {
  for (let index = rows.indexOf(anchor); index >= 0 && index < rows.length; index += 1) {
    const row = rows[index]!;
    if (index > rows.indexOf(anchor) && (row.role === 'user' || row.role === 'boundary')) return false;
    if (row.role === 'run' && row.state === 'complete') return true;
  }
  return false;
}

function cumulativeText(live: WorkspaceMessage) {
  const prior = live.claudeNativeFullText;
  return prior && prior.endsWith(live.text) && live.text !== prior ? prior : live.text;
}

function coveredPrefix(parts: string[], liveText: string) {
  const marker = '...<truncated>';
  for (const joiner of ['\n\n', '\n']) {
    const joined = parts.join(joiner);
    const full = joined.startsWith(liveText)
      || liveText.endsWith(marker) && joined.startsWith(liveText.slice(0, -marker.length));
    if (full) return { coveredLength: liveText.length, fullyCovered: true };
    let coveredLength = 0;
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}${joiner}${part}` : part;
      if (liveText.startsWith(prefix) && (liveText.length === prefix.length
        || liveText.slice(prefix.length).startsWith(joiner))) coveredLength = prefix.length;
      else break;
    }
    if (coveredLength) return { coveredLength, fullyCovered: false };
  }
  return null;
}

function remove(rows: WorkspaceMessage[], row: WorkspaceMessage) {
  const index = rows.indexOf(row);
  if (index >= 0) rows.splice(index, 1);
}
function moveAfter(rows: WorkspaceMessage[], row: WorkspaceMessage, anchor: WorkspaceMessage) {
  if (!rows.includes(row) || !rows.includes(anchor) || row === anchor) return;
  remove(rows, row);
  rows.splice(rows.indexOf(anchor) + 1, 0, row);
}
function time(row: WorkspaceMessage) {
  if (!row.timestamp) return null;
  const numeric = Number(row.timestamp);
  const value = Number.isFinite(numeric) ? numeric : Date.parse(row.timestamp);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
