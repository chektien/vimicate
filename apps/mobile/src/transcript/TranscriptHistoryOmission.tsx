import { Pressable } from 'react-native';
import { TranscriptDateDivider } from './TranscriptDateDivider';

/** Accessible action anchored to the real retained tail, not a fake row. */
export function TranscriptHistoryOmission({ fontScale, onLoadOlder }: { fontScale: number; onLoadOlder: () => unknown }) {
  return <Pressable accessibilityRole="button"
    accessibilityLabel="Earlier content in this turn is not loaded. Load older history to continue. Keyboard, k at the top."
    onPress={onLoadOlder}>
    <TranscriptDateDivider label="Earlier content omitted · load older to continue" fontScale={fontScale} />
  </Pressable>;
}
