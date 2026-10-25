// Isolated native reproduction of an empty viewability interval with visible cells.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTranscriptViewport } from '../../src/transcript/useTranscriptViewport';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
const data = Array.from({ length: 200 }, (_, i) => ({ key: `row-${i}`, index: i }));
const keys = data.map(row => row.key);
export default function BlankRecoveryAnchorProbe() {
  const [revision, setRevision] = useState({ invalidated: false });
  const viewport = useTranscriptViewport<typeof data[number]>('blank-anchor', revision, data.length, 80, 80, undefined, keys);
  const row = useRef<View | null>(null);
  useLayoutEffect(() => {
    if (revision.invalidated) viewport.onViewableItemsChanged({ viewableItems: [], changed: [] });
  }, [revision]);
  useEffect(() => {
    let baseline: number | null = null;
    const move = setTimeout(() => { viewport.holdReviewAnchor('navigation'); viewport.list.current?.scrollToOffset({ offset: 1572, animated: false }); }, 1500);
    const invalidate = setTimeout(() => { row.current?.measureInWindow((_x, y) => { baseline = y; setRevision({ invalidated: true }); }); }, 2500);
    const check = setTimeout(() => {
      row.current?.measureInWindow((_x, y) => recordGatewayDiagnostic(`blank-anchor.complete baseline=${baseline} actual=${y} offset=${viewport.list.current?.getAbsoluteLastScrollOffset()} pass=${baseline !== null && Math.abs(y - baseline) <= 1 ? 1 : 0}`));
    }, 4500);
    return () => { clearTimeout(move); clearTimeout(invalidate); clearTimeout(check); };
  }, []);
  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#222' }}><View style={{ height: 400 }}>
    <FlashList ref={viewport.list} data={data} keyExtractor={item => item.key} drawDistance={1200}
      onLayout={viewport.onLayout} onContentSizeChange={viewport.onContentSizeChange} onScroll={viewport.onScroll}
      onViewableItemsChanged={viewport.onViewableItemsChanged} maintainVisibleContentPosition={{ disabled: false }}
      renderItem={({ item }) => <View ref={item.index === 80 ? row : undefined} style={{ height: 20 }}><Text style={{ color: 'white' }}>{item.key}</Text></View>} />
  </View></View>;
}
