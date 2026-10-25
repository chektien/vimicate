import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import type { useGatewayWorkspace } from './useGatewayWorkspace';
import type { GatewayStatus } from './OpenClawClient';
import { pairingConnectionAction, pairingConnectionOperation, pairingExpandedChromeForWidth, pairingInputAfterSuccess, pairingInputIntent, pairingStatusPresentation, shouldCollapsePairingSettings } from './pairingPresentation';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { parseSetupCode } from './setupCode';
import { VimicateMark } from '../ui/VimicateMark';
import { ConnectionStatusControl } from './ConnectionStatusControl';

type GatewayWorkspace = ReturnType<typeof useGatewayWorkspace>;
type PairingGateway = Pick<GatewayWorkspace, 'profile' | 'status' | 'pair' | 'connect' | 'forget'>;

type PairingBarProps = {
  gateway: PairingGateway;
  statusOverride?: GatewayStatus | undefined;
  onEditingChange: (editing: boolean) => void;
  paneControls?: ReactNode;
  helpControl?: ReactNode;
};

export function PairingBar({ gateway, statusOverride, onEditingChange, paneControls, helpControl }: PairingBarProps) {
  const { profile, pair, connect, forget } = gateway;
  const status = statusOverride ?? gateway.status;
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  const valueRevision = useRef(0);
  const settingsScroll = useRef<ScrollView>(null);
  const [scanner, setScanner] = useState(false);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [error, setError] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const updateValue = (next: string) => { valueRef.current = next; valueRevision.current += 1; setValue(next); };
  useEffect(() => { if (!profile) updateValue(''); }, [profile]);
  const launchPairingTask = (task: () => unknown | Promise<unknown>, fallback: string) => launchGuardedBackgroundTask(task, (reason) => setError(reason instanceof Error && reason.message.trim() ? reason.message : fallback));
  const inputIntent = pairingInputIntent(value, profile?.endpoint);
  const connectionAction = pairingConnectionAction(status, Boolean(profile), inputIntent);
  const statusPresentation = pairingStatusPresentation(status);
  const settingsVisible = !shouldCollapsePairingSettings(Boolean(profile), expanded);
  const showWorkspaceChrome = !settingsVisible || pairingExpandedChromeForWidth(barWidth);
  const inputProfile = value.trim() ? parseSetupCode(value) : null;
  const secureInput = inputIntent === 'replacement' && inputProfile?.credentialKind !== 'none';

  const setSettingsOpen = (open: boolean) => {
    if (open && profile?.endpoint && !value.trim()) updateValue(profile.endpoint);
    setExpanded(open);
    onEditingChange(open);
  };
  const collapseSettings = () => setSettingsOpen(false);

  const pairAndConnect = async (raw = value) => {
    const submittedRevision = valueRevision.current;
    try {
      setError('');
      const parsed = await pair(raw);
      await connect(parsed);
      const nextValue = pairingInputAfterSuccess(valueRef.current, submittedRevision, valueRevision.current, parsed.endpoint);
      if (nextValue !== valueRef.current) updateValue(nextValue);
      collapseSettings();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'pairing failed'); }
  };
  const connectPrimary = async () => {
    if (pairingConnectionOperation(Boolean(profile), inputIntent) === 'connect') {
      try { setError(''); await connect(); collapseSettings(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'connection failed'); }
      return;
    }
    await pairAndConnect();
  };
  const requestScanner = async () => {
    const granted = permission?.granted || (await requestPermission()).granted;
    if (!granted) throw new Error('Camera permission is required to scan the setup code.');
    setScanner(true);
  };
  const connectionActionDisabled = connectionAction.disabled;
  const connectionActionLabel = connectionAction.label;
  const scannerModal = <Modal visible={scanner} animationType="fade" onRequestClose={() => setScanner(false)}><View style={styles.scanner}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { setScanner(false); updateValue(data); launchPairingTask(() => pairAndConnect(data), 'pairing failed'); }} /><Pressable onPress={() => setScanner(false)} style={styles.closeScanner}><Text style={styles.closeScannerText}>close ×</Text></Pressable></View></Modal>;

  const input = <TextInput accessibilityLabel="OpenClaw setup code or Gateway URL" value={value} onChangeText={updateValue} onFocus={() => onEditingChange(true)} autoCapitalize="none" autoCorrect={false} placeholder="setup code or Gateway URL" placeholderTextColor={colors.faint} secureTextEntry={secureInput} style={styles.setupInput} />;
  const actions = <>
    <Pressable accessibilityRole="button" accessibilityLabel="Scan OpenClaw setup code" style={[styles.actionButton, styles.scanButton]} onPress={() => launchPairingTask(requestScanner, 'camera permission failed')}><Text style={styles.actionLabel}>▧ Scan</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={connectionActionLabel} accessibilityState={{ disabled: connectionActionDisabled, busy: status === 'connecting' }} style={[styles.actionButton, styles.connectionButton]} onPress={() => launchPairingTask(connectPrimary, 'connection failed')} disabled={connectionActionDisabled}><Text numberOfLines={1} style={[styles.actionLabel, styles.pair, connectionActionDisabled && styles.disabled]}>{connectionActionLabel}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Forget RN Gateway connection" accessibilityState={{ disabled: !profile }} style={[styles.actionButton, styles.forgetButton]} disabled={!profile} onPress={() => { updateValue(''); collapseSettings(); launchPairingTask(forget, 'forget failed'); }}><Text style={[styles.actionLabel, styles.forget, !profile && styles.disabled]}>▣ Forget</Text></Pressable>
  </>;

  return (
    <View onLayout={({ nativeEvent }) => setBarWidth(nativeEvent.layout.width)} style={styles.pairing}>
      <View style={styles.headerRow}>
        {showWorkspaceChrome ? <VimicateMark /> : null}{showWorkspaceChrome ? helpControl : null}
        <ConnectionStatusControl expanded={settingsVisible} label={statusPresentation.label} tone={statusPresentation.tone} onPress={() => setSettingsOpen(!settingsVisible)} />
        {settingsVisible ? <ScrollView
          ref={settingsScroll}
          accessibilityLabel="Gateway connection settings"
          horizontal
          directionalLockEnabled
          keyboardDismissMode="none"
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => { if (error) settingsScroll.current?.scrollToEnd({ animated: true }); }}
          style={styles.settingsViewport}
          contentContainerStyle={styles.setupRow}
        >{input}{actions}{error ? <Text accessibilityLiveRegion="polite" numberOfLines={1} style={styles.pairError}>{error}</Text> : null}</ScrollView> : <>
          {error ? <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.pairError, styles.collapsedError]}>{error}</Text> : <View style={styles.spacer} />}
        </>}
        {showWorkspaceChrome ? paneControls : null}
      </View>
      {scannerModal}
    </View>
  );
}

const styles = StyleSheet.create({
  pairing: { height: 33, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerRow: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 6 },
  spacer: { flex: 1 },
  settingsViewport: { minWidth: 0, height: 28, flex: 1 },
  setupRow: { minWidth: '100%', height: 28, flexDirection: 'row', alignItems: 'center', gap: 4 },
  setupInput: { width: 190, height: 24, flexShrink: 0, paddingHorizontal: 7, paddingVertical: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 4, color: colors.ink, backgroundColor: colors.canvas, fontFamily: type.mono, fontSize: 10 },
  actionButton: { height: 24, flexShrink: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 6 },
  scanButton: { minWidth: 52 }, connectionButton: { minWidth: 78 }, forgetButton: { minWidth: 62 },
  actionLabel: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 9, lineHeight: 12, fontWeight: '700', textAlign: 'center' },
  pair: { color: colors.yellow }, forget: { color: colors.red },
  disabled: { color: colors.faint },
  pairError: { maxWidth: 280, flexShrink: 1, color: colors.red, fontFamily: type.mono, fontSize: 9, lineHeight: 12 },
  collapsedError: { minWidth: 0, flex: 1 },
  scanner: { flex: 1, backgroundColor: colors.canvas },
  closeScanner: { position: 'absolute', top: 50, right: 24, backgroundColor: colors.inset, borderWidth: 1, borderColor: colors.ink, paddingHorizontal: 15, paddingVertical: 9 },
  closeScannerText: { color: colors.inkBright, fontFamily: type.mono, fontSize: 12 },
});
