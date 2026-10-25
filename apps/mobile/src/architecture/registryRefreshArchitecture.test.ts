// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('deterministic project registry refresh architecture', () => {
  it('keeps census lifecycle authority separate from final-answer recovery records', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const refreshBlock = source('src/gateway/useGatewaySessionRefresh.ts');
    // A census proves which run is active, not that another run's final was
    // rendered. Only final/explicit run-terminal evidence may retire recovery.
    expect(refreshBlock).not.toMatch(/pendingFinalAnswers\.current\.(?:settle|restore|prune)/);
  });

  it('uses the typed Gateway registry read and contains no model/session fallback path', () => {
    const client = source('src/gateway/OpenClawClient.ts');
    const submission = source('src/gateway/useGatewaySubmission.ts');
    const reloadBranch = submission.slice(submission.indexOf("typedCommand === ':reload-projects'"), submission.indexOf("typedCommand === ':reconnect'"));
    expect(client).toContain("'vimicate.registry.read'");
    expect(reloadBranch).not.toMatch(/(?:client\.send|createSession|loadHistory|waitForRun)/);
    expect(reloadBranch).toContain("loadSessions(true, '', true)");
    expect(reloadBranch).not.toContain('loadSessions(true, sessionKey, true)');
  });

  it('preserves accepted registry authority when a later typed read fails', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const refreshBlock = source('src/gateway/useGatewaySessionRefresh.ts');
    expect(refreshBlock).toContain('project registry unchanged:');
    expect(refreshBlock).toContain('no model fallback used');
    expect(refreshBlock).not.toContain('registrySnapshot.current = null');
  });

  it('does not publish session-list guesses when the first registry read has no authority', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const refreshBlock = source('src/gateway/useGatewaySessionRefresh.ts');
    expect(refreshBlock).toContain('resolveProjectRegistryAuthority(');
    expect(refreshBlock).toContain("setDetail('project registry unavailable; refresh to retry')");
    expect(refreshBlock).toMatch(/if \(!registryAuthority\.ready\) \{[\s\S]*setProjectsReady\(false\);[\s\S]*return;[\s\S]*\}[\s\S]*const sessionProjection/);
  });

  it('retries a first-read failure through one foreground lifecycle owner', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const refreshBlock = source('src/gateway/useGatewaySessionRefresh.ts');
    expect(workspace).toContain('new ProjectRegistryRetryOwner()');
    expect(refreshBlock).toContain('registryRetryOwner.current.schedule(');
    expect(refreshBlock).toContain("client.status !== 'connected'");
    expect(refreshBlock).toContain('!appActive.current || suspendedByBackground.current');
    expect(refreshBlock).toContain('registryRetryOwner.current.acceptAuthority()');
    expect(workspace.match(/registryRetryOwner\.current\.suspend\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('passes lifecycle refresh intent through to the authoritative registry reader', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const eventBranch = workspace.slice(workspace.indexOf('const intent = refreshIntentForGatewayEvent'), workspace.indexOf('void Promise.all'));
    expect(eventBranch).toContain('refreshBatch.current.schedule(intent, selectedRef.current, terminalLifecycle');
    expect(eventBranch).toContain("loadSessions(plan.refreshRegistry, '', false, plan.refreshHistory ? '' : plan.requiredHistorySessionKey)");
    expect(eventBranch).toContain("if (plan.refreshHistory) void loadHistory(key, 'preserve-review', plan.requiredHistorySessionKey === key)");
    expect(eventBranch).not.toContain('else if (plan.refreshHistory)');
    expect(eventBranch).not.toContain('if (intent.refreshSessions) void loadSessions();');
  });

  it('does not let ordinary refresh completion restore a selection that the user already left', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const submission = source('src/gateway/useGatewaySubmission.ts');
    const history = source('src/gateway/latestHistoryLoading.ts');
    const newBranch = submission.slice(submission.indexOf("typedCommand === ':new'"), submission.indexOf("typedCommand === ':status'"));
    const reloadBranch = submission.slice(submission.indexOf("typedCommand === ':reload-projects'"), submission.indexOf("typedCommand === ':reconnect'"));
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).toContain('sessionSelectionAfterRefresh(next, selectedRef.current, preferredKey, currentProjectID)');
    expect(workspace).toContain('useGatewaySessionRefresh({ client, scenePublicationAuthority');
    expect(workspace).toContain("loadSessions(true, '', true)");
    expect(newBranch).toContain('await awaitOwned(loadSessions(true));');
    expect(newBranch).not.toContain('loadSessions(true, sessionKey)');
    expect(reloadBranch).toContain("awaitOwned(loadSessions(true, '', true))");
    expect(reloadBranch).not.toContain('loadSessions(true, sessionKey, true)');
    expect(submission).toContain('acceptThreadRegistryMutation(result.registryPayload, result.selectedKey)');
    expect(submission).toContain('loadSessions(false, result.selectedKey, false)');
    expect(submission).not.toContain('await awaitOwned(loadSessions(true, result.selectedKey, true))');
    const latestHistory = history.slice(history.indexOf('async function loadLatestHistory('), history.indexOf('async function restoreLatestHistory('));
    expect(latestHistory).toContain('selectedRef.current !== sessionKey');
    expect(latestHistory.indexOf('selectedRef.current !== sessionKey')).toBeLessThan(latestHistory.indexOf('latestRequestRevision.current'));
    // Concurrent owners join one request set; they may not each issue their own.
    const latestEntry = history.slice(history.indexOf('function loadHistory('), history.indexOf('async function loadLatestHistory('));
    expect(latestEntry).toContain('inFlightLatest.get(sessionKey)');
    expect(latestEntry.indexOf('inFlightLatest.get(sessionKey)')).toBeLessThan(latestEntry.indexOf('loadLatestHistory(sessionKey, presentation)'));
  });
});
