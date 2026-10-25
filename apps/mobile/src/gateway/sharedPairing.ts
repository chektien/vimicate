import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { getSharedKeychainItem, setSharedKeychainItem } from '../../modules/vimicate-shared-keychain';
import type { GatewayProfile } from './setupCode';
import { profileFromSharedRecords } from './sharedPairingRecords';

const DETACHED_KEY = 'org.vimicate.rn.dev.shared-pairing-detached.v1';

type StoredCredential = { kind: string; token: string; scopes?: string[]; authorityGeneration?: string };
type StoredEndpoint = { host: string; port: number; useTLS: boolean; path?: string; sessionKey: string };

export async function loadSharedGatewayProfile(): Promise<GatewayProfile | null> {
  if (await SecureStore.getItemAsync(DETACHED_KEY)) return null;
  const [credentialJSON, endpointJSON] = await Promise.all([
    getSharedKeychainItem('credential'),
    getSharedKeychainItem('endpoint'),
  ]);
  if (!credentialJSON || !endpointJSON) return null;
  return profileFromSharedRecords(credentialJSON, endpointJSON);
}

export async function saveSharedPairedProfile(profile: GatewayProfile, token: string, scopes: string[]) {
  const current = await getSharedKeychainItem('credential');
  let generation = Crypto.randomUUID();
  try { generation = (JSON.parse(current ?? '{}') as StoredCredential).authorityGeneration || generation; } catch { /* use new generation */ }
  const url = new URL(profile.endpoint);
  const endpoint: StoredEndpoint = {
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'wss:' ? 443 : 80)),
    useTLS: url.protocol === 'wss:',
    path: url.pathname === '/' ? '' : url.pathname,
    sessionKey: profile.sessionKey || 'agent:main:direct:vimicate-ios',
  };
  const credential: StoredCredential = { kind: 'pairedDeviceToken', token, scopes, authorityGeneration: generation };
  await Promise.all([
    setSharedKeychainItem('credential', JSON.stringify(credential)),
    setSharedKeychainItem('endpoint', JSON.stringify(endpoint)),
    SecureStore.deleteItemAsync(DETACHED_KEY),
  ]);
}

export async function detachSharedPairing() { await SecureStore.setItemAsync(DETACHED_KEY, '1'); }
export async function reattachSharedPairing() { await SecureStore.deleteItemAsync(DETACHED_KEY); }
