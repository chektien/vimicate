import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, space, type } from '../theme/tokens';

export function Label({ children, tone = 'muted' }: PropsWithChildren<{ tone?: 'muted' | 'accent' | 'danger' | 'good' }>) {
  const color = tone === 'accent' ? colors.yellow : tone === 'danger' ? colors.red : tone === 'good' ? colors.aqua : colors.inkMuted;
  return <Text style={[styles.label, { color }]}>{children}</Text>;
}
export function SectionTitle({ index, title, detail }: { index: string; title: string; detail: string }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionIndex}>{index}</Text><View style={styles.sectionCopy}><Text style={styles.heading}>{title}</Text><Text style={styles.detail}>{detail}</Text></View></View>;
}
export function Panel({ children, style }: PropsWithChildren<{ style?: ViewStyle | ViewStyle[] }>) {
  return <View style={[styles.panel, style]}>{children}</View>;
}
export function Action({ label, onPress, active = false, danger = false, disabled = false, accessibilityLabel }: { label: string; onPress: () => void; active?: boolean; danger?: boolean; disabled?: boolean; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, active && styles.actionActive, danger && styles.actionDanger, pressed && styles.actionPressed, disabled && styles.disabled]}><Text style={[styles.actionText, active && styles.actionTextActive]}>{label}</Text></Pressable>;
}
export function Field(props: TextInputProps) {
  return <TextInput {...props} placeholderTextColor={colors.faint} selectionColor={colors.yellow} style={[styles.field, props.multiline && styles.fieldMultiline, props.style]} />;
}
export function Metric({ label, value, tone = 'normal' }: { label: string; value: ReactNode; tone?: 'normal' | 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? colors.aqua : tone === 'warn' ? colors.yellow : tone === 'bad' ? colors.red : colors.inkBright;
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={[styles.metricValue, { color }]}>{value}</Text></View>;
}
const styles = StyleSheet.create({
  label: { fontFamily: type.mono, fontSize: type.sizeXs, letterSpacing: 1.2, textTransform: 'uppercase' },
  sectionTitle: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: space.md, marginBottom: space.md },
  sectionIndex: { color: colors.yellow, fontFamily: type.mono, fontSize: 36, lineHeight: 40, marginRight: space.md },
  sectionCopy: { flex: 1, justifyContent: 'center' }, heading: { color: colors.inkBright, fontFamily: type.mono, fontWeight: '700', fontSize: type.sizeLg, letterSpacing: 0.4 },
  detail: { color: colors.inkMuted, fontFamily: type.mono, fontSize: type.sizeSm, lineHeight: 17, marginTop: 2 },
  panel: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, padding: space.md },
  action: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.raised },
  actionActive: { borderColor: colors.yellow, backgroundColor: colors.yellow }, actionDanger: { borderColor: colors.red }, actionPressed: { opacity: 0.72 },
  actionText: { color: colors.ink, fontFamily: type.mono, fontSize: type.sizeSm, fontWeight: '600' }, actionTextActive: { color: colors.canvas }, disabled: { opacity: 0.38 },
  field: { minHeight: 38, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.inset, color: colors.inkBright, paddingHorizontal: 10, paddingVertical: 8, fontFamily: type.mono, fontSize: type.sizeSm },
  fieldMultiline: { textAlignVertical: 'top' }, metric: { flex: 1, minWidth: 86, borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: space.sm },
  metricLabel: { color: colors.faint, fontFamily: type.mono, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' },
  metricValue: { fontFamily: type.mono, fontSize: type.sizeSm, fontWeight: '700', marginTop: 3 },
});
