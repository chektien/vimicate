// Isolated native diagnostic. Never imported by the production entry point.
import React, { useEffect, useMemo, useRef } from 'react';
import { AppState, Button, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
const noop = () => undefined;

function ForegroundReview() {
  const pane = useRef<TranscriptPaneHandle>(null);
  const messages = useMemo(() => Array.from({ length: 200 }, (_, index) => ({
    id: `row-${index}`, role: 'assistant' as const,
    text: `${index === 199 ? 'FINAL ROW' : 'Answer'} ${index} — Synthetic foreground transcript measurement.`,
  })), []);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const navigation = useMemo(() => createTranscriptVimState(buffer), [buffer]);
  useEffect(() => {
    let frame: number | null = null;
    const cancel = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; };
    const listener = AppState.addEventListener('change', state => {
      cancel();
      recordGatewayDiagnostic(`foreground.scene state=${state} time=${Date.now()}`);
      if (state !== 'active') return;
      let count = 0;
      const sample = () => {
        frame = null;
        recordGatewayDiagnostic(`foreground.frame ${JSON.stringify({ n: count++, time: Date.now(), anchor: pane.current?.captureReviewPosition() })}`);
        if (count < 12) frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    });
    return () => { listener.remove(); cancel(); };
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#222', paddingTop: 60 }}>
    <Text style={{ color: 'white' }}>FOREGROUND PROBE unchanged synthetic transcript</Text>
    <Button title="Latest" onPress={() => pane.current?.reveal(199, true, 'tail')} />
    <Button title="Review row 100" onPress={() => pane.current?.reveal(100, true, 'review', 99)} />
    <View style={{ height: 700 }}><TranscriptPane ref={pane} datasetKey="foreground-probe"
      messages={messages} buffer={buffer} navigation={navigation} focused={false} fontScale={1}
      onFocus={noop} onSelect={noop} onNavigationProjection={noop} onViewportReview={noop}
      onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop} canLoadOlder={false}
      loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop} /></View>
  </View>;
}
registerRootComponent(ForegroundReview);
