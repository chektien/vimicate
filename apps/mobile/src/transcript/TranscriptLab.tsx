import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme/tokens';
import { Action, Field, Metric, Panel, SectionTitle } from '../ui/Primitives';
import { findTranscriptMatches, generateTranscript, type TranscriptItem } from './transcriptData';
import { TranscriptRow } from './TranscriptRow';

export function TranscriptLab({ record }: { record: (message: string) => void }) {
  const [seed, setSeed] = useState(1);
  const [items, setItems] = useState(() => generateTranscript(5000));
  const [streaming, setStreaming] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState('—');
  const [query, setQuery] = useState('viewport');
  const [matchCursor, setMatchCursor] = useState(-1);
  const [loadMs, setLoadMs] = useState(0);
  const [anomalies, setAnomalies] = useState(0);
  const listRef = useRef<FlashListRef<TranscriptItem>>(null);
  const matches = useMemo(() => findTranscriptMatches(items, query), [items, query]);

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      setItems((current) => {
        const last = current.at(-1); if (!last) return current;
        const next = current.slice(); next[next.length - 1] = { ...last, body: `${last.body}${last.body.length % 90 === 0 ? '\n' : ' '}▸` };
        return next;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [streaming]);

  const jumpMatch = () => {
    if (!matches.length) return;
    const next = (matchCursor + 1) % matches.length; setMatchCursor(next);
    const index = matches[next] ?? 0; listRef.current?.scrollToIndex({ index, viewPosition: 0.35, animated: true });
    record(`search exact target index=${index}`);
  };
  const switchDataset = () => {
    const nextSeed = seed + 1; setSeed(nextSeed); setItems(generateTranscript(5000, nextSeed)); setMatchCursor(-1); setAtBottom(true);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false })); record(`transcript switched dataset seed=${nextSeed}`);
  };
  const prepend = () => {
    const firstOrdinal = items[0]?.ordinal ?? 0; setItems((current) => [...generateTranscript(500, seed, firstOrdinal - 500), ...current]); record('transcript prepended 500 rows');
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setAtBottom(contentSize.height - (contentOffset.y + layoutMeasurement.height) < 64);
  };
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const indices = viewableItems.flatMap((token) => typeof token.index === 'number' ? [token.index] : []);
    if (indices.length) setVisible(`${Math.min(...indices)}–${Math.max(...indices)}`);
    else { setAnomalies((value) => value + 1); setVisible('blank?'); }
  }, []);

  return (
    <View style={styles.root}>
      <SectionTitle index="02" title="TRANSCRIPT / VIEWPORT" detail="5,000 heterogeneous rows, cumulative stream, exact targets, prepend and dataset rekey." />
      <View style={styles.metrics}><Metric label="rows" value={items.length.toLocaleString()} /><Metric label="visible" value={visible} /><Metric label="tail" value={atBottom ? 'following' : 'review'} tone={atBottom ? 'good' : 'warn'} /><Metric label="load" value={`${loadMs} ms`} /><Metric label="blank cb" value={anomalies} tone={anomalies ? 'bad' : 'good'} /></View>
      <View style={styles.actions}>
        <Action label={streaming ? 'STOP STREAM' : 'START STREAM'} active={streaming} onPress={() => { setStreaming((value) => !value); record(`stream ${streaming ? 'stopped' : 'started'}`); }} />
        <Action label="PREPEND 500" onPress={prepend} />
        <Action label="SWITCH 5K SET" onPress={switchDataset} />
        <Action label="G / TAIL" onPress={() => listRef.current?.scrollToEnd({ animated: false })} />
        <Field accessibilityLabel="Transcript search" onChangeText={setQuery} onSubmitEditing={jumpMatch} placeholder="/ search" style={styles.search} value={query} />
        <Action label={`n  ${matches.length}`} onPress={jumpMatch} disabled={!matches.length} />
      </View>
      <Panel style={styles.listPanel}>
        <FlashList
          ref={listRef}
          data={items}
          drawDistance={900}
          extraData={matchCursor >= 0 ? matches[matchCursor] : -1}
          getItemType={(item) => item.kind}
          initialScrollIndex={items.length - 1}
          keyExtractor={(item) => item.id}
          maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 64, animateAutoScrollToBottom: false, startRenderingFromBottom: true }}
          onLoad={({ elapsedTimeInMs }) => { setLoadMs(Math.round(elapsedTimeInMs)); record(`FlashList initial draw ${Math.round(elapsedTimeInMs)}ms`); }}
          onScroll={onScroll}
          onViewableItemsChanged={onViewableItemsChanged}
          renderItem={({ item, index }) => <TranscriptRow item={item} highlighted={index === matches[matchCursor]} />}
          scrollEventThrottle={80}
        />
      </Panel>
      <Text style={styles.note}>STRESS  //  type in another lab while streaming · hold j/k via search targets · review away from tail · prepend · switch · background · return.</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 }, metrics: { flexDirection: 'row', gap: space.sm, marginBottom: space.md }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  search: { width: 180, minHeight: 34, height: 34 }, listPanel: { flex: 1, padding: 0, overflow: 'hidden', minHeight: 390 },
  note: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 10, lineHeight: 16, marginTop: space.sm },
});
