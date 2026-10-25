// Simulator-only reproduction. Never imported by the production entry point.
import React, { Suspense, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
const pending = new Promise<never>(() => {});
const noop = () => undefined;
function Suspender({ blocked }: { blocked: boolean }) { if (blocked) { recordGatewayDiagnostic('viewport-commit.suspended'); throw pending; } return null; }
const initial: WorkspaceMessage[] = Array.from({length: 100}, (_, index) => ({ id: `old-${index}`, role: 'assistant', text: `Committed answer ${index}` }));
const replacement: WorkspaceMessage[] = initial.slice(0, 2).map((message, index) => ({ ...message, id: `new-${index}`, text: `UNCOMMITTED replacement ${index}` }));
export default function ViewportCommitProbe({ sameDataset = false, acceptReplacement = false }: { sameDataset?: boolean; acceptReplacement?: boolean }) {
  const [blocked, setBlocked] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const pane = useRef<TranscriptPaneHandle>(null);
  const messages = blocked ? replacement : initial;
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  useEffect(() => {
    const timers = [setTimeout(() => {
      recordGatewayDiagnostic('viewport-commit.transition');
      startTransition(() => setBlocked(true));
    }, 1500), setTimeout(() => {
      recordGatewayDiagnostic('viewport-commit.reveal requested=70');
      pane.current?.reveal(70, true, 'review');
    }, 3000), setTimeout(() => {
      const count = pane.current?.navigationSourceRows().length;
      const anchor = pane.current?.captureReviewPosition();
      recordGatewayDiagnostic(`viewport-commit.complete count=${count} anchor=${anchor?.sourceRow} pass=${count === 100 && (anchor?.sourceRow ?? 0) > 40 ? 1 : 0}`);
    }, 5500), setTimeout(() => { if (acceptReplacement) setAccepted(true); }, 6200), setTimeout(() => {
      if (acceptReplacement) recordGatewayDiagnostic(`viewport-commit.accepted count=${pane.current?.navigationSourceRows().length} pass=${pane.current?.navigationSourceRows().length === 2 ? 1 : 0}`);
    }, 7500)];
    return () => timers.forEach(clearTimeout);
  }, []);
  return <View style={{flex: 1, justifyContent: 'center', backgroundColor: '#222'}}><Suspense fallback={null}>
    <View style={{height: 477}}><TranscriptPane ref={pane} datasetKey={blocked && !sameDataset ? "replacement-test" : "snapshot-test"} messages={messages}
      buffer={buffer} navigation={createTranscriptVimState(buffer)} focused fontScale={1}
      onFocus={noop} onSelect={noop} onNavigationProjection={noop} onViewportReview={noop}
      onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop} canLoadOlder={false}
      loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop} /></View>
    <Suspender blocked={blocked && !accepted}/></Suspense></View>;
}

