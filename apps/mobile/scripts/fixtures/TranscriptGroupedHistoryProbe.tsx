// Isolated Simulator prepend/scroll audit through the production display owner.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { Text, View } from 'react-native';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import { useTranscriptDisplayOptions } from '../../src/transcript/useTranscriptDisplayOptions';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, transcriptLineAt, focusTranscriptMessage } from '../../src/transcript/transcriptVim';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
const tool = (id: string): WorkspaceMessage => ({ id, role: 'tool', text: 'read\n' + 'hidden detail\n'.repeat(1400), tool: { name: 'read', summary: 'Reading history' } });
const initial: WorkspaceMessage[] = [tool('c'), tool('d'), ...Array.from({ length: 70 }, (_, i): WorkspaceMessage => ({ id: `after-${i}`, role: 'narration', text: `After calls ${i}. Retained reading position.` }))];
const noop = () => {};
const tailReveal = { consumeIfAdvanced: () => false };
function Probe() {
  const [page, setPage] = useState(0);
  const raw = useMemo(() => [...(page >= 3 ? [{ id: 'preamble', role: 'narration' as const, text: 'Earlier preamble. Tools below keep their identity.' }] : []), ...(page >= 2 ? [tool('a')] : []), ...(page >= 1 ? [tool('b')] : []), ...initial], [page]);
  const { messages } = useTranscriptDisplayOptions(raw, 'grouped-history-probe');
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => ({ ...createTranscriptVimState(buffer), cursor: { row: 0, column: 0 }, followTail: false }));
  const pane = useRef<TranscriptPaneHandle>(null);
  const owner = useSessionTranscriptNavigation({ sessionKey: 'grouped-history-probe', buffer, navigationRef, setNavigation, viewportRef: pane, tailReveal });
  const latest = useRef({ page, buffer, navigation });
  useEffect(() => { latest.current = { page, buffer, navigation }; }, [page, buffer, navigation]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (delay: number, fn: () => void) => timers.push(setTimeout(fn, delay));
    let frame = 0; let missing = 0; let changed = 0; let samples = 0; let drift = 0; let baseline = 0;
    const row = () => { const b = latest.current.buffer; const i = b.messages?.findIndex(m => m.id === 'tool-group:c') ?? -1; return b.firstRowByMessage[i]; };
    later(1200, () => { setNavigation(current => ({ ...current, cursor: { row: 0, column: 0 }, followTail: false })); pane.current?.reveal(0, true, 'review'); });
    later(2200, () => {
      baseline = pane.current?.viewPositionForSourceRow(0) ?? -1;
      const sample = () => {
        samples++;
        const source = row();
        if (source === undefined) missing++;
        else drift = Math.max(drift, Math.abs((pane.current?.viewPositionForSourceRow(source) ?? -1) - baseline));
        if (transcriptLineAt(latest.current.buffer, latest.current.navigation.cursor.row)?.messageId !== 'tool-group:c') changed++;
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    });
    later(3000, () => setPage(1));
    later(4200, () => setPage(2));
    later(5400, () => setPage(3));
    later(6800, () => {
      cancelAnimationFrame(frame);
      recordGatewayDiagnostic(`grouped-history.complete samples=${samples} missing=${missing} changed=${changed} drift=${drift} pass=${missing === 0 && changed === 0 && drift < 0.004}`);
    });
    // Subsequent explicit motion must remain usable after the page publications.
    later(7600, () => { const r = row(); if (r !== undefined) pane.current?.reveal(r + 5609, true, 'review'); });
    later(8700, () => { const r = row(); if (r !== undefined) pane.current?.reveal(r, true, 'review'); });
    later(9700, () => { const r = row(); recordGatewayDiagnostic(`grouped-history.return row=${r} position=${r === undefined ? 'missing' : pane.current?.viewPositionForSourceRow(r)}`); });
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(frame); };
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#1d2021', paddingTop: 65, paddingBottom: 40 }}>
    <Text style={{ color: '#fabd2f', padding: 10 }}>Grouped history · page {page} · selected {transcriptLineAt(buffer, navigation.cursor.row)?.messageId}</Text>
    <TranscriptPane ref={pane} datasetKey="grouped-history-probe" messages={messages} buffer={buffer} navigation={navigation} focused fontScale={1}
      onFocus={noop} onSelect={(index, line) => setNavigation(current => focusTranscriptMessage(buffer, current, index, line))}
      onNavigationProjection={(expected, projected) => setNavigation(current => current === expected ? projected : current)} onViewportReview={owner.onViewportReview}
      onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop} canLoadOlder loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop} />
  </View>;
}
registerRootComponent(Probe);
