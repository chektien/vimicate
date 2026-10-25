// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('archived review persistence architecture', () => {
  it('owns durable review state separately from the latest transcript cache', () => {
    const store = source('src/storage/workspaceStore.ts');
    expect(store).toContain('CREATE TABLE IF NOT EXISTS history_review_cache');
    expect(store).toContain('export async function loadHistoryReviewCache');
    expect(store).toContain('export async function saveHistoryReviewCache');
    expect(store).toContain("enqueueDatabaseWrite(`history-review:${sessionKey}`");
  });

  it('hydrates only the still-selected empty immutable generation and never replaces a current tail', () => {
    const history = source('src/gateway/useGatewayHistory.ts');
    expect(history).toContain('historySelectionRevision.current !== restoreRevision');
    expect(history).toContain('activeSessionKey.current !== nextSessionKey');
    expect(history).toContain('restoredPersistedHistorySelection(\n        persisted.view');
    expect(history).toContain("windowMode.current = 'older'");
    expect(history).toContain('persistedTranscriptRestorePublication(\n          latest,\n          latestTailCache.current.restore(nextSessionKey) ?? [],\n          decorated,');
    expect(history).toContain('latestTailCache.current.store(nextSessionKey, publication.messages)');
    expect(history).toContain('clearPersistedHistoryReview(nextSessionKey)');
  });
});
