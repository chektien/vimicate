import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PairingBar } from '../../src/gateway/PairingBar';
import { parseSetupCode, type GatewayProfile } from '../../src/gateway/setupCode';
import type { GatewayStatus } from '../../src/gateway/OpenClawClient';
import { WorkspaceHeader } from '../../src/ui/WorkspaceHeader';
import { WorkspacePaneControls } from '../../src/ui/WorkspacePaneControls';
import { colors, type } from '../../src/theme/tokens';
import type { WorkspaceProject } from '../../src/workspace/workspaceTypes';

export const CONNECTION_HEADER_PROBE_MODE = 'qa-connection-v1';
const initialProfile: GatewayProfile = { endpoint: 'ws://127.0.0.1:18789', credentialKind: 'none', credential: '', sessionKey: 'fixture:connection-header' };
const fixtureProject: WorkspaceProject = {
  id: 'fixture:connection-header', sessionKey: 'fixture:connection-header', name: 'Header review', projectName: 'vimicate', kind: 'thread',
  path: '~/repos/vimicate', branch: 'main', starred: true, threadCount: 1, state: 'idle', agentRuntime: 'codex', model: 'gpt-5.6-sol', thinkingLevel: 'high',
};

/** Local visual QA port: no Gateway client, persisted pairing, or network calls. */
export default function ConnectionHeaderProbe() {
  const [profile, setProfile] = useState<GatewayProfile | null>(initialProfile);
  const [status, setStatus] = useState<GatewayStatus>('connected');
  const [editing, setEditing] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [narrow, setNarrow] = useState(false); const phone = useWindowDimensions().width <= 520;
  const [projectsVisible, setProjectsVisible] = useState(true);
  const [filesVisible, setFilesVisible] = useState(true);
  const gateway = {
    profile, status,
    pair: async (raw: string) => { const parsed = parseSetupCode(raw); if (!parsed) throw new Error('Invalid fixture setup code'); setProfile(parsed); return parsed; },
    connect: async () => { setStatus('connected'); },
    forget: async () => { setProfile(null); setStatus('idle'); },
  };
  return <SafeAreaView style={styles.root}>
    <View style={phone && narrow ? { width: 320 } : undefined}>
      <View onLayout={({ nativeEvent }) => setHeaderHeight(nativeEvent.layout.height)}><PairingBar gateway={gateway} onEditingChange={setEditing} paneControls={<WorkspacePaneControls
        projectsVisible={projectsVisible} filesVisible={filesVisible} focusedPane="transcript"
        onToggleProjects={() => setProjectsVisible((value) => !value)} onToggleFiles={() => setFilesVisible((value) => !value)} onFocusConversation={() => undefined}
      />} /></View>
      <WorkspaceHeader project={fixtureProject} compact={phone} />
    </View>
    <View style={styles.content}>
      <Text style={styles.heading}>Connection header · isolated preview</Text>
      <Text style={styles.detail}>{editing ? 'Settings editing' : 'Workspace keyboard active'} · header {headerHeight}pt · no live connection</Text>
      {phone ? <Pressable accessibilityRole="button" accessibilityLabel="Toggle 320-point header" onPress={() => setNarrow((value) => !value)} style={styles.button}><Text style={styles.label}>{narrow ? 'Full window width' : '320-point header'}</Text></Pressable> : null}
      <View style={styles.actions}>
        {(['connected', 'connecting', 'disconnected', 'error', 'idle'] as const).map((next) => <Pressable key={next} accessibilityRole="button" accessibilityLabel={`Fixture status ${next}`} onPress={() => setStatus(next)} style={styles.button}><Text style={styles.label}>{next}</Text></Pressable>)}
      </View>
      <Text style={styles.detail}>Open the connection control beside the wordmark. Settings stay in the same-height header and scroll horizontally at narrow widths. These fixture actions only change local presentation.</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas }, content: { padding: 20, gap: 14 },
  heading: { color: colors.inkBright, fontFamily: type.mono, fontSize: 17 }, detail: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 5 }, label: { color: colors.ink, fontFamily: type.mono, fontSize: 12 },
});
