import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import { promptHistoryWindow, type PromptHistoryBrowserState } from './promptHistoryBrowser';

export function PromptHistoryBrowserPanel({ state, height, compact, onCancel, onAccept }: { state: PromptHistoryBrowserState; height: number; compact: boolean; onCancel: () => void; onAccept: (index: number) => void }) {
  if (!state.open) return null;
  const maximumRows = height < 185 ? 2 : height < 245 ? 3 : 5;
  const rows = promptHistoryWindow(state, maximumRows);
  return <View accessibilityViewIsModal accessibilityLabel="Prompt history" style={[styles.panel, compact && styles.panelCompact, { maxHeight: Math.max(74, height - 48) }]}>
    <View style={styles.header}>
      <Text style={styles.title}>HISTORY</Text>
      <Text accessibilityLabel={`${state.selectedIndex + 1} of ${state.entries.length}`} style={styles.position}>{state.entries.length ? `${state.selectedIndex + 1}/${state.entries.length}` : 'empty'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close prompt history" hitSlop={6} onPress={onCancel} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
    </View>
    {rows.length ? rows.map((row) => <Pressable
      key={`${row.index}:${row.text}`}
      accessibilityRole="button"
      accessibilityLabel={`Use prompt ${row.index + 1} of ${state.entries.length}: ${row.text}`}
      accessibilityState={{ selected: row.selected }}
      onPress={() => onAccept(row.index)}
      style={[styles.row, row.selected && styles.rowSelected]}
    >
      <Text style={[styles.index, row.selected && styles.indexSelected]}>{row.index + 1}</Text>
      <Text numberOfLines={2} style={[styles.rowText, row.selected && styles.rowTextSelected]}>{row.text}</Text>
    </Pressable>) : <Text style={styles.empty}>No sent prompts in this thread.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', zIndex: 12, top: 42, left: 10, right: 10, padding: 5, gap: 3, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 6, backgroundColor: colors.inset, shadowColor: '#000', shadowOpacity: 0.36, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  panelCompact: { top: 40, left: 6, right: 6 },
  header: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 3 },
  title: { paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden', borderWidth: 1, borderColor: colors.orange, borderRadius: 3, color: colors.orange, fontFamily: type.mono, fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  position: { flex: 1, color: colors.faint, fontFamily: type.mono, fontSize: 9 },
  closeButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  closeText: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 17, lineHeight: 19 },
  row: { minHeight: 34, flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 7, paddingVertical: 5, borderLeftWidth: 2, borderLeftColor: 'transparent', backgroundColor: colors.surface },
  rowSelected: { borderLeftColor: colors.activeAccent, backgroundColor: colors.authoredPromptSurfaceActive },
  index: { width: 22, color: colors.faint, fontFamily: type.mono, fontSize: 9, textAlign: 'right' },
  indexSelected: { color: colors.activeAccent },
  rowText: { flex: 1, color: colors.inkMuted, fontFamily: type.mono, fontSize: 10, lineHeight: 14 },
  rowTextSelected: { color: colors.inkBright },
  empty: { paddingHorizontal: 8, paddingVertical: 12, color: colors.faint, fontFamily: type.mono, fontSize: 10 },
});
