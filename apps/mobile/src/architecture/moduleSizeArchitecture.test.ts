// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourceLines = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').split(/\r?\n/).length;

describe('composition-module size ceilings', () => {
  it.each([
    ['src/gateway/useGatewayWorkspace.ts', 500],
    ['src/prompt/vimPromptCore.ts', 520],
    ['src/transcript/transcriptVim.ts', 500],
    ['src/transcript/transcriptBuffer.ts', 260],
    ['src/app/AppShell.tsx', 450],
    ['src/workspace/workspaceTypes.ts', 200],
  ] as const)('%s stays below its explicit line ceiling', (path, ceiling) => {
    expect(sourceLines(path)).toBeLessThanOrEqual(ceiling);
  });

  // docs/decisions/latest-history-loading.md: keep the existing history
  // composition below the hard exception while extracting its next owner.
  it.each([
    ['src/gateway/useGatewayHistory.ts', 500],
    ['src/gateway/latestHistoryLoading.ts', 350],
    ['src/gateway/sessionMessagePublication.ts', 350],
    // docs/decisions/viewport-frame-lifetime.md
    ['src/transcript/useTranscriptViewport.ts', 490],
    ['src/transcript/viewportFrameScheduler.ts', 350],
    ['src/transcript/useViewportFrameScheduler.ts', 350],
    ['src/transcript/useTranscriptNativeCallbacks.ts', 200],
    ['src/transcript/sessionTranscriptViewportPosition.ts', 200],
    ['src/transcript/useGatewayImage.ts', 350],
    ['src/transcript/GatewayImage.tsx', 200],
    ['modules/vimicate-file-links/ios/VimicateFileLinksModule.swift', 350],
    ['modules/vimicate-file-links/ios/VimicateFileBookmarkStore.swift', 350],
    ['modules/vimicate-file-links/ios/VimicateFileLinkCoordinator.swift', 350],
    ['modules/vimicate-file-links/ios/VimicateFilePreviewController.swift', 350],
    ['modules/vimicate-file-links/ios/VimicateFilePreviewPreparation.swift', 350],
  ] as const)('%s stays within its nonblank/noncomment ceiling', (path, ceiling) => {
    const text = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    const lines = text.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/)
      .filter((line: string) => line.trim() && !line.trim().startsWith('//'));
    expect(lines.length).toBeLessThanOrEqual(ceiling);
  });

  it('composes latest-history actions without introducing another state or timer owner', () => {
    const hook = readFileSync(new URL('../../src/gateway/useGatewayHistory.ts', import.meta.url), 'utf8');
    const actions = readFileSync(new URL('../../src/gateway/latestHistoryLoading.ts', import.meta.url), 'utf8');
    expect(hook).toContain('useMemo(() => createLatestHistoryActions(historyActionsContext)');
    expect(hook).toContain('useMemo(() => createNewerHistoryAction({ ...historyActionsContext');
    expect(hook).not.toContain('completedLatestHistoryPage(');
    expect(actions).not.toMatch(/new (?:SessionHistoryCache|HistoryPublicationAuthority|OlderHistoryRequestAuthority)/);
    expect(actions).not.toMatch(/setInterval\(|setTimeout\(|from ['"]react['"]/);
  });

  it('keeps full-message recovery and approval decisions out of workspace composition', () => {
    const workspace = readFileSync(new URL('../../src/gateway/useGatewayWorkspace.ts', import.meta.url), 'utf8');
    expect(workspace).toContain("from './useGatewayMessageRecovery'");
    expect(workspace).toContain("from './useGatewayApprovalDecision'");
    expect(workspace).not.toContain('client.getMessage(');
    expect(workspace).not.toContain('client.resolveApproval(');
  });

  it('routes all viewport frame slots through one local scene-owned scheduler', () => {
    const viewport = readFileSync(new URL('../../src/transcript/useTranscriptViewport.ts', import.meta.url), 'utf8');
    const hook = readFileSync(new URL('../../src/transcript/useViewportFrameScheduler.ts', import.meta.url), 'utf8');
    expect(viewport).toContain('useViewportFrameScheduler(() => {');
    expect(viewport).not.toMatch(/requestAnimationFrame\(|cancelAnimationFrame\(/);
    expect(viewport).toContain('new TranscriptBlankRecoveryScheduler(frames.request, frames.cancel)');
    expect(readFileSync(new URL('../../src/transcript/transcriptBlankRecoveryScheduler.ts', import.meta.url), 'utf8'))
      .toContain('new TranscriptBlankViewportRecoveryOwner(requestFrame, cancelFrame)');
    expect(hook).toContain("AppState.addEventListener('change'");
    expect(hook).toContain('subscription.remove(); frames.dispose();');
  });

  it('keeps recovery publication on the existing history state and parked review owner', () => {
    const history = readFileSync(new URL('../../src/gateway/useGatewayHistory.ts', import.meta.url), 'utf8');
    const publisher = readFileSync(new URL('../../src/gateway/sessionMessagePublication.ts', import.meta.url), 'utf8');
    expect(history).toContain('useMemo(() => createSessionMessagePublisher({');
    expect(history).toContain('activeSessionKey.current === sessionKey ? historyViewSnapshot() : historyViewCache.current.restore(sessionKey)');
    expect(publisher).not.toMatch(/new (?:SessionHistoryCache|HistoryPublicationAuthority|SessionHistoryViewCache)|setTimeout\(|setInterval\(|useRef\(/);
  });
});
