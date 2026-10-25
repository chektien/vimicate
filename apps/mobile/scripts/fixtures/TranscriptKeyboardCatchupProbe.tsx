// Standalone native pane/key-policy control. No Gateway, pairing or product data.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { Text, View } from 'react-native';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, handleTranscriptKey } from '../../src/transcript/transcriptVim';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
const initial: WorkspaceMessage[] = Array.from({ length: 12 }, (_, i) => ({ id: `row-${i}`, role: 'assistant', text: `Reference ${i}. Reader-owned position.` }));
function Control({ caughtUp }: { caughtUp: boolean }) {
  const [messages, setMessages] = useState(initial);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation] = useState(() => ({ ...createTranscriptVimState(buffer), followTail: false, cursor: { row: 10, column: 0 } }));
  const [complete, setComplete] = useState(false);
  const pane = useRef<TranscriptPaneHandle>(null);
  const current = useRef({ buffer, navigation });
  React.useLayoutEffect(() => { current.current = { buffer, navigation }; });
  useEffect(() => {
    const tasks = [
      setTimeout(() => pane.current?.reveal(10, true, 'review'), 1000),
      setTimeout(() => setMessages([...initial, { id: 'new', role: 'narration', text: 'Latest response. Reached with j below.' }]), 2000),
      setTimeout(() => {
        let nav = current.current.navigation;
        for (let i = 0; i < (caughtUp ? 2 : 1); i++) {
          const next = handleTranscriptKey(current.current.buffer, nav, { key: 'j', shift: false, control: false, option: false, command: false }, pane.current?.navigationSourceRows()).state;
          pane.current?.reveal(next.cursor.row, false, 'review', nav.cursor.row);
          nav = next;
        }
        setNavigation(nav); setComplete(true);
      }, 3500),
    ];
    return () => tasks.forEach(clearTimeout);
  }, [caughtUp]);
  return <View style={{ flex: 1 }}>
    <Text style={{ color: '#fabd2f', padding: 8 }}>{caughtUp ? 'j reaches latest: no notice' : 'j stops short: notice remains'} {complete ? 'READY' : 'WAIT'} · follow={String(navigation.followTail)}</Text>
    <TranscriptPane ref={pane} datasetKey={caughtUp ? 'caught-up' : 'review'} messages={messages} responseMessages={messages} buffer={buffer}
      navigation={navigation} focused fontScale={1} onFocus={() => {}} onSelect={() => {}} onNavigationProjection={(_expected, next) => setNavigation(next)}
      onViewportReview={() => {}} onJumpToLatest={() => {}} onApprovalDecision={() => {}} onRecoverMessage={() => {}} onOpenMedia={() => {}}
      canLoadOlder={false} loadingOlder={false} onLoadOlder={() => {}} onRetryHistory={() => {}} />
  </View>;
}
function Probe() { return <View style={{ flex: 1, paddingTop: 60, paddingBottom: 30, backgroundColor: '#1d2021' }}><Control caughtUp={false} /><Control caughtUp /></View>; }
registerRootComponent(Probe);
