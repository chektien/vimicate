import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppShell } from './AppShell';
import {
  SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT,
  simulatorTranscriptFixtureMessages,
  simulatorTranscriptGeometryMessages,
} from './simulatorTranscriptFixtures';

/**
 * Isolated simulator transport for explicit older-history interaction.
 * Every accepted call completes one page, so an owner-side duplicate request
 * makes the third-page cascade marker observable to native acceptance.
 */
export function SimulatorTranscriptFixtureApp({ geometry = false }: { geometry?: boolean }) {
  const [loadedOlderPageCount, setLoadedOlderPageCount] = useState(0);
  const [activeRequestCount, setActiveRequestCount] = useState(0);
  const [acceptedRequestCount, setAcceptedRequestCount] = useState(0);
  const loadedPageCountRef = useRef(0);
  const mountedRef = useRef(true);
  const pendingRequests = useRef<Array<() => void>>([]);
  useEffect(() => () => {
    mountedRef.current = false;
    for (const resolve of pendingRequests.current.splice(0)) resolve();
  }, []);
  const messages = useMemo(
    () => geometry ? simulatorTranscriptGeometryMessages(loadedOlderPageCount) : simulatorTranscriptFixtureMessages(loadedOlderPageCount),
    [geometry, loadedOlderPageCount],
  );
  const loadOlderHistory = useCallback(async () => {
    if (loadedPageCountRef.current >= SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT) return;
    setActiveRequestCount((current) => current + 1);
    setAcceptedRequestCount((current) => current + 1);
    await new Promise<void>((resolve) => {
      pendingRequests.current.push(resolve);
    });
    if (!mountedRef.current) return;
    setLoadedOlderPageCount((current) => {
      const next = Math.min(SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT, current + 1);
      loadedPageCountRef.current = next;
      return next;
    });
    setActiveRequestCount((current) => Math.max(0, current - 1));
  }, []);
  const completeOlderHistoryRequest = useCallback(() => {
    pendingRequests.current.shift()?.();
  }, []);

  return (
    <View style={styles.root}>
      <AppShell
        fixtureMessages={messages}
        fixtureOlderHistory={{
          canLoadOlder: loadedOlderPageCount < SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT,
          loadingOlder: activeRequestCount > 0,
          loadOlderHistory,
        }}
      />
      {activeRequestCount > 0 ? <Pressable
        accessibilityRole="button"
        accessibilityLabel="Complete simulator older-history request"
        onPress={completeOlderHistoryRequest}
        style={styles.completion}
      ><Text style={styles.completionText}>{`complete history request · ${acceptedRequestCount} accepted`}</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  completion: {
    position: 'absolute', right: 8, bottom: 40, zIndex: 100, minHeight: 36,
    justifyContent: 'center', borderRadius: 5, borderWidth: 1,
    borderColor: '#d79921', backgroundColor: '#282828', paddingHorizontal: 10,
  },
  completionText: { color: '#fabd2f', fontFamily: 'monospace', fontSize: 10, fontWeight: '700' },
});
