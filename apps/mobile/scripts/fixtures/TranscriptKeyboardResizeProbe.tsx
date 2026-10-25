// Standalone resize/typing control: real FlashList and viewport, no Gateway/data.
import React, { useEffect, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { LayoutAnimation, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { registerRootComponent } from 'expo';
import { useTranscriptViewport } from '../../src/transcript/useTranscriptViewport';
import { transcriptVisibleContentAnchor } from '../../src/transcript/transcriptViewportPolicy';
const rows = Array.from({ length: 100 }, (_, i) => `Row ${i}`);
function Probe() {
  const [height, setHeight] = useState(420);
  const [data, setData] = useState(rows);
  const [typed, setTyped] = useState(false);
  const viewport = useTranscriptViewport<string>('keyboard-resize', data, data.length, data.length - 1, data.length - 1);
  const owner = useRef(viewport); owner.current = viewport;
  const events = useRef<unknown[]>([]);
  const replayedOldWindow = useRef(false);
  useEffect(() => {
    const sample = (stage: string) => {
      const list = owner.current.list.current;
      const window = list?.getWindowSize(); const content = list?.getChildContainerDimensions();
      const offset = list?.getAbsoluteLastScrollOffset();
      events.current.push({ stage, window, content, offset, gap: content && window && offset !== undefined ? content.height - window.height - offset : null });
      new File(Paths.document, 'keyboard-resize-probe.json').write(JSON.stringify(events.current, null, 2));
    };
    const tasks = [
      setTimeout(() => sample('baseline'), 2500),
      setTimeout(() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setHeight(180); }, 3000),
      setTimeout(() => sample('shrunken'), 4500),
      setTimeout(() => setData([...rows, 'New live response']), 5000),
      setTimeout(() => sample('streamed'), 6500),
      setTimeout(() => setTyped(true), 7000),
      setTimeout(() => sample('typed-rerender'), 8000),
      setTimeout(() => { owner.current.holdReviewAnchor('navigation'); owner.current.reveal(45, true, 'review'); }, 9000),
      setTimeout(() => sample('review-before'), 10000),
      setTimeout(() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setHeight(320); }, 10500),
      setTimeout(() => sample('review-after'), 12000),
    ];
    return () => tasks.forEach(clearTimeout);
  }, []);
  return <View style={{ flex: 1, paddingTop: 65, backgroundColor: '#1d2021' }}>
    <Text style={{ color: 'white' }}>Keyboard resize control {height} {typed ? 'typed' : ''}</Text>
    <View style={{ height }}><FlashList ref={viewport.list} data={data} keyExtractor={x => x}
      maintainVisibleContentPosition={transcriptVisibleContentAnchor}
      onLayout={event => {
        viewport.onLayout(event);
        if (event.nativeEvent.layout.height === 180 && !replayedOldWindow.current) {
          replayedOldWindow.current = true;
          // Controlled replay of a delayed keyboard-hidden scroll publication.
          // The uninjected native control already passes ordinary resize.
          viewport.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 2580 }, contentSize: { width: 402, height: 3000 }, layoutMeasurement: { width: 402, height: 420 } } } as never);
        }
      }} onContentSizeChange={viewport.onContentSizeChange}
      onScroll={viewport.onScroll} onScrollBeginDrag={viewport.onScrollBeginDrag}
      onScrollEndDrag={viewport.onScrollEndDrag} onViewableItemsChanged={viewport.onViewableItemsChanged}
      renderItem={({ item }) => <View style={{ height: 30 }}><Text style={{ color: 'white' }}>{item}</Text></View>} />
    </View>
  </View>;
}
registerRootComponent(Probe);
