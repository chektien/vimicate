import { describe, expect, it } from 'vitest';
import { pairingConnectionAction, pairingConnectionOperation, pairingExpandedChromeForWidth, pairingInputAfterSuccess, pairingInputIntent, pairingStatusPresentation, shouldCollapsePairingSettings } from './pairingPresentation';

describe('paired Gateway bar presentation', () => {
  it('defaults to setup only while unpaired and honors either explicit toggle state', () => {
    expect(shouldCollapsePairingSettings(true, null)).toBe(true);
    expect(shouldCollapsePairingSettings(false, null)).toBe(false);
    expect(shouldCollapsePairingSettings(true, true)).toBe(false);
    expect(shouldCollapsePairingSettings(false, false)).toBe(true);
  });

  it('reconnects the stored profile without treating its displayed endpoint as new pairing data', () => {
    expect(pairingInputIntent('', 'wss://gateway.example')).toBe('empty');
    expect(pairingInputIntent('  wss://gateway.example  ', 'wss://gateway.example')).toBe('current');
    expect(pairingInputIntent('wss://other.example', 'wss://gateway.example')).toBe('replacement');
    expect(pairingConnectionOperation(true, 'empty')).toBe('connect');
    expect(pairingConnectionOperation(true, 'current')).toBe('connect');
    expect(pairingConnectionAction('disconnected', true, 'current')).toEqual({ label: 'Reconnect', disabled: false });
    expect(pairingConnectionAction('connected', true, 'current')).toEqual({ label: 'Connected', disabled: true });
  });

  it('allows changed connection input even while the stored profile remains connected', () => {
    expect(pairingConnectionOperation(true, 'replacement')).toBe('pair');
    expect(pairingConnectionOperation(false, 'replacement')).toBe('pair');
    expect(pairingConnectionAction('connected', true, 'replacement')).toEqual({ label: 'Pair', disabled: false });
    expect(pairingConnectionAction('error', true, 'replacement')).toEqual({ label: 'Pair', disabled: false });
    expect(pairingConnectionAction('connecting', true, 'replacement')).toEqual({ label: 'Connecting…', disabled: true });
    expect(pairingConnectionAction('idle', false, 'empty')).toEqual({ label: 'Pair', disabled: true });
  });

  it('replaces a submitted setup code with its safe endpoint without overwriting newer edits', () => {
    expect(pairingInputAfterSuccess('encoded-secret', 3, 3, 'wss://gateway.example')).toBe('wss://gateway.example');
    expect(pairingInputAfterSuccess('wss://newer.example', 3, 4, 'wss://gateway.example')).toBe('wss://newer.example');
  });

  it('presents every transport status through the single connection control', () => {
    expect((['idle', 'connecting', 'connected', 'disconnected', 'error'] as const).map(pairingStatusPresentation)).toEqual([
      { label: 'idle', compactLabel: 'Idle', tone: 'neutral' },
      { label: 'connecting', compactLabel: 'Linking', tone: 'pending' },
      { label: 'connected', compactLabel: 'Online', tone: 'success' },
      { label: 'disconnected', compactLabel: 'Offline', tone: 'warning' },
      { label: 'error', compactLabel: 'Error', tone: 'danger' },
    ]);
  });

  it('retains workspace chrome beside expanded settings only when the measured header is wide', () => {
    expect(pairingExpandedChromeForWidth(1_024)).toBe(true);
    expect(pairingExpandedChromeForWidth(800)).toBe(true);
    expect(pairingExpandedChromeForWidth(799)).toBe(false);
    expect(pairingExpandedChromeForWidth(320)).toBe(false);
  });
});
