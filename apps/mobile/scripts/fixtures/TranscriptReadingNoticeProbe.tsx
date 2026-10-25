// Standalone Simulator fixture; no Gateway connection, pairing or production data.
import React, { useEffect, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { View } from 'react-native';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, type TranscriptVimState } from '../../src/transcript/transcriptVim';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
const initial: WorkspaceMessage[] = Array.from({ length: 80 }, (_, i) => ({ id: `row-${i}`, role: 'assistant', text: `Reading reference ${i}. Keep this text steady.` }));
function Probe() {
  const [messages, setMessages] = useState(initial);
  const [navigation, setNavigation] = useState<TranscriptVimState>(() => createTranscriptVimState(createTranscriptBuffer(initial)));
  const pane = useRef<TranscriptPaneHandle>(null);
  const buffer = createTranscriptBuffer(messages);
  const latest = () => { setNavigation(createTranscriptVimState(buffer)); pane.current?.reveal(Number.MAX_SAFE_INTEGER, true, 'tail'); };
  useEffect(() => {
    let baseline: number | null = null;
    const tasks = [
      setTimeout(() => { setNavigation(current => ({ ...current, cursor: { row: 20, column: 0 }, followTail: false })); pane.current?.reveal(20, true, 'review'); }, 1500),
      setTimeout(() => { baseline = pane.current?.viewPositionForSourceRow(20) ?? null; setMessages([...initial, { id: 'preamble', role: 'narration', text: 'A new preamble has arrived while you read.' }]); }, 2500),
      setTimeout(() => setMessages([...initial, { id: 'preamble', role: 'narration', text: 'A new preamble has arrived while you read.' }, { id: 'final', role: 'assistant', text: 'A final response has arrived.' }]), 3500),
      setTimeout(() => { const position = pane.current?.viewPositionForSourceRow(20) ?? null; recordGatewayDiagnostic(`reading-notice.complete baseline=${baseline} position=${position} pass=${baseline !== null && position !== null && Math.abs(position - baseline) < 0.005 ? 1 : 0}`); }, 4500),
    ];
    return () => tasks.forEach(clearTimeout);
  }, []);
  return <View style={{ flex: 1, paddingTop: 60, paddingBottom: 40, backgroundColor: '#1d2021' }}>
    <TranscriptPane ref={pane} datasetKey="reading-notice" messages={messages} responseMessages={messages} buffer={buffer}
      navigation={navigation} focused fontScale={1} onFocus={() => {}} onSelect={() => {}} onNavigationProjection={(_expected, next) => setNavigation(next)}
      onViewportReview={() => setNavigation(current => current.followTail ? { ...current, followTail: false } : current)}
      onJumpToLatest={latest} onApprovalDecision={() => {}} onRecoverMessage={() => {}} onOpenMedia={() => {}}
      canLoadOlder={false} loadingOlder={false} onLoadOlder={() => {}} onRetryHistory={() => {}} />
  </View>;
}
registerRootComponent(Probe);
