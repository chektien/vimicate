import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AppShell } from './AppShell';
import { saveDraft, setWorkspacePersistenceActive } from '../storage/workspaceStore';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';

export const SIMULATOR_TOUCH_FIXTURE_MODE = 'qa-touch-v1';
export const SIMULATOR_TOUCH_FIXTURE_ROOT = 'SIMTOUCH-FIXTURE-ROOT';
export const SIMULATOR_TOUCH_SESSION_KEY = 'fixture:simulator:touch-v1';

const project: WorkspaceProject = {
  id: 'simulator-touch-v1',
  sessionKey: SIMULATOR_TOUCH_SESSION_KEY,
  name: 'simulator touch',
  path: '/fixture/simulator-touch',
  branch: 'qa',
  starred: true,
  threadCount: 1,
  state: 'idle',
  kind: 'project',
  rootSessionKey: SIMULATOR_TOUCH_SESSION_KEY,
};

const messages: WorkspaceMessage[] = [{
  id: 'simulator-touch-root',
  role: 'vimicate',
  text: `${SIMULATOR_TOUCH_FIXTURE_ROOT}: isolated native editor ready.`,
  source: 'history',
  state: 'complete',
  sessionKey: SIMULATOR_TOUCH_SESSION_KEY,
}];

/**
 * QA-only launch boundary. It clears exactly this fixture session through the
 * production draft store before AppShell's real draft owner is mounted.
 */
export function SimulatorTouchFixtureApp() {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let mounted = true;
    setWorkspacePersistenceActive(true);
    void saveDraft(SIMULATOR_TOUCH_SESSION_KEY, '').then(() => {
      if (mounted) setReady(true);
    }).catch((error: unknown) => {
      if (mounted) setFailure(error instanceof Error ? error.message : 'unknown local draft error');
    });
    return () => {
      mounted = false;
      setWorkspacePersistenceActive(false);
    };
  }, []);

  if (failure) return (
    <View accessibilityLabel={`${SIMULATOR_TOUCH_FIXTURE_ROOT} reset failed`}>
      <Text>{failure}</Text>
    </View>
  );
  if (!ready) return (
    <View accessibilityLabel={`${SIMULATOR_TOUCH_FIXTURE_ROOT} resetting isolated draft`}>
      <Text>{SIMULATOR_TOUCH_FIXTURE_ROOT}</Text>
    </View>
  );
  return <AppShell fixtureMessages={messages} fixtureGatewayStatus="connected"
    fixtureProjectRail={{ projects: [project], selectedKey: SIMULATOR_TOUCH_SESSION_KEY }} />;
}
