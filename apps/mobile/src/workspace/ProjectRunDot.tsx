import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import { projectRunGlyph } from './runProjectPresentation';
import type { WorkspaceProject } from './workspaceTypes';

export function ProjectRunDot({ project, opacity }: {
  project: WorkspaceProject; opacity: Animated.Value;
}) {
  const glyph = projectRunGlyph(project.runPhase);
  // Draw circular states geometrically so their centres do not depend on a
  // font's baseline. The slot stays transparent on every card background.
  if (glyph) return <View style={styles.slot}>
    {glyph.tone === 'running' || glyph.tone === 'failed'
      ? <Animated.View accessibilityLabel={glyph.label} style={[styles.dot, { backgroundColor: glyph.tone === 'running' ? colors.orange : colors.red, opacity: glyph.tone === 'running' ? opacity : 1 }]} />
      : <Text accessibilityLabel={glyph.label} style={[styles.glyph, styles[glyph.tone]]}>{glyph.symbol}</Text>}
  </View>;
  if (project.unread) return <View style={styles.slot}><View accessibilityLabel="Unread output" style={[styles.dot, styles.unread]} /></View>;
  return <View style={styles.slot} />;
}

const styles = StyleSheet.create({
  slot: { width: 12, height: 12, marginLeft: 4, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontFamily: type.mono, fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' },
  needsUser: { color: colors.purple }, uncertain: { color: colors.faint },
  dot: { width: 7, height: 7, borderRadius: 4 }, unread: { backgroundColor: colors.blue },
});
