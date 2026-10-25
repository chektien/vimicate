import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

describe('explicit older-history input authority', () => {
  it('keeps pagination out of viewport geometry and admits only deliberate pull, tap, or fresh top-k input', () => {
    const source = readFileSync(new URL('../app/AppShell.tsx', import.meta.url), 'utf8');
    const pane = readFileSync(new URL('../transcript/TranscriptPane.tsx', import.meta.url), 'utf8');
    const viewport = readFileSync(new URL('../transcript/useTranscriptViewport.ts', import.meta.url), 'utf8');
    const request = readFileSync(new URL('../transcript/useOlderHistoryRequestPresentation.ts', import.meta.url), 'utf8');
    const handler = source.slice(source.indexOf('const onTranscriptKey'), source.indexOf('const handoffResponse'));

    expect(source).not.toContain('useOlderHistoryHardwareAuthority');
    expect(handler).toContain('requestsOlderTranscriptAtReviewTop(');
    expect(handler).toContain('transcriptNavigationRef.current.cursor.row');
    expect(handler).toContain('transcript.current?.navigationSourceRows() ?? []');
    expect(handler).not.toContain('transcript.current?.isAtOldestVisibleStop()');
    expect(handler).toContain('transcript.current?.requestOlderHistory()');
    expect(handler).not.toContain('gateway.loadOlderHistory');
    expect(pane).toContain('onRefresh={canLoadOlder || (loadingOlder && !loadingNewer) ? olderHistory.request : undefined}');
    expect(pane).toContain('refreshing={olderHistory.refreshing && !loadingNewer}');
    expect(pane).toContain('accessibilityLabel="Older history boundary"');
    expect(pane).toContain('Older history status: ${olderHistory.status}');
    expect(request).toContain('if (!options.canLoadOlder || options.loadingOlder || attempt.current) return false;');
    expect(viewport).not.toContain('onNearTop');
    expect(viewport).not.toContain('history-top');
    expect(viewport).not.toContain('triggerNearTop');
  });

  it('retains the existing exact review-anchor and recycler recovery owners', () => {
    const navigation = readFileSync(new URL('../transcript/useSessionTranscriptNavigation.ts', import.meta.url), 'utf8');
    const pane = readFileSync(new URL('../transcript/TranscriptPane.tsx', import.meta.url), 'utf8');
    const viewport = readFileSync(new URL('../transcript/useTranscriptViewport.ts', import.meta.url), 'utf8');
    const capture = readFileSync(new URL('../transcript/transcriptViewportPositionCapture.ts', import.meta.url), 'utf8');
    const verification = readFileSync(new URL('../transcript/transcriptReviewRestoreVerification.ts', import.meta.url), 'utf8');

    expect(navigation).toContain('const viewPositionCache = useRef(new BoundedSessionCache<SessionTranscriptViewportPosition>());');
    expect(navigation).toContain('resolveSessionTranscriptViewportPosition(buffer, viewportAnchor)');
    expect(pane).toContain('const anchor = viewport.captureReviewAnchor();');
    expect(pane).toContain('sourceRow: row.sourceRow, viewPosition: anchor.viewPosition');
    expect(viewport).toContain('pendingRevisionReveal.current = { datasetKey: datasetKeyRef.current, rowKey: committedRowKeys.current?.[target], target, viewPosition: boundedPosition };');
    expect(viewport).toContain('pendingReviewRestore.current = { datasetKey: datasetKeyRef.current, rowKey: committedRowKeys.current?.[target], target, viewPosition: boundedPosition, writes: 0, confirmations: 0, settleUntil: Number.POSITIVE_INFINITY, fallbackUsed: false };');
    expect(capture).toContain('authoritativeTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.offset, observedScroll)');
    expect(verification).toContain("context.record('release-review'");
  });
});
