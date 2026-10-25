// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('stable-key session generation architecture', () => {
  it('purges the preceding live tail and reloads canonical history on generation rebound', () => {
    const history = source('src/gateway/useGatewayHistory.ts');
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    expect(history).toContain('sessionGenerationChanged(sessionGeneration.current, nextGeneration)');
    expect(history).toContain('generationReboundPublication(windowMode.current, cachedVisible, cachedLatest, nextGeneration)');
    expect(history).toContain("if (windowMode.current === 'latest') historyCache.current.store(project.sessionKey, retained.visible)");
    expect(history).toContain('generationReboundVisiblePublication(');
    expect(history).toContain('project.sessionKey, selectedRef.current, activeSessionKey.current');
    expect(history).toContain('nextGeneration, sessionGeneration.current');
    expect(history).toContain('publicationAuthority.current?.owns(generationActivityRevision)');
    expect(history).not.toContain('generationReboundPublication(windowMode.current, current, retained.latest, nextGeneration).visible');
    expect(history).toContain("return generationRebound ? 'generation' : transition");
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).toContain("generationChanged = configureArchive(selectedProject, registrySnapshot.current) === 'generation'");
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).toContain('if (shouldHydrateSelectedHistory(');
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).toContain('Boolean(runRegistry.current.runFor(key))');
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).toContain('intent.hydrateSelected || requiredHistory');
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).toContain("intent.requiredHistory.get(key) === generationKey");
    expect(workspace).toContain("await loadSessions(true, '', false, true);");
    expect(history).toContain('const visibleSessionMessages = useCallback((sessionKey: string) => historyCache.current.restore(sessionKey) ?? [], [])');
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).toContain('visibleSessionMessages(key)');
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).not.toContain('Boolean(runRegistry.current.runFor(key)),\n            sessionMessages(key),');
  });

  it('recovers an archive request rejected across /new without stranding successor rows in the hidden tail', () => {
    const history = source('src/gateway/useGatewayHistory.ts');
    const latest = source('src/gateway/latestHistoryLoading.ts');
    const rejection = history.indexOf('archivedFamilyAuthorityInvalidated(error)');
    const request = history.indexOf('archiveRecovery.current.request(sessionKey)', rejection);
    const reload = history.indexOf('void loadHistory(sessionKey)', request);
    const consume = latest.indexOf('archiveRecovery.current.consume(sessionKey)');
    const publish = latest.indexOf("windowMode.current = 'latest';", consume);

    expect(rejection).toBeGreaterThan(-1);
    expect(request).toBeGreaterThan(rejection);
    expect(reload).toBeGreaterThan(request);
    expect(consume).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(consume);
    expect(history).toContain('createLatestHistoryActions(historyActionsContext)');
    expect(latest).toContain('clearPersistedHistoryReview(sessionKey);');
  });
});
