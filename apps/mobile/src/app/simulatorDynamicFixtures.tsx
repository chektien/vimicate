import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppShell } from './AppShell';
import { HistoryPublicationAuthority } from '../gateway/historyPublicationAuthority';
import type { GatewayStatus, OpenClawClient } from '../gateway/OpenClawClient';
import { providerQuotaForProject } from '../gateway/providerQuota';
import type { GatewayProfile } from '../gateway/setupCode';
import { useGatewayMessageRecovery } from '../gateway/useGatewayMessageRecovery';
import { useProviderUsage } from '../gateway/useProviderUsage';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import { commitSimulatorClaudeQueue, restoreSimulatorClaudeQueue, simulatorClaudeQueuedRows } from './simulatorClaudeQueueFixture';
import { publishSimulatorGlmCanonical, repeatSimulatorGlmCanonical, restoreSimulatorGlmCache, simulatorGlmLiveRows } from './simulatorGlmPreambleFixture';
import {
  OVERSIZED_DYNAMIC_FINAL,
  acknowledgeSimulatorDynamicReceipts,
  oversizedMessageID,
  oversizedSessionKey,
  publishSimulatorDynamicCanonicalRows,
  repeatSimulatorDynamicCanonicalRefresh,
  restoreSimulatorDynamicCanonicalCache,
  simulatorDynamicRows,
  simulatorDynamicRowsForReceiptPhase,
  simulatorQuotaProject,
} from './simulatorDynamicFixtureData';

const bootstrapProfile: GatewayProfile = {
  endpoint: 'wss://simulator.invalid', sessionKey: simulatorQuotaProject.sessionKey,
  credentialKind: 'bootstrapToken', credential: 'simulator-bootstrap-one',
};

class SimulatorFakeGatewayIO {
  status: GatewayStatus = 'connected';
  private usageAttempt = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  providerUsage() {
    const attempt = ++this.usageAttempt;
    return this.schedule<Record<string, unknown>>(attempt === 1 ? 10_000 : attempt === 2 ? 13_000 : 5_000, (resolve, reject) => {
      if (attempt === 3) { reject(new Error('simulator quota unavailable')); return; }
      const usedPercent = attempt === 1 ? 25 : attempt === 2 ? 95 : 40;
      resolve({
        updatedAt: attempt === 1 ? Date.now() - 120_000 : Date.now(),
        providers: [{ provider: 'openai', windows: [{ label: '5h', usedPercent }] }],
      });
    });
  }

  getMessage(sessionKey: string, messageID: string) {
    return this.schedule<Record<string, unknown>>(5_000, (resolve, reject) => {
      if (sessionKey !== oversizedSessionKey || messageID !== oversizedMessageID) {
        reject(new Error('simulator recovery identity mismatch')); return;
      }
      resolve({ ok: true, message: { id: oversizedMessageID, text: OVERSIZED_DYNAMIC_FINAL } });
    });
  }

  decorateMessages(messages: WorkspaceMessage[]) { return messages; }

  dispose() { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }

  private schedule<T>(delayMs: number, work: (resolve: (value: T) => void, reject: (error: Error) => void) => void) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.timers.delete(timer); work(resolve, reject); }, delayMs);
      this.timers.add(timer);
    });
  }
}

/** Explicit QA entrypoint: real owners, bounded fake I/O, and no live Gateway. */
export function SimulatorDynamicFixtureApp() {
  const client = useMemo(() => new SimulatorFakeGatewayIO(), []);
  const scene = useRef(new HistoryPublicationAuthority());
  const [messages, setMessages] = useState(() => simulatorDynamicRowsForReceiptPhase(false, false));
  const [receiptPhase, setReceiptPhase] = useState<'automatic' | 'before-ack' | 'acknowledged' | 'canonical'>('automatic');
  const [claudeQueuePhase, setClaudeQueuePhase] = useState('');
  const [glmPhase, setGlmPhase] = useState('inactive');
  const glmReplay = useRef(false);
  const glmRefreshCount = useRef(0);
  const manualReceiptControl = useRef(false);
  const canonicalRefreshCount = useRef(0);
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const selectedRef = useRef(oversizedSessionKey);
  const projectsRef = useRef<WorkspaceProject[]>([simulatorQuotaProject]);
  const [status, setStatus] = useState<GatewayStatus>('connected');
  const [profile, setProfile] = useState<GatewayProfile | null>(bootstrapProfile);
  client.status = status;
  const usage = useProviderUsage(client as unknown as OpenClawClient, profile, status, scene);
  const recover = useGatewayMessageRecovery({
    client: client as unknown as OpenClawClient, selectedRef, messagesRef,
    messageSessionKey: oversizedSessionKey, projectsRef,
    updateSessionMessages: (_sessionKey, action) => setMessages(current => typeof action === 'function' ? action(current) : action),
    setDetail: () => undefined, scenePublicationAuthority: scene,
  });
  const recoverRef = useRef(recover); recoverRef.current = recover;

  useEffect(() => {
    const timers = [
      setTimeout(() => {
        if (!manualReceiptControl.current) setMessages(acknowledgeSimulatorDynamicReceipts);
      }, 4_000),
      setTimeout(() => setMessages(current => {
        if (manualReceiptControl.current) return current;
        const recovered = current.find(row => row.id === oversizedMessageID);
        return publishSimulatorDynamicCanonicalRows(current)
          .map(row => row.id === oversizedMessageID && recovered ? recovered : row);
      }), 12_000),
      setTimeout(() => void recoverRef.current(oversizedMessageID), 15_000),
      setTimeout(() => setStatus('connecting'), 16_000),
      setTimeout(() => setStatus('disconnected'), 21_000),
      setTimeout(() => setStatus('connected'), 26_000),
      setTimeout(() => setProfile({ ...bootstrapProfile, credentialKind: 'deviceToken', credential: 'simulator-account-two' }), 36_000),
      setTimeout(() => setProfile({ ...bootstrapProfile, credentialKind: 'deviceToken', credential: 'simulator-account-three' }), 46_000),
    ];
    return () => { timers.forEach(clearTimeout); client.dispose(); };
  }, [client]);

  const chooseReceiptPhase = (phase: 'before-ack' | 'acknowledged' | 'canonical') => {
    manualReceiptControl.current = true;
    if (glmReplay.current && phase === 'canonical') {
      glmRefreshCount.current += 1;
      setGlmPhase(glmRefreshCount.current === 1 ? 'canonical'
        : glmRefreshCount.current === 2 ? 'refresh' : 'cache');
      setMessages(glmRefreshCount.current === 1 ? publishSimulatorGlmCanonical
        : glmRefreshCount.current === 2 ? repeatSimulatorGlmCanonical : restoreSimulatorGlmCache);
      return;
    }
    glmReplay.current = false;
    setGlmPhase('inactive');
    setReceiptPhase(phase);
    setClaudeQueuePhase('');
    if (phase === 'before-ack') {
      canonicalRefreshCount.current = 0;
      setMessages(simulatorDynamicRowsForReceiptPhase(false, false));
    } else if (phase === 'acknowledged') {
      setMessages(acknowledgeSimulatorDynamicReceipts);
    } else {
      canonicalRefreshCount.current += 1;
      if (canonicalRefreshCount.current === 1) {
        setMessages(publishSimulatorDynamicCanonicalRows);
      } else if (canonicalRefreshCount.current === 2) {
        setMessages(repeatSimulatorDynamicCanonicalRefresh);
      } else {
        setMessages(restoreSimulatorDynamicCanonicalCache);
      }
    }
  };

  const quota = providerQuotaForProject(usage.state, simulatorQuotaProject, Date.now(), status);
  return <View style={styles.root}>
    <SafeAreaView edges={['top']} style={styles.controlSafeArea}>
      <View accessibilityLabel={`Receipt QA controls, current phase ${receiptPhase}`} style={styles.controls}>
        {([
          ['before-ack', 'QA receipt before ack'],
          ['acknowledged', 'QA receipt acknowledge'],
          ['canonical', 'QA receipt canonical'],
        ] as const).map(([phase, label]) => <Pressable
          key={phase}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: receiptPhase === phase }}
          onPress={() => chooseReceiptPhase(phase)}
          style={[styles.control, receiptPhase === phase && styles.selected]}
        ><Text style={styles.label}>{phase}</Text></Pressable>)}
      </View>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel="QA Claude queued inputs"
          style={styles.control} onPress={() => {
            manualReceiptControl.current = true;
            setClaudeQueuePhase('queued');
            setMessages(simulatorClaudeQueuedRows());
          }}><Text style={styles.label}>Claude queued</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="QA Claude commit inputs"
          style={styles.control} onPress={() => {
            manualReceiptControl.current = true;
            setClaudeQueuePhase('committed');
            setMessages(commitSimulatorClaudeQueue);
          }}><Text style={styles.label}>Claude commit</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="QA Claude restore inputs"
          style={styles.control} onPress={() => {
            manualReceiptControl.current = true;
            setClaudeQueuePhase('restored');
            setMessages(restoreSimulatorClaudeQueue);
          }}><Text style={styles.label}>Claude restore</Text></Pressable>
        <Text accessibilityLabel={`Claude queue phase ${claudeQueuePhase || 'inactive'}`} style={styles.label}>
          {claudeQueuePhase}
        </Text>
      </View>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel="QA GLM live replay"
          style={styles.control} onPress={() => {
            manualReceiptControl.current = true;
            glmReplay.current = true;
            glmRefreshCount.current = 0;
            setGlmPhase('live');
            setMessages(simulatorGlmLiveRows());
          }}><Text style={styles.label}>GLM replay</Text></Pressable>
        <Text accessibilityLabel={`QA GLM phase ${glmPhase}`} style={styles.label}>{glmPhase}</Text>
      </View>
    </SafeAreaView>
    <AppShell fixtureMessages={messages} fixtureGatewayStatus={status} fixtureProviderQuota={quota ?? undefined}
      fixtureProjectRail={{ projects: [simulatorQuotaProject], selectedKey: simulatorQuotaProject.sessionKey }} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  controlSafeArea: { backgroundColor: '#111827' },
  controls: { flexDirection: 'row', gap: 3, paddingHorizontal: 4, paddingVertical: 3, backgroundColor: '#111827' },
  control: { flex: 1, alignItems: 'center', paddingHorizontal: 5, paddingVertical: 3, borderWidth: 1, borderColor: '#475569', borderRadius: 4, backgroundColor: '#1e293b' },
  selected: { borderColor: '#93c5fd', backgroundColor: '#1e3a5f' },
  label: { color: '#e2e8f0', fontSize: 9, fontWeight: '700' },
});
