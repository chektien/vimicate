import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

describe('project refresh update ownership', () => {
  it('checks and downloads eligible OTA updates through the existing project refresh action', () => {
    const shell = readFileSync(new URL('../app/AppShell.tsx', import.meta.url), 'utf8');
    const updates = readFileSync(new URL('../updates/useAppUpdateNotice.ts', import.meta.url), 'utf8');
    const rail = readFileSync(new URL('../workspace/ProjectRail.tsx', import.meta.url), 'utf8');

    expect(shell).toContain("setVimStatus('refreshing projects and checking updates…')");
    expect(shell).toContain('await gateway.refresh(); setVimStatus(`projects refreshed · ${await appUpdateNotice.check()}`);');
    expect(updates).not.toContain("return 'projects refreshed");
    expect(updates).toContain('await Updates.checkForUpdateAsync()');
    expect(updates).toContain('await Updates.fetchUpdateAsync()');
    expect(rail).toContain('Refresh projects and check for app updates');
  });

  it('propagates registry refresh failure instead of converting it into false success', () => {
    const workspace = readFileSync(new URL('../gateway/useGatewayWorkspace.ts', import.meta.url), 'utf8');
    const refresh = workspace.slice(workspace.indexOf('const refresh = useCallback'), workspace.indexOf('return { profile'));
    expect(refresh).toContain("Promise.all([loadSessions(true, '', true), providerUsage.refresh()])");
    expect(refresh).not.toContain('loadSessions(true, selectedRef.current, true)');
    expect(refresh).not.toContain('.catch(');
  });
});
