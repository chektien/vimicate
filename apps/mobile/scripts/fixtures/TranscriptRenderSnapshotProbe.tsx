// Simulator-only reproduction. Never imported by the production entry point.
import React, { Suspense, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
const pending = new Promise<never>(() => {});
const noop = () => undefined;
function Suspender({ blocked }: { blocked: boolean }) { if (blocked) throw pending; return null; }
const initial: WorkspaceMessage[] = Array.from({length: 442}, (_, index) => ({ id: `old-${index}`, role: 'assistant', text: `Committed answer ${index}` }));
const replacement: WorkspaceMessage[] = initial.map((message, index) => ({ ...message, id: `new-${index}`, text: `UNCOMMITTED replacement ${index}` }));
export default function SnapshotProbe() {
  const [blocked, setBlocked] = useState(false);
  const pane = useRef<TranscriptPaneHandle>(null);
  const messages = blocked ? replacement : initial;
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  useEffect(() => {
    const timers = [setTimeout(() => {
      recordGatewayDiagnostic('snapshot-probe.transition');
      startTransition(() => setBlocked(true));
    }, 1500), ...[100, 300, 50, 400].map((row, index) => setTimeout(() => {
      recordGatewayDiagnostic(`snapshot-probe.reveal ${row}`);
      pane.current?.reveal(row, true, 'review');
    }, 3000 + index * 1000)), setTimeout(() => recordGatewayDiagnostic('snapshot-probe.complete'), 8500)];
    return () => timers.forEach(clearTimeout);
  }, []);
  return <View style={{flex: 1, justifyContent: 'center', backgroundColor: '#222'}}><Suspense fallback={null}>
    <View style={{height: 481, width: 1044}}><TranscriptPane ref={pane} datasetKey="snapshot-test" messages={messages}
      buffer={buffer} navigation={createTranscriptVimState(buffer)} focused fontScale={1}
      onFocus={noop} onSelect={noop} onNavigationProjection={noop} onViewportReview={noop}
      onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop} canLoadOlder={false}
      loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop} /></View>
    <Suspender blocked={blocked}/></Suspense></View>;
}

