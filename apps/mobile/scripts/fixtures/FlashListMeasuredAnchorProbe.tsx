// Isolated native control for measurement refinement after a capped prepend.
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
type Row = { key: string };
const original = Array.from({ length: 480 }, (_, i) => ({ key: `original-${i}` }));
const older = [...Array.from({ length: 120 }, (_, i) => ({ key: `older-${i}` })), ...original.slice(0, 360)];
function Cell({ item, anchor }: { item: Row; anchor: React.RefObject<View | null> }) {
  const [height, setHeight] = useState(20);
  useEffect(() => {
    if (item.key !== 'older-119') { setHeight(20); return; }
    const timer = setTimeout(() => setHeight(192), 32);
    const second = setTimeout(() => setHeight(204), 64);
    return () => { clearTimeout(timer); clearTimeout(second); };
  }, [item.key]);
  return <View ref={item.key === 'original-0' ? anchor : undefined} style={{ height }}><Text style={{ color: 'white' }}>{item.key}</Text></View>;
}
export default function FlashListMeasuredAnchorProbe() {
  const [rows, setRows] = useState(original);
  const list = useRef<FlashListRef<Row> | null>(null); const anchor = useRef<View | null>(null);
  useEffect(() => {
    let baseline = 0; let maxDrift = 0; let finalDrift = 0; let samples = 0; let frame = 0;
    const first = setTimeout(() => {
      anchor.current?.measureInWindow((_x, y) => {
      baseline = y;
      setRows(older);
      const sample = () => {
        anchor.current?.measureInWindow((_x, y) => {
          samples++; const delta = y - baseline; finalDrift = delta; maxDrift = Math.max(maxDrift, Math.abs(delta));
          if (Math.abs(delta) > 1 && samples < 120) recordGatewayDiagnostic(`measured-anchor.drift sample=${samples} delta=${delta}`);
        });
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      });
    }, 2000);
    const second = setTimeout(() => {
      cancelAnimationFrame(frame);
      const layout = list.current?.getLayout(120); const offset = list.current?.getAbsoluteLastScrollOffset() ?? 0;
      recordGatewayDiagnostic(`measured-anchor.complete samples=${samples} height=${list.current?.getLayout(119)?.height} relative=${(layout?.y ?? -99999) - offset} maxDrift=${maxDrift} finalDrift=${finalDrift} pass=${maxDrift <= 1 ? 1 : 0}`);
    }, 5000);
    return () => { clearTimeout(first); clearTimeout(second); cancelAnimationFrame(frame); };
  }, []);
  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#222' }}><View style={{ height: 477 }}>
    <FlashList ref={list} data={rows} keyExtractor={row => row.key} drawDistance={1200} maintainVisibleContentPosition={{ disabled: false }}
      renderItem={({ item }) => <Cell item={item} anchor={anchor} />} />
  </View></View>;
}
