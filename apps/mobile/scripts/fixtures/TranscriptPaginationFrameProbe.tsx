// Isolated Simulator frame audit. Never imported by a production entry point.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
const initial: WorkspaceMessage[] = Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}`, role: 'assistant', text: `Review item ${i}` }));
const noop = () => {};
const tailReveal = { consumeIfAdvanced: () => false };
export default function TranscriptPaginationFrameProbe() {
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const messages = useMemo(() => [...Array.from({ length: page * 10 }, (_, i): WorkspaceMessage => i < 20
    ? { id: `older-${i}`, role: 'assistant', text: `Older history ${i}` }
    : i % 2 ? { id: `older-${i}`, role: 'tool', text: 'Tool summary\ndetail\nlast', tool: { name: 'read', summary: 'Folded history' } }
      : { id: `older-${i}`, role: 'assistant', text: `Variable-height history ${i} with enough prose to wrap on a narrow phone viewport and change measured row geometry.\nSecond line\nThird line` }), ...initial], [page]);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const owner = useSessionTranscriptNavigation({ sessionKey: 'pagination', buffer, navigationRef, setNavigation, viewportRef, tailReveal });
  const sourceRow = buffer.firstRowByMessage[messages.findIndex(message => message.id === 'row-80')]!;
  const latest = useRef({ page, sourceRow }); latest.current = { page, sourceRow };
  useEffect(() => {
    let frame = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (delay: number, fn: () => void) => timers.push(setTimeout(fn, delay));
    later(1500, () => viewportRef.current?.reveal(80, true, 'review'));
    later(2500, () => {
      const baseline = viewportRef.current?.viewPositionForSourceRow(80) ?? -1;
      let samples = 0; let maxDrift = 0;
      const sample = () => {
        const value = viewportRef.current?.viewPositionForSourceRow(latest.current.sourceRow) ?? -1;
        maxDrift = Math.max(maxDrift, Math.abs(value - baseline)); samples++;
        if (Math.abs(value - baseline) > 0.004 && samples <= 270) recordGatewayDiagnostic(`pagination-frame.drift sample=${samples} page=${latest.current.page} baseline=${baseline} actual=${value}`);
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      setLoading(true);
      later(500, () => { setPage(1); setLoading(false); });
      later(1500, () => { setLoading(true); });
      later(2000, () => { setPage(2); setLoading(false); });
      later(2500, () => setLoading(true));
      later(3000, () => { setPage(3); setLoading(false); });
      later(4500, () => { cancelAnimationFrame(frame); recordGatewayDiagnostic(`pagination-frame.complete samples=${samples} maxDrift=${maxDrift} pass=${maxDrift <= 0.004 ? 1 : 0}`); });
    });
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(frame); };
  }, []);
  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#222' }}><View style={{ height: 477 }}>
    <TranscriptPane ref={viewportRef} datasetKey="pagination" messages={messages} buffer={buffer} navigation={navigation}
      focused fontScale={1} onFocus={noop} onSelect={noop} onNavigationProjection={(expected, projected) => setNavigation(current => current === expected ? projected : current)}
      onViewportReview={owner.onViewportReview} onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop}
      canLoadOlder loadingOlder={loading} onLoadOlder={noop} onRetryHistory={noop} />
  </View></View>;
}
