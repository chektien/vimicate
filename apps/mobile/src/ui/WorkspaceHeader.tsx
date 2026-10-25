import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { WORKSPACE_HEADER_IDENTITY_COMPACT_FONT_SIZE, WORKSPACE_HEADER_IDENTITY_FONT_SIZE } from './workspaceHeaderTypography';
import { nativeBuildIdentity, runtimeUpdateIdentity } from '../updates/nativeBuildIdentity';

export function WorkspaceHeader({ project, compact = false }: { project: WorkspaceProject | undefined; compact?: boolean }) {
  const title = project?.kind === 'thread' && project.projectName ? `${project.projectName} › ${project.name}` : project?.name ?? 'workspace';
  const identity = [project?.agentRuntime, project?.model, project?.thinkingLevel, project?.fastMode ? 'fast' : null].filter(Boolean).join(' · ');
  const buildIdentity = nativeBuildIdentity(Application.nativeApplicationVersion, Application.nativeBuildVersion);
  const updateIdentity = runtimeUpdateIdentity(Updates.updateId, Updates.isEmbeddedLaunch);
  return (
    <View accessible={!compact} accessibilityLabel={`${title}, ${identity || 'OpenClaw session'}, ${buildIdentity}, ${updateIdentity}`} style={[styles.root, compact && styles.rootCompact]}>
      <Text style={styles.folder}>▰</Text>
      <Text numberOfLines={1} style={[styles.project, compact && styles.projectCompact]}>{title}</Text>
      {compact ? null : <Text style={styles.transport}>openclaw · direct</Text>}
      <View style={styles.spacer} />
      {identity ? <Text accessibilityLabel={`Model ${identity}`} ellipsizeMode="head" numberOfLines={1} style={[styles.context, compact && styles.contextCompact]}>{identity}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 8, backgroundColor: colors.canvas },
  rootCompact: { paddingHorizontal: 7, gap: 6 },
  folder: { color: colors.yellow, fontFamily: type.mono, fontSize: 11 },
  project: { minWidth: 90, flexShrink: 1, color: colors.ink, fontFamily: type.mono, fontSize: 14, fontWeight: '800' }, projectCompact: { minWidth: 80, fontSize: 13 }, transport: { color: colors.faint, fontFamily: type.mono, fontSize: 10 }, context: { minWidth: 120, flexShrink: 1, color: colors.inkMuted, fontFamily: type.mono, fontSize: WORKSPACE_HEADER_IDENTITY_FONT_SIZE }, contextCompact: { fontSize: WORKSPACE_HEADER_IDENTITY_COMPACT_FONT_SIZE },
  spacer: { flex: 1 },
});
