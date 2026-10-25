// Isolated native regression. Never imported by the product entry point.
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
const original = Array.from({ length: 480 }, (_, index) => ({ key: `original-${index}` }));
const older = [...Array.from({ length: 120 }, (_, index) => ({ key: `older-${index}` })), ...original.slice(0, 360)];
export default function FlashListCappedPageProbe() {
  const [rows, setRows] = useState(original);
  const list = useRef<FlashListRef<{ key: string }> | null>(null);
  useEffect(() => {
    let baseline = 0;
    const first = setTimeout(() => { baseline = (list.current?.getLayout(0)?.y ?? 0) - (list.current?.getAbsoluteLastScrollOffset() ?? 0); setRows(older); }, 2000);
    const second = setTimeout(() => {
      const layout = list.current?.getLayout(120); const offset = list.current?.getAbsoluteLastScrollOffset() ?? 0;
      const delta = (layout?.y ?? -99999) - offset - baseline;
      recordGatewayDiagnostic(`capped-page.complete count=480 anchor=120 offset=${offset} delta=${delta} pass=${Math.abs(delta) <= 1 ? 1 : 0}`);
    }, 4500);
    return () => { clearTimeout(first); clearTimeout(second); };
  }, []);
  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#222' }}><View style={{ height: 477 }}>
    <FlashList ref={list} data={rows} keyExtractor={row => row.key} drawDistance={1200} maintainVisibleContentPosition={{ disabled: false }}
      renderItem={({ item }) => <View style={{ height: 32 }}><Text style={{ color: 'white' }}>{item.key}</Text></View>} />
  </View></View>;
}
