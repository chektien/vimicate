// Offline Release QA entry. Never imported by the production app.
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { FlashList } from '@shopify/flash-list';
import { useTranscriptViewport } from '../../src/transcript/useTranscriptViewport';
import { loadVisibleOlderHistoryBatch } from '../../src/gateway/loadVisibleOlderHistoryBatch';
import { recordHistoryTransport } from '../../src/gateway/historyTransport';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
import type { OpenClawClient } from '../../src/gateway/OpenClawClient';

const original = Array.from({ length: 50 }, (_, index) => `row-${index}`);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const generation = '11111111-1111-4111-8111-111111111111';
async function traversal() {
  const visible: WorkspaceMessage[] = [{ id: 'edge', role: 'assistant', text: 'edge', sessionKey: 'qa', source: 'history', transcriptSessionId: generation }];
  const cursor = recordHistoryTransport({ sessionKey: 'qa', hasMore: true, nextOffset: 80, totalMessages: 100 }, 0, visible, { sessionKey: 'qa', sessionId: generation });
  const calls: number[] = [];
  const client = { decorateMessages: (rows: WorkspaceMessage[]) => rows,
    history: async (_key: string, _limit: number, offset: number) => {
      calls.push(offset);
      return { sessionKey: 'qa', sessionId: generation, offset, totalMessages: 105, hasMore: false, nextOffset: null,
        messages: offset ? [{ id: 'unwitnessed', role: 'assistant', content: 'never publish' }] : [
          { id: 'older', role: 'assistant', content: 'older' }, { id: 'edge', role: 'assistant', content: 'edge' },
          { id: 'newer', role: 'assistant', content: 'not older' }] };
    } } as unknown as OpenClawClient;
  const result = await loadVisibleOlderHistoryBatch({ client, sessionKey: 'qa', path: '', visible, cursor, archive: null, narration: [], context: {}, owns: () => true });
  if (result.problem || result.older.map(row => row.id).join() !== 'older' || calls.join() !== '80,0') throw new Error('traversal failed');
  return calls.join();
}
function Geometry({ nativeAnchor, done }: { nativeAnchor: boolean; done: (result: string) => void }) {
  const [keys, setKeys] = useState(original);
  const keysRef = useRef(keys); keysRef.current = keys;
  const viewport = useTranscriptViewport<string>('offline-history', keys, keys.length, 0, 0, undefined, keys);
  useEffect(() => {
    let alive = true;
    void (async () => {
      await pause(1000);
      const owner = viewport.list.current;
      if (!owner) throw new Error('no recycler');
      viewport.holdReviewAnchor('navigation');
      owner.scrollToOffset({ offset: 250 + owner.getFirstItemOffset(), animated: false, skipFirstItemOffset: true });
      await pause(400);
      const baseline = owner.getLayout(0)!.y + owner.getFirstItemOffset() - owner.getAbsoluteLastScrollOffset();
      viewport.captureOlderHistoryAnchor();
      setKeys(['older', ...original]);
      await pause(900);
      const target = keysRef.current.indexOf('row-0');
      const actual = owner.getLayout(target)!.y + owner.getFirstItemOffset() - owner.getAbsoluteLastScrollOffset();
      const drift = actual - baseline;
      const reads = await traversal();
      const result = `QA_HISTORY ${nativeAnchor ? 'native' : 'fallback'} drift=${drift.toFixed(2)} reads=${reads} ${Math.abs(drift) <= 2 ? 'PASS' : 'FAIL'}`;
      console.log(result);
      if (alive) done(result);
    })().catch(error => { console.log(`QA_HISTORY FAIL ${String(error)}`); if (alive) done(`FAIL ${String(error)}`); });
    return () => { alive = false; };
  }, []);
  return <View style={{ height: 477 }}><FlashList ref={viewport.list} data={keys} keyExtractor={key => key}
    maintainVisibleContentPosition={{ disabled: !nativeAnchor }} onCommitLayoutEffect={viewport.onOlderHistoryLayoutCommit}
    onLayout={viewport.onLayout} onContentSizeChange={viewport.onContentSizeChange} onScroll={viewport.onScroll}
    onViewableItemsChanged={viewport.onViewableItemsChanged} scrollEventThrottle={16}
    renderItem={({ item }) => <View style={{ height: item === 'row-0' ? 1200 : item === 'older' ? 320 : 80, backgroundColor: item === 'row-0' ? '#354335' : '#333', borderBottomWidth: 1 }}>
      <Text style={{ color: '#fff' }}>{item} source point</Text>{item === 'row-0' ? <Text style={{ marginTop: 250, color: '#ff0' }}>RETAINED SOURCE POINT</Text> : null}
    </View>} /></View>;
}
function App() {
  const [results, setResults] = useState<string[]>([]);
  const phase = results.length;
  return <View style={{ flex: 1, backgroundColor: '#222', justifyContent: 'center' }}>
    <Text style={{ color: '#fff' }}>History loading regression QA</Text>
    {results.map(result => <Text key={result} style={{ color: '#fff' }}>{result}</Text>)}
    {phase < 2 ? <Geometry key={phase} nativeAnchor={phase === 1} done={result => setResults(previous => [...previous, result])} /> : <Text style={{ color: '#fff' }}>QA_HISTORY_COMPLETE</Text>}
  </View>;
}
registerRootComponent(App);
