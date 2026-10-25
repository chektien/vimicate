import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

describe('session transcript dataset ownership', () => {
  it('binds navigation and viewport resets to the session that owns the mounted messages', () => {
    const history = readFileSync(new URL('../gateway/useGatewayHistory.ts', import.meta.url), 'utf8');
    const workspace = readFileSync(new URL('../gateway/useGatewayWorkspace.ts', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../app/AppShell.tsx', import.meta.url), 'utf8');
    const pane = readFileSync(new URL('../transcript/TranscriptPane.tsx', import.meta.url), 'utf8');
    const navigation = readFileSync(new URL('../transcript/useSessionTranscriptNavigation.ts', import.meta.url), 'utf8');

    expect(history).toContain('const [messageSessionKey, setMessageSessionKey] = useState(initialSessionKey);');
    expect(history).toContain('setMessageSessionKey(nextSessionKey);');
    expect(history).toContain('return { messages, messageSessionKey,');
    expect(workspace).toContain('messages: questions.messages, messageSessionKey, commands');
    expect(shell).toContain('sessionKey: gateway.messageSessionKey');
    expect(shell).toContain('datasetKey={gateway.messageSessionKey}');
    expect(shell).not.toContain('datasetKey={gateway.selectedKey}');
    expect(shell).toContain('onViewportReview={sessionTranscriptNavigation.onViewportReview}');
    expect(pane).toContain('projectedNavigation.cursor.row, onViewportReview, viewportRowKeys, acknowledgeUserReachedEnd)');
    expect(pane).toContain('key={datasetKey}');
    expect(pane).toContain('new SessionTranscriptFoldCache()');
    expect(pane).toContain('expandedMessageCache.expanded(datasetKey)');
    expect(pane).not.toContain('useState<Set<string>>');
    expect(navigation).toContain('const frame = requestAnimationFrame(() => {');
    expect(navigation).toContain('if (viewportHandoffFrame.current !== frame) return;');
    expect(navigation).toContain('if (sameSessionFrame) return;');
    expect(navigation).toContain('previousSessionKey.current !== sessionKey || previousBuffer.current !== buffer');
    expect(navigation).toContain('scheduleOwnedViewportHandoff(');
    expect(navigation).toContain('const replacementTailPublished = Boolean(nextResetTail && nextResetTail !== previousResetTail);');
    expect(navigation).toContain('replacementTailPublished,');
  });

  it('funnels every deferred viewport handoff through one cancellable session-and-buffer owner', () => {
    const navigation = readFileSync(new URL('../transcript/useSessionTranscriptNavigation.ts', import.meta.url), 'utf8');
    expect(navigation).toContain('const viewportHandoffFrame = useRef<number | null>(null);');
    expect(navigation).toContain('const scheduleOwnedViewportHandoff = useCallback(');
    expect(navigation).toContain('previousSessionKey.current !== sessionKey || previousBuffer.current !== buffer');
    expect(navigation.match(/requestAnimationFrame\(/g)).toHaveLength(1);
    expect(navigation).not.toContain('requestAnimationFrame(() => options.viewportRef.current');
  });
});
