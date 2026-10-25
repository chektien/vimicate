// Isolated Simulator frame audit. Never imported by a production entry point.
import { newerHistoryWindow } from '../../src/gateway/newerHistoryWindow';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
const initial: WorkspaceMessage[] = Array.from({ length: 300 }, (_, i) => ({ id: `row-${i}`, role: 'assistant', source: 'history', sessionKey: 'pagination', text: `Review item ${i}` }));
const noop = () => {};
const tailReveal = { consumeIfAdvanced: () => false };
export default function TranscriptForwardHistoryFrameProbe() {
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const boundaries = useRef<(string | undefined)[]>([]);
  const messages = useMemo(() => {
    let rows = initial;
    for (let n = 0; n < page; n++) rows = newerHistoryWindow(rows, Array.from({ length: 60 }, (_, i) => ({ id: `newer-${n * 60 + i}`, role: 'assistant' as const, source: 'history' as const, sessionKey: 'pagination', text: `Newer history ${n * 60 + i}` })), 'pagination', boundaries.current[n]);
    return rows;
  }, [page]);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const owner = useSessionTranscriptNavigation({ sessionKey: 'pagination', buffer, navigationRef, setNavigation, viewportRef, tailReveal });
  const sourceRow = buffer.firstRowByMessage[messages.findIndex(message => message.id === 'row-299')]!;
  const latest = useRef({ page, sourceRow }); useLayoutEffect(() => { latest.current = { page, sourceRow }; }, [page, sourceRow]);
  useEffect(() => {
    let frame = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (delay: number, fn: () => void) => timers.push(setTimeout(fn, delay));
    later(1500, () => viewportRef.current?.reveal(299, true, 'review'));
    later(2500, () => {
      const baseline = viewportRef.current?.viewPositionForSourceRow(299) ?? -1;
      let samples = 0; let maxDrift = 0;
      const sample = () => {
        const value = viewportRef.current?.viewPositionForSourceRow(latest.current.sourceRow) ?? -1;
        maxDrift = Math.max(maxDrift, Math.abs(value - baseline)); samples++;
        if (Math.abs(value - baseline) > 0.004 && samples <= 270) recordGatewayDiagnostic(`forward-frame.drift sample=${samples} page=${latest.current.page} baseline=${baseline} actual=${value}`);
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      viewportRef.current?.requestNewerHistory();
      later(4500, () => { cancelAnimationFrame(frame); recordGatewayDiagnostic(`forward-frame.complete samples=${samples} maxDrift=${maxDrift} page=${latest.current.page} baseline=${baseline} pass=${latest.current.page === 1 && baseline > 0 && samples > 200 && maxDrift <= 0.004 ? 1 : 0}`); });
    });
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(frame); };
  }, []);
  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#222' }}><View style={{ height: 477 }}>
    <TranscriptPane ref={viewportRef} datasetKey="pagination" messages={messages} buffer={buffer} navigation={navigation}
      focused fontScale={1} onFocus={noop} onSelect={noop} onNavigationProjection={(expected, projected) => setNavigation(current => current === expected ? projected : current)}
      onViewportReview={owner.onViewportReview} onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop}
      hasNewerHistory onJumpToLatest={noop} onLoadNewer={(_, boundary) => new Promise(resolve => { boundaries.current[page] = boundary; setLoading(true); setTimeout(() => { setPage(value => value + 1); setLoading(false); requestAnimationFrame(() => resolve({ publication: Promise.resolve({ published: true, addedMessageCount: 60 }) })); }, 50); })}
      canLoadOlder={false} loadingOlder={loading} onLoadOlder={noop} onRetryHistory={noop} />
  </View></View>;
}
