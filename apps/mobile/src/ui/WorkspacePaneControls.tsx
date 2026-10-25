import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/tokens';
import { headerGlyphStyles } from './headerGlyphStyles';

type Props = {
  projectsVisible: boolean;
  filesVisible: boolean;
  focusedPane: 'projects' | 'transcript' | 'prompt' | 'files';
  onToggleProjects: () => void;
  onFocusConversation: () => void;
  onToggleFiles: () => void;
};

/** Visibility is the filled switch; the small accent line marks keyboard focus. */
export function WorkspacePaneControls(props: Props) {
  const conversationFocused = props.focusedPane === 'transcript' || props.focusedPane === 'prompt';
  return <View accessibilityLabel="Workspace panes" style={styles.group}>
    <PaneSwitch label="Projects" position="left" visible={props.projectsVisible} focused={props.focusedPane === 'projects'} onPress={props.onToggleProjects} />
    <Pressable accessibilityRole="button" accessibilityLabel="Focus conversation" accessibilityHint="Return keyboard focus to the transcript or prompt" accessibilityState={{ selected: conversationFocused }} onPress={props.onFocusConversation} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <PaneGlyph position="center" enabled />
      {conversationFocused ? <View accessible={false} style={styles.focusMarker} /> : null}
    </Pressable>
    <PaneSwitch label="Files" position="right" visible={props.filesVisible} focused={props.focusedPane === 'files'} onPress={props.onToggleFiles} />
  </View>;
}

function PaneSwitch({ label, position, visible, focused, onPress }: { label: string; position: 'left' | 'right'; visible: boolean; focused: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={`${label} pane`} accessibilityState={{ checked: visible }} accessibilityHint={visible ? `Hide ${label.toLowerCase()} pane` : `Show ${label.toLowerCase()} pane`} onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
    <PaneGlyph position={position} enabled={visible} />
    {focused ? <View accessible={false} style={styles.focusMarker} /> : null}
  </Pressable>;
}

function PaneGlyph({ position, enabled }: { position: 'left' | 'center' | 'right'; enabled: boolean }) {
  return <View accessible={false} style={styles.glyph}>
    {(['left', 'center', 'right'] as const).map((column) => <View key={column} style={[styles.glyphColumn, column === 'center' && styles.glyphCenter, column === position && (enabled ? styles.glyphOn : styles.glyphOff)]} />)}
  </View>;
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  button: headerGlyphStyles.slot,
  pressed: { backgroundColor: colors.raised },
  focusMarker: { position: 'absolute', bottom: 1, width: 12, height: 2, borderRadius: 1, backgroundColor: colors.activeAccent },
  glyph: { ...headerGlyphStyles.frame, flexDirection: 'row', padding: 2, gap: 1 },
  glyphColumn: { width: 3, backgroundColor: colors.border }, glyphCenter: { flex: 1 }, glyphOn: { backgroundColor: colors.activeAccent }, glyphOff: { backgroundColor: colors.canvas },
});
