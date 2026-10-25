// Separate Simulator fixture: real native drag/momentum callbacks, no Gateway.
import React, { useMemo, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { Pressable, Text, View } from 'react-native';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
const initial: WorkspaceMessage[] = Array.from({ length: 80 }, (_, i) => ({ id: `row-${i}`, role: 'assistant', text: `Reference ${i}. Manual review retains ownership.` }));
function Probe() {
  const [version, setVersion] = useState(0);
  const messages = useMemo(() => version ? [...initial, { id: 'latest', role: 'narration' as const, text: `Latest response version ${version}. End of transcript.` }] : initial, [version]);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation] = useState(() => createTranscriptVimState(buffer));
  const pane = useRef<TranscriptPaneHandle>(null);
  return <View style={{ flex: 1, paddingTop: 65, paddingBottom: 35, backgroundColor: '#1d2021' }}>
    <Text style={{ color: '#fabd2f', padding: 8 }}>Manual catch-up · follow={String(navigation.followTail)} · version={version}</Text>
    <View style={{ flexDirection: 'row', gap: 20, padding: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Prepare review" onPress={() => { setNavigation(current => ({ ...current, followTail: false, cursor: { row: 20, column: 0 } })); pane.current?.reveal(20, true, 'review'); }}><Text style={{ color: '#fabd2f' }}>Prepare review</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Publish response" onPress={() => setVersion(current => current + 1)}><Text style={{ color: '#fabd2f' }}>Publish response</Text></Pressable>
    </View>
    <TranscriptPane ref={pane} datasetKey="manual-catchup" messages={messages} responseMessages={messages} buffer={buffer}
      navigation={navigation} focused fontScale={1} onFocus={() => {}} onSelect={() => {}} onNavigationProjection={(_expected, next) => setNavigation(next)}
      onViewportReview={() => setNavigation(current => current.followTail ? { ...current, followTail: false } : current)}
      onJumpToLatest={() => { setNavigation(createTranscriptVimState(buffer)); pane.current?.reveal(Number.MAX_SAFE_INTEGER, true, 'tail'); }}
      onApprovalDecision={() => {}} onRecoverMessage={() => {}} onOpenMedia={() => {}} canLoadOlder={false} loadingOlder={false} onLoadOlder={() => {}} onRetryHistory={() => {}} />
  </View>;
}
registerRootComponent(Probe);
