// Isolated Simulator regression for transition/urgent publication overlap.
// Production entry points must never import this fixture.
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { authorizedTranscriptProjection } from '../../src/transcript/transcriptProjectionAuthority';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';

const row = (id: string): WorkspaceMessage => ({ id, role: 'tool', text: 'summary\ndetail\nlast', tool: { name: 'read', summary: id } });
const initial = [row('first'), row('second')];
const noop = () => {};
const tailReveal = { consumeIfAdvanced: () => false };
function Probe() {
  const [messages, setMessages] = useState(initial);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const handoff = useSessionTranscriptNavigation({ sessionKey: 'lane-overlap', buffer, navigationRef,
    setNavigation, viewportRef, tailReveal });
  const project = useCallback((expected: typeof navigation, projected: typeof navigation) => {
    setNavigation(current => authorizedTranscriptProjection(current, expected, projected));
  }, [setNavigation]);
  const latest = useRef({ messages, navigation });
  const commits = useRef(0);
  useEffect(() => {
    latest.current = { messages, navigation }; commits.current++;
    if (commits.current <= 12) recordGatewayDiagnostic(`navigation-cycle.commit count=${commits.current} cursor=${navigation.cursor.row} messages=${messages.length}`);
  });
  useEffect(() => {
    const start = setTimeout(() => {
      recordGatewayDiagnostic('navigation-cycle.start');
      startTransition(() => setMessages(current => [...current, row('later')]));
      setMessages(current => current.map(message => ({ ...message, text: `${message.text}\nrevision` })));
    }, 1500);
    const done = setTimeout(() => {
      const final = latest.current;
      recordGatewayDiagnostic(`navigation-cycle.complete cursor=${final.navigation.cursor.row} messages=${final.messages.length} commits=${commits.current} pass=${final.navigation.cursor.row === 8 && final.messages.length === 3 ? 1 : 0}`);
    }, 3500);
    return () => { clearTimeout(start); clearTimeout(done); };
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#222', justifyContent: 'center' }}><View style={{ height: 477 }}>
    <TranscriptPane ref={viewportRef} datasetKey="lane-overlap" messages={messages} buffer={buffer} navigation={navigation}
      focused fontScale={1} onFocus={noop} onSelect={noop} onNavigationProjection={project} onViewportReview={handoff.onViewportReview}
      onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop} canLoadOlder={false} loadingOlder={false}
      onLoadOlder={noop} onRetryHistory={noop} />
  </View></View>;
}
export default function TranscriptNavigationCommitProbe() { return <SafeAreaProvider><Probe /></SafeAreaProvider>; }
