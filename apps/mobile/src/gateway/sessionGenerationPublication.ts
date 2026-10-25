import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { sameSessionGeneration, type GatewaySessionGeneration } from './registrySessionIdentity';
import { sessionOwnsVisiblePublication } from './sessionPublicationOwnership';

export function sessionGenerationChanged(
  previous: GatewaySessionGeneration | null,
  next: GatewaySessionGeneration | null,
) {
  if (!next) return false;
  return !sameSessionGeneration(previous, next);
}

/**
 * A stable Vimicate project key can be rebound to a new OpenClaw session after
 * `/new` or a scheduled reset. Rows cached under the stable key are not proof
 * that they belong to the replacement generation. Retain only rows whose
 * source timestamp is at or after the host-authoritative generation start.
 * The negotiated SQLite model instead preserves canonical display history
 * across same-ID model-context resets. Only explicit concrete history identity
 * proves that ownership; local/live rows still require the current epoch.
 */
export function messagesOwnedBySessionGeneration(
  messages: WorkspaceMessage[],
  generation: GatewaySessionGeneration | null,
) {
  if (!generation) return messages;
  return messages.filter((message) => {
    if (generation.historyModel === 'sqlite-display-v1' && message.source === 'history' && message.transcriptSessionId) {
      return message.transcriptSessionId === generation.sessionId;
    }
    if (!generation.sessionStartedAtMs) return true;
    const timestamp = timestampMilliseconds(message.timestamp);
    return timestamp !== null && timestamp >= generation.sessionStartedAtMs;
  });
}

export function generationReboundPublication(
  windowMode: 'latest' | 'older',
  visible: WorkspaceMessage[],
  latest: WorkspaceMessage[],
  generation: GatewaySessionGeneration | null,
) {
  const ownedLatest = messagesOwnedBySessionGeneration(latest, generation);
  return {
    // A reader parked in archived scrollback owns the mounted dataset. A
    // reconnect may discover that the stable route now points at a new
    // immutable session, but that discovery must update only the hidden latest
    // tail until the reader explicitly returns with G. Filtering the mounted
    // review here used to contract the list beneath the viewport and caused
    // the foreground blank/snap family.
    visible: windowMode === 'older'
      ? visible
      : messagesOwnedBySessionGeneration(visible, generation),
    latest: ownedLatest,
  };
}

/**
 * A generation rebound can be discovered by an asynchronous registry refresh,
 * while React may apply its functional state update after a project switch or
 * an even newer `/new`. Re-check both the selected dataset and immutable
 * generation at application time; filtering another thread with this route's
 * generation timestamp can otherwise erase its entire visible transcript.
 */
export function generationReboundVisiblePublication(
  publicationSessionKey: string,
  selectedSessionKey: string,
  activeSessionKey: string,
  publicationGeneration: GatewaySessionGeneration | null,
  activeGeneration: GatewaySessionGeneration | null,
  windowMode: 'latest' | 'older',
  current: WorkspaceMessage[],
  latest: WorkspaceMessage[],
) {
  const ownsGeneration = Boolean(publicationGeneration && activeGeneration && sameSessionGeneration(publicationGeneration, activeGeneration));
  if (!ownsGeneration || !sessionOwnsVisiblePublication(publicationSessionKey, selectedSessionKey, activeSessionKey)) return current;
  return generationReboundPublication(windowMode, current, latest, publicationGeneration).visible;
}

function timestampMilliseconds(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
