import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme/tokens';
import { workspaceFontMetrics } from '../ui/workspaceTypography';
import { FILE_SORT_CHOICES } from './projectFileSort';
import type { useProjectFileSort } from './useProjectFileSort';

export function ProjectFileSortMenu({ sorting, fontScale, onFocus }: {
  sorting: ReturnType<typeof useProjectFileSort>; fontScale: number; onFocus: () => void;
}) {
  return <View style={styles.container}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Sort files: ${sorting.label}`}
      accessibilityHint="Choose sorting, or press g then s in the file list" accessibilityState={{ expanded: sorting.visible }}
      onPress={() => { onFocus(); sorting.toggle(); }} style={styles.trigger}>
      <Text style={[styles.label, workspaceFontMetrics(type.sizeSm, fontScale)]}>{sorting.label}</Text>
      <Text style={[styles.hint, workspaceFontMetrics(type.sizeSm, fontScale)]}>{sorting.visible ? 'Esc close' : 'gs sort'}</Text>
    </Pressable>
    {sorting.visible ? <ScrollView accessibilityLabel="File sort options" style={styles.options}>
      {FILE_SORT_CHOICES.map(choice => <Pressable key={choice.key} accessibilityRole="button" accessibilityLabel={`Sort by ${choice.field}`}
        accessibilityState={{ selected: sorting.order.field === choice.field }}
        onPress={() => sorting.choose({ field: choice.field, direction: choice.direction })} style={styles.option}>
        <Text style={[styles.key, workspaceFontMetrics(type.sizeSm, fontScale)]}>{choice.key}</Text>
        <Text style={[styles.label, workspaceFontMetrics(type.sizeSm, fontScale)]}>{choice.label}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel="Reverse file sort order" onPress={sorting.reverse} style={styles.option}>
        <Text style={[styles.key, workspaceFontMetrics(type.sizeSm, fontScale)]}>r</Text>
        <Text style={[styles.label, workspaceFontMetrics(type.sizeSm, fontScale)]}>Reverse order</Text>
      </Pressable>
    </ScrollView> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  trigger: { minHeight: 44, paddingHorizontal: space.sm, paddingVertical: space.xs, gap: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  options: { maxHeight: 220, backgroundColor: colors.raised },
  option: { minHeight: 44, paddingHorizontal: space.sm, paddingVertical: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { color: colors.ink, fontFamily: type.mono, flexShrink: 1 },
  hint: { color: colors.inkMuted, fontFamily: type.mono }, key: { color: colors.yellow, fontFamily: type.mono, minWidth: space.lg },
});
