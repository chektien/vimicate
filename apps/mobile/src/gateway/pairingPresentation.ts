import type { GatewayStatus } from './OpenClawClient';

export type PairingSettingsState = boolean | null;
export type PairingInputIntent = 'empty' | 'current' | 'replacement';
export type PairingStatusTone = 'neutral' | 'pending' | 'success' | 'warning' | 'danger';

const EXPANDED_WORKSPACE_CHROME_MIN_WIDTH = 800;

const STATUS_PRESENTATION: Record<GatewayStatus, { label: string; compactLabel: string; tone: PairingStatusTone }> = {
  idle: { label: 'idle', compactLabel: 'Idle', tone: 'neutral' },
  connecting: { label: 'connecting', compactLabel: 'Linking', tone: 'pending' },
  connected: { label: 'connected', compactLabel: 'Online', tone: 'success' },
  disconnected: { label: 'disconnected', compactLabel: 'Offline', tone: 'warning' },
  error: { label: 'error', compactLabel: 'Error', tone: 'danger' },
};

/** Null preserves the useful default: setup is open until a profile is restored. */
export function shouldCollapsePairingSettings(hasPairedProfile: boolean, explicitlyExpanded: PairingSettingsState) {
  const settingsVisible = explicitlyExpanded ?? !hasPairedProfile;
  return !settingsVisible;
}

export function pairingInputIntent(input: string, pairedEndpoint?: string): PairingInputIntent {
  const value = input.trim();
  if (!value) return 'empty';
  return pairedEndpoint && value === pairedEndpoint.trim() ? 'current' : 'replacement';
}

export function pairingConnectionAction(status: GatewayStatus, hasPairedProfile: boolean, intent: PairingInputIntent) {
  if (status === 'connecting') return { label: 'Connecting…', disabled: true };
  if (intent === 'replacement') return { label: 'Pair', disabled: false };
  if (status === 'connected') return { label: 'Connected', disabled: true };
  if (hasPairedProfile) return { label: 'Reconnect', disabled: false };
  return { label: 'Pair', disabled: true };
}

export function pairingConnectionOperation(hasPairedProfile: boolean, intent: PairingInputIntent) {
  return hasPairedProfile && intent !== 'replacement' ? 'connect' : 'pair';
}

export function pairingInputAfterSuccess(currentInput: string, submittedRevision: number, currentRevision: number, pairedEndpoint: string) {
  return submittedRevision === currentRevision ? pairedEndpoint : currentInput;
}

export function pairingStatusPresentation(status: GatewayStatus) {
  return STATUS_PRESENTATION[status];
}

/** Wide headers retain workspace chrome; constrained headers devote the row to editing. */
export function pairingExpandedChromeForWidth(width: number) {
  return width >= EXPANDED_WORKSPACE_CHROME_MIN_WIDTH;
}
