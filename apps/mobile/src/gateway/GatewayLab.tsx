import { CameraView, useCameraPermissions } from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme/tokens';
import { Action, Field, Label, Metric, Panel, SectionTitle } from '../ui/Primitives';
import { OpenClawClient, type GatewayStatus } from './OpenClawClient';
import { parseSetupCode, type GatewayProfile } from './setupCode';

const PROFILE_KEY = 'org.vimicate.rn.dev.phase1.gateway.profile.v1';
function countRows(payload: Record<string, unknown> | null, keys: string[]) { for (const key of keys) { const value = payload?.[key]; if (Array.isArray(value)) return value.length; } return 0; }

export function GatewayLab({ record }: { record: (message: string) => void }) {
  const clientRef = useRef(new OpenClawClient());
  const [rawSetup, setRawSetup] = useState('');
  const [profile, setProfile] = useState<GatewayProfile | null>(null);
  const [status, setStatus] = useState<GatewayStatus>('idle');
  const [detail, setDetail] = useState('no profile loaded');
  const [events, setEvents] = useState<string[]>([]);
  const [sessions, setSessions] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('Reply with a one-line Phase 1 gateway health acknowledgement.');
  const [runId, setRunId] = useState('');
  const [scanner, setScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    const client = clientRef.current;
    client.onStatus = (next, nextDetail) => { setStatus(next); if (nextDetail) setDetail(nextDetail); record(`gateway ${next}${nextDetail ? ` · ${nextDetail}` : ''}`); };
    client.onEvent = (frame) => setEvents((current) => [`${new Date().toLocaleTimeString([], { hour12: false })} ${String(frame.event ?? frame.type ?? 'frame')}`, ...current].slice(0, 80));
    client.onIssuedDeviceToken = (token) => {
      setProfile((current) => {
        if (!current) return current;
        const paired = { ...current, credentialKind: 'deviceToken' as const, credential: token };
        void SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(paired), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
        return paired;
      });
      record('gateway stored issued device token in isolated Keychain namespace');
    };
    void SecureStore.getItemAsync(PROFILE_KEY).then((stored) => { if (!stored) return; try { const parsed = JSON.parse(stored) as GatewayProfile; setProfile(parsed); setRawSetup(parsed.endpoint); setDetail('paired profile restored from Keychain'); } catch { setDetail('stored profile was invalid'); } });
    return () => client.disconnect();
  }, [record]);

  const acceptSetup = (input = rawSetup) => {
    const parsed = parseSetupCode(input); if (!parsed) { setDetail('setup code rejected: use WSS or a private-network WS address'); return; }
    setProfile(parsed); setRawSetup(parsed.endpoint); setDetail(`${parsed.endpoint} · ${parsed.credentialKind === 'none' ? 'unpaired' : 'credential captured'}`);
    void SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(parsed), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    record(`gateway profile accepted ${parsed.endpoint}`);
  };
  const execute = async (name: string, work: () => Promise<Record<string, unknown>>, consume?: (payload: Record<string, unknown>) => void) => {
    try { const payload = await work(); consume?.(payload); setDetail(`${name} ok`); record(`${name} ok`); } catch (error) { const value = error instanceof Error ? error.message : String(error); setDetail(`${name}: ${value}`); record(`${name} failed · ${value}`); }
  };

  return (
    <View style={styles.root}>
      <SectionTitle index="03" title="GATEWAY / PAIRING" detail="Real OpenClaw v3/v4 challenge signing, Keychain device token, sessions, history, send, abort." />
      <View style={styles.metrics}><Metric label="state" value={status} tone={status === 'connected' ? 'good' : status === 'error' ? 'bad' : 'warn'} /><Metric label="credential" value={profile?.credentialKind ?? 'none'} /><Metric label="sessions" value={countRows(sessions, ['sessions', 'items'])} /><Metric label="history" value={countRows(history, ['messages', 'items'])} /><Metric label="events" value={events.length} /></View>
      <View style={styles.columns}>
        <Panel style={styles.setupPanel}>
          <Label tone="accent">private setup</Label>
          <Text style={styles.copy}>Paste or scan an OpenClaw setup code. Secrets are immediately moved into this app’s own Keychain namespace and never shown again.</Text>
          <Field accessibilityLabel="OpenClaw setup code" multiline numberOfLines={4} onChangeText={setRawSetup} placeholder="setup JSON, base64url, openclaw://, wss:// or private ws://" secureTextEntry={rawSetup !== profile?.endpoint && rawSetup.length > 0} style={styles.setupField} value={rawSetup} />
          <View style={styles.actions}><Action label="PARSE + SAVE" onPress={() => acceptSetup()} /><Action label={scanner ? 'CLOSE SCANNER' : 'SCAN QR'} onPress={async () => { if (!permission?.granted) await requestPermission(); setScanner((value) => !value); }} /><Action label="FORGET" danger onPress={() => { clientRef.current.disconnect(); setProfile(null); setRawSetup(''); void SecureStore.deleteItemAsync(PROFILE_KEY); }} /></View>
          {scanner && permission?.granted ? <CameraView barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { setScanner(false); setRawSetup(data); acceptSetup(data); }} style={styles.camera} /> : null}
          <View style={styles.endpoint}><Label>endpoint</Label><Text style={styles.endpointValue}>{profile?.endpoint ?? '—'}</Text><Label>session key</Label><Text numberOfLines={2} style={styles.endpointValue}>{profile?.sessionKey ?? '—'}</Text></View>
          <View style={styles.actions}><Action label="CONNECT" active={status === 'connected'} disabled={!profile || status === 'connecting'} onPress={() => { if (profile) void clientRef.current.connect(profile); }} /><Action label="DISCONNECT" onPress={() => clientRef.current.disconnect()} /><Action label="SESSIONS" disabled={status !== 'connected'} onPress={() => void execute('sessions.list', () => clientRef.current.listSessions(), setSessions)} /><Action label="HISTORY" disabled={status !== 'connected' || !profile} onPress={() => profile && void execute('chat.history', () => clientRef.current.history(profile.sessionKey), setHistory)} /></View>
          <Field accessibilityLabel="Gateway message" multiline onChangeText={setMessage} style={styles.messageField} value={message} />
          <View style={styles.actions}><Action label="SEND" disabled={status !== 'connected' || !profile || !message.trim()} onPress={() => profile && void execute('chat.send', () => clientRef.current.send(profile.sessionKey, message), (payload) => { setRunId(String(payload.runId ?? payload.id ?? '')); })} /><Action label="ABORT" danger disabled={status !== 'connected' || !profile} onPress={() => profile && void execute('chat.abort', () => clientRef.current.abort(profile.sessionKey, runId || undefined))} /></View>
        </Panel>
        <Panel style={styles.logPanel}>
          <Label tone={status === 'error' ? 'danger' : 'good'}>wire journal</Label><Text style={styles.detail}>{detail}</Text>
          <ScrollView style={styles.log}><Text selectable style={styles.logText}>{events.length ? events.join('\n') : 'No live frames yet.\nConnect to begin the protocol probe.'}</Text></ScrollView>
        </Panel>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 }, metrics: { flexDirection: 'row', gap: space.sm, marginBottom: space.md }, columns: { flex: 1, flexDirection: 'row', gap: space.md }, setupPanel: { flex: 1.25 }, logPanel: { flex: 0.75 },
  copy: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 11, lineHeight: 17, marginVertical: space.md }, setupField: { minHeight: 76 }, messageField: { minHeight: 70, marginTop: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md }, camera: { height: 180, marginTop: space.md, borderWidth: 1, borderColor: colors.yellow },
  endpoint: { borderLeftWidth: 3, borderLeftColor: colors.blue, paddingLeft: space.md, marginTop: space.lg, gap: space.xs }, endpointValue: { color: colors.inkBright, fontFamily: type.mono, fontSize: 11, marginBottom: space.sm },
  detail: { color: colors.ink, fontFamily: type.mono, fontSize: 11, lineHeight: 17, marginVertical: space.md }, log: { flex: 1, backgroundColor: colors.inset, borderWidth: 1, borderColor: colors.border, padding: space.sm },
  logText: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 10, lineHeight: 17 },
});
