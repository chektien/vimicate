// Explicit QA-only mounted probe. Payloads allocate only when the QA branch renders.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, focusTranscriptMessage } from '../../src/transcript/transcriptVim';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';

const makeRows = (session: string): WorkspaceMessage[] => Array.from({ length: 200 }, (_, index) => ({
  id: `${session}-${index}`, role: 'assistant', state: 'complete',
  text: `Review ${session} item ${String(index).padStart(3, '0')}`,
}));
const noop = () => undefined;
const tailReveal = { consumeIfAdvanced: () => false };

function Probe() {
  const originals = useMemo(() => ({ A: makeRows('A'), B: makeRows('B') }), []);
  const older = useMemo<WorkspaceMessage[]>(() => Array.from({ length: 10 }, (_, index) => ({
    id: `older-${index}`, role: 'assistant', state: 'complete', text: `Older history item ${index}`,
  })), []);
  const [session, setSession] = useState<'A' | 'B'>('A');
  const [prepended, setPrepended] = useState(false);
  const [appended, setAppended] = useState(false);
  const leaveAfterRefresh = useRef(false);
  const messages = useMemo(() => session === 'B' ? originals.B : [
    ...(prepended ? older : []), ...originals.A,
    ...(appended ? [{ id: 'A-200', role: 'assistant' as const, state: 'complete' as const, text: 'Review A item 200' }] : []),
  ], [session, prepended, appended, originals, older]);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const owner = useSessionTranscriptNavigation({ sessionKey: session, buffer, navigationRef, setNavigation, viewportRef, tailReveal });
  useLayoutEffect(() => {
    if (!leaveAfterRefresh.current) return;
    leaveAfterRefresh.current = false;
    // Capture after the new topology commits, before deferred viewability can
    // publish its range. This is the refresh → immediate switch boundary.
    owner.captureCurrentSession(); setSession('B');
  }, [buffer, owner.captureCurrentSession]);
  const changeSession = (next: 'A' | 'B') => { owner.captureCurrentSession(); setSession(next); };
  const prepend = () => { setPrepended(true); };
  const tail = () => { setNavigation(createTranscriptVimState(buffer)); viewportRef.current?.reveal(buffer.lines.length - 1, true, 'tail'); };
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#202323' }}>
    <Text style={{ color: 'white' }}>Touch review native probe</Text>
    <Text style={{ color: 'white' }}>{`Probe session ${session} cursor ${navigation.cursor.row} rows ${buffer.lines.length}`}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {[['Session A', () => changeSession('A')], ['Session B', () => changeSession('B')], ['Prepend history', prepend], ['Latest row', tail],
        ['Refresh and leave', () => { leaveAfterRefresh.current = true; setAppended(true); }]].map(([label, action]) =>
        <Pressable key={label as string} accessibilityRole="button" accessibilityLabel={label as string} onPress={action as () => void} style={{ padding: 16 }}>
          <Text style={{ color: 'white' }}>{label as string}</Text>
        </Pressable>)}
    </View>
    <TranscriptPane ref={viewportRef} datasetKey={session} messages={messages} buffer={buffer} navigation={navigation}
      focused fontScale={1} onFocus={noop} onSelect={(messageIndex, line) => setNavigation(current => focusTranscriptMessage(buffer, current, messageIndex, line))}
      onNavigationProjection={(expected, projected) => setNavigation(current => current === expected ? projected : current)}
      onViewportReview={owner.onViewportReview} onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop}
      canLoadOlder={false} loadingOlder={false} onLoadOlder={prepend} onRetryHistory={noop} />
  </SafeAreaView>;
}
export default function TranscriptSessionReviewProbe() { return <SafeAreaProvider><Probe /></SafeAreaProvider>; }

export function isSimulatorReviewFixtureMode(mode: string | undefined) { return mode === 'qa-review-v1'; }
