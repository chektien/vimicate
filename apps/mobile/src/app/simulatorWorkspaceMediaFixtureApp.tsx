import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { saveDraft, setWorkspacePersistenceActive } from '../storage/workspaceStore';
import { AppShell } from './AppShell';
import {
  type SimulatorWorkspaceMediaPhase,
  SIMULATOR_WORKSPACE_MEDIA_ROOT,
  SIMULATOR_WORKSPACE_MEDIA_SESSION_A,
  SIMULATOR_WORKSPACE_MEDIA_SESSION_B,
  simulatorWorkspaceMediaPhaseTicks,
  simulatorWorkspaceMediaMessages,
  simulatorWorkspaceMediaProjectRail,
  simulatorWorkspaceMediaStartup,
} from './simulatorWorkspaceMediaFixtures';

const controls: Array<{ phase: Exclude<SimulatorWorkspaceMediaPhase, 'loading'>; label: string }> = [
  { phase: 'ready', label: 'QA phase ready' },
  { phase: 'decode', label: 'QA phase decode' },
  { phase: 'expiry', label: 'QA phase expiry' },
  { phase: 'beta', label: 'QA phase beta' },
  { phase: 'four-page', label: 'QA phase four page' },
  { phase: 'alpha-return', label: 'QA phase alpha return' },
];

/** QA-only deterministic payload driver; AppShell retains all product owners. */
export function SimulatorWorkspaceMediaFixtureApp() {
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [phase, setPhase] = useState<SimulatorWorkspaceMediaPhase>('loading');
  useEffect(() => {
    let mounted = true;
    let initializationStarted = false;
    const applyPersistenceActivity = (state: string) => {
      const active = state === 'active';
      setWorkspacePersistenceActive(active);
      if (!active || initializationStarted) return;
      initializationStarted = true;
      void Promise.all([
        saveDraft(SIMULATOR_WORKSPACE_MEDIA_SESSION_A, ''),
        saveDraft(SIMULATOR_WORKSPACE_MEDIA_SESSION_B, ''),
      ]).then(() => { if (mounted) setStorageReady(true); })
        .catch((error: unknown) => {
          if (mounted) setStorageError(error instanceof Error ? error.message : 'unknown local draft error');
        });
    };
    applyPersistenceActivity(AppState.currentState);
    const subscription = AppState.addEventListener('change', applyPersistenceActivity);
    return () => {
      mounted = false;
      subscription.remove();
      setWorkspacePersistenceActive(false);
    };
  }, []);
  const tick = simulatorWorkspaceMediaPhaseTicks[phase];
  const messages = useMemo(() => simulatorWorkspaceMediaMessages(tick), [tick]);
  const projectRail = useMemo(() => simulatorWorkspaceMediaProjectRail(tick), [tick]);
  const startup = useMemo(() => simulatorWorkspaceMediaStartup(tick), [tick]);
  if (storageError) return <SafeAreaView style={styles.root}>
    <Text accessibilityRole="alert" accessibilityLabel={`${SIMULATOR_WORKSPACE_MEDIA_ROOT} initialization failed: ${storageError}`} style={styles.error}>
      {SIMULATOR_WORKSPACE_MEDIA_ROOT} initialization failed
    </Text>
  </SafeAreaView>;
  if (!storageReady) return <SafeAreaView style={styles.root}>
    <Text accessibilityLabel={`${SIMULATOR_WORKSPACE_MEDIA_ROOT} preparing local drafts`} style={styles.error}>
      {SIMULATOR_WORKSPACE_MEDIA_ROOT}
    </Text>
  </SafeAreaView>;
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.controlSafeArea}>
        <View accessibilityLabel={`SIMWM QA controls, current phase ${phase}`} style={styles.controls}>
          {controls.map(control => <Pressable
            key={control.phase}
            accessibilityRole="button"
            accessibilityLabel={control.label}
            accessibilityState={{ selected: phase === control.phase }}
            onPress={() => setPhase(control.phase)}
            style={[styles.control, phase === control.phase && styles.selected]}
          ><Text style={styles.label}>{control.phase}</Text></Pressable>)}
        </View>
      </SafeAreaView>
      <AppShell fixtureMessages={messages} fixtureProjectRailStartup={startup} fixtureProjectRail={projectRail} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  controlSafeArea: { backgroundColor: '#111827' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, paddingHorizontal: 4, paddingVertical: 3, backgroundColor: '#111827' },
  control: { flexGrow: 1, minWidth: '30%', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 3, borderWidth: 1, borderColor: '#475569', borderRadius: 4, backgroundColor: '#1e293b' },
  selected: { borderColor: '#93c5fd', backgroundColor: '#1e3a5f' },
  label: { color: '#e2e8f0', fontSize: 9, fontWeight: '700' },
  error: { margin: 18, color: '#f1f5f9', fontSize: 14, fontWeight: '700' },
});
