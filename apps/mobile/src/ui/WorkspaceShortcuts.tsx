import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { commandCatalog, type GatewayCommand } from '../gateway/gatewayCommands';
import { colors, space, type } from '../theme/tokens';
import { headerGlyphStyles } from './headerGlyphStyles';
import { workspaceShortcutReference } from './workspaceShortcutReference';

export function WorkspaceShortcutsButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Keyboard shortcuts" accessibilityHint="Open the Vim and keyboard shortcut reference" onPress={onPress} hitSlop={{ left: space.xs, top: space.sm, bottom: space.sm }} style={({ pressed }) => [headerGlyphStyles.slot, styles.helpControl, pressed && styles.pressed]}><Text style={styles.helpGlyph}>?</Text></Pressable>;
}

export function WorkspaceShortcuts({ commands, onClose }: { commands: GatewayCommand[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return <View accessibilityViewIsModal accessibilityLabel="Keyboard shortcut reference" style={styles.root}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss keyboard shortcuts" onPress={onClose} style={styles.backdrop} />
    <View style={[styles.panel, { marginTop: insets.top + 36, marginBottom: insets.bottom + space.md }]}>
      <View style={styles.heading}><View style={styles.titleGroup}><Text accessibilityRole="header" style={styles.title}>Keyboard shortcuts</Text><Text style={styles.hint}>Use the bindings for the focused pane. Esc or × closes.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close keyboard shortcuts" onPress={onClose} style={styles.close}><Text style={styles.title}>×</Text></Pressable></View>
      <ScrollView accessibilityLabel="All Vimicate keyboard bindings" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {workspaceShortcutReference.map(section => <View key={section.title} style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>{section.bindings.map(([keys, description]) => <Binding key={keys} keys={keys} description={description} />)}</View>)}
        <View style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>Colon commands</Text>{commandCatalog(commands).map(command => <Binding key={command.name} keys={`:${command.name}${command.acceptsArgs ? ' …' : ''}${command.aliases.length ? ` · ${command.aliases.map(alias => `:${alias}`).join(' · ')}` : ''}`} description={command.description} />)}</View>
      </ScrollView>
    </View>
  </View>;
}
function Binding({ keys, description }: { keys: string; description: string }) {
  return <View style={styles.binding}><Text selectable style={styles.keys}>{keys}</Text><Text style={styles.description}>{description}</Text></View>;
}
const styles = StyleSheet.create({
  root: { position: 'absolute', inset: 0, zIndex: 1_000, elevation: 1_000 },
  backdrop: { position: 'absolute', inset: 0, backgroundColor: colors.canvas, opacity: 0.65 },
  panel: { maxHeight: '85%', width: '94%', maxWidth: 680, marginLeft: space.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexShrink: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  titleGroup: { flex: 1, paddingVertical: space.sm }, title: { color: colors.ink, fontFamily: type.mono, fontSize: type.sizeLg }, hint: { color: colors.faint, fontFamily: type.mono, fontSize: type.sizeSm, marginTop: space.xs },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, content: { padding: space.md },
  section: { marginBottom: space.lg }, sectionTitle: { color: colors.yellow, fontFamily: type.mono, fontSize: type.sizeMd, marginBottom: space.sm, fontWeight: '700' },
  binding: { marginBottom: space.sm }, keys: { color: colors.ink, fontFamily: type.mono, fontSize: type.sizeSm }, description: { color: colors.inkMuted, fontFamily: type.mono, fontSize: type.sizeSm, marginTop: space.xs },
  helpControl: { width: space.sm * 2 },
  helpGlyph: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 15, lineHeight: 18 }, pressed: { backgroundColor: colors.raised },
});
