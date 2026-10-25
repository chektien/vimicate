// Isolated native measurement regression; never loaded by product entry points.
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import { TranscriptSourceRow } from '../../src/transcript/TranscriptSourceRow';
import { fixtureMessagesForMode } from '../../src/app/uiFixtureMessages';
import { buildVisibleTranscriptRenderRows } from '../../src/transcript/transcriptVisibleRows';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
const noop = () => {};
export default function TranscriptWrappedRowProbe() {
  const [tick, setTick] = useState(0);
  const messages = useMemo(() => fixtureMessagesForMode('physical-transcript-pressure', tick)!, [tick]);
  const rows = useMemo(() => buildVisibleTranscriptRenderRows(messages, new Set()), [messages]);
  const navigation = createTranscriptVimState(createTranscriptBuffer(messages));
  const latest = useRef(rows); latest.current = rows;
  const list = useRef<FlashListRef<(typeof rows)[number]> | null>(null);
  useEffect(() => { const timer = setInterval(() => setTick(t => Math.min(t + 1, 2400)), 16); return () => clearInterval(timer); }, []);
  const measurements = useRef(new Map<string, number>());
  useEffect(() => {
    const timer = setTimeout(() => {
      let overlap = 0;
      latest.current.forEach((row, index) => {
        const a = list.current?.getLayout(index); const b = list.current?.getLayout(index + 1);
        const measured = measurements.current.get(row.key) ?? -1;
        if (a && b) overlap = Math.max(overlap, a.y + measured - b.y);
        if(row.message.id.includes('skill')) recordGatewayDiagnostic(`wrapped-row.measure index=${index} y=${a?.y} height=${a?.height} measured=${measured} next=${b?.y}`);
      });
      recordGatewayDiagnostic(`wrapped-row.complete overlap=${overlap} pass=${overlap <= 1 ? 1 : 0}`);
    }, 3500);
    return () => clearTimeout(timer);
  }, []);
  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#222' }}><View style={{ height: 550, width: 982 }}>
    <FlashList ref={list} data={rows} drawDistance={1200} maintainVisibleContentPosition={{ disabled: false, startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }} keyExtractor={row => row.key} renderItem={({ item, index }) =>
      <View onLayout={e => measurements.current.set(item.key, e.nativeEvent.layout.height)}>
        <TranscriptSourceRow row={item} navigation={navigation} focused={false} fontScale={1} gutterWidth={42}
          sourceNavigationIndex={index} cursorNavigationIndex={0} onPress={noop} onToggleFold={noop}
          onApprovalDecision={noop} onOpenMedia={noop} onRecoverMessage={noop} />
      </View>} />
  </View></View>;
}
