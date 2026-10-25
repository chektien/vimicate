import { BoundedSessionCache } from '../workspace/boundedSessionCache';

const DEFAULT_DATASET_LIMIT = 64;
const DEFAULT_EXPANDED_MESSAGE_LIMIT = 480;

/**
 * Bounded process-local fold preferences. Fold state is presentation-only, so
 * an evicted dataset safely falls back to the compact transcript projection.
 */
export class SessionTranscriptFoldCache {
  private readonly datasets: BoundedSessionCache<Set<string>>;
  private readonly messageLimit: number;

  constructor(datasetLimit = DEFAULT_DATASET_LIMIT, messageLimit = DEFAULT_EXPANDED_MESSAGE_LIMIT) {
    this.datasets = new BoundedSessionCache(Math.max(1, Math.floor(datasetLimit)));
    this.messageLimit = Math.max(1, Math.floor(messageLimit));
  }

  expanded(datasetKey: string) {
    const stored = this.datasets.restore(datasetKey);
    return stored ? new Set(stored) : new Set<string>();
  }

  setExpanded(datasetKey: string, messageID: string, expanded: boolean) {
    if (!datasetKey || !messageID) return false;
    const stored = this.datasets.restore(datasetKey);
    const currentlyExpanded = stored?.has(messageID) ?? false;
    if (currentlyExpanded === expanded) return false;

    const next = new Set(stored);
    if (expanded) {
      next.add(messageID);
      while (next.size > this.messageLimit) {
        const oldestMessageID = next.values().next().value;
        if (oldestMessageID === undefined) break;
        next.delete(oldestMessageID);
      }
    } else {
      next.delete(messageID);
    }

    if (next.size === 0) this.datasets.delete(datasetKey);
    else this.datasets.store(datasetKey, next);
    return true;
  }

  toggle(datasetKey: string, messageID: string) {
    if (!datasetKey || !messageID) return false;
    const expanded = this.datasets.restore(datasetKey)?.has(messageID) ?? false;
    return this.setExpanded(datasetKey, messageID, !expanded);
  }
}
