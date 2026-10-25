import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme/tokens';
import type { TranscriptItem } from './transcriptData';

const tone = { user: colors.blue, assistant: colors.aqua, tool: colors.orange, code: colors.purple, media: colors.yellow } as const;
export const TranscriptRow = memo(function TranscriptRow({ item, highlighted }: { item: TranscriptItem; highlighted: boolean }) {
  const codeLike = item.kind === 'code' || item.kind === 'tool';
  return (
    <View style={[styles.row, highlighted && styles.highlight]}>
      <View style={[styles.rail, { backgroundColor: tone[item.kind] }]} />
      <View style={styles.content}>
        <View style={styles.header}><Text style={[styles.title, { color: tone[item.kind] }]}>{item.title}</Text><Text style={styles.meta}>{item.meta}</Text></View>
        <Text style={[styles.body, codeLike && styles.code]}>{item.body}</Text>
      </View>
    </View>
  );
});
const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, highlight: { backgroundColor: '#3c3836' }, rail: { width: 3 },
  content: { flex: 1, paddingHorizontal: space.md, paddingVertical: 10 }, header: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, marginBottom: 6 },
  title: { fontFamily: type.mono, fontSize: 11, fontWeight: '700' }, meta: { color: colors.faint, fontFamily: type.mono, fontSize: 9 },
  body: { color: colors.ink, fontFamily: type.mono, fontSize: 12, lineHeight: 18 }, code: { backgroundColor: colors.inset, color: colors.inkBright, padding: space.sm },
});
