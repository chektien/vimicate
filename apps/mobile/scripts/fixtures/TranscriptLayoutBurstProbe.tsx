// Isolated Simulator QA calibration. Never import from the production entry.
// Deliberately generate twelve parent publications, then twelve cell-only
// relayouts. Neither calibration is a natural-crash reproduction.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FlashList, useLayoutState, type FlashListRef } from '@shopify/flash-list';
import { Text, View } from 'react-native';
import { useTranscriptLayoutDiagnostics } from '../../src/transcript/useTranscriptLayoutDiagnostics';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';

const data = Array.from({ length: 80 }, (_, index) => index);
function PulseRow({ item, pulse }: { item: number; pulse: RefObject<(() => void) | null> }) {
  const [size, setSize] = useLayoutState(0);
  useLayoutEffect(() => {
    if (item !== 0) return;
    const update = () => setSize((value) => value + 1);
    pulse.current = update;
    return () => { if (pulse.current === update) pulse.current = null; };
  }, [item, pulse, setSize]);
  return <Text style={{ height: 25 + size % 2, color: 'white' }}>{`Synthetic row ${item}`}</Text>;
}
const keyExtractor = (item: number) => String(item);
const anchor = { disabled: true };
export default function TranscriptLayoutBurstProbe() {
  const list = useRef<FlashListRef<number>>(null);
  const [armed, setArmed] = useState(false);
  const [revision, setRevision] = useState(0);
  const publications = useRef(0);
  const cellLayouts = useRef(0);
  const pulse = useRef<(() => void) | null>(null);
  const stage = useRef<'parent' | 'cell'>('parent');
  const renderItem = useCallback(({ item }: { item: number }) => <PulseRow item={item} pulse={pulse} />, []);
  const presentation = useMemo(() => ({ revision }), [revision]);
  const observe = useTranscriptLayoutDiagnostics('synthetic-layout-calibration', data, presentation, list);
  const onCommitLayoutEffect = useCallback(() => {
    observe();
    if (armed && stage.current === 'parent' && publications.current < 12) {
      publications.current++;
      setRevision((value) => value + 1);
    }
    if (stage.current === 'cell' && cellLayouts.current < 12) {
      cellLayouts.current++;
      pulse.current?.();
    }
  }, [armed, observe]);
  useEffect(() => {
    const start = setTimeout(() => { recordGatewayDiagnostic('layout-calibration.start'); setArmed(true); }, 1500);
    const cell = setTimeout(() => {
      recordGatewayDiagnostic('layout-calibration.cell-start'); stage.current = 'cell'; pulse.current?.();
    }, 3000);
    const done = setTimeout(() => recordGatewayDiagnostic(`layout-calibration.complete publications=${publications.current} cellLayouts=${cellLayouts.current}`), 5000);
    return () => { clearTimeout(start); clearTimeout(cell); clearTimeout(done); };
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#222', justifyContent: 'center' }}>
    <View style={{ height: 477 }}><FlashList ref={list} data={data} extraData={presentation}
      keyExtractor={keyExtractor} renderItem={renderItem} maintainVisibleContentPosition={anchor}
      onCommitLayoutEffect={onCommitLayoutEffect} /></View>
  </View>;
}
