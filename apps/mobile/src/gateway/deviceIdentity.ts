import { fromByteArray, toByteArray } from 'base64-js';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import { getSharedKeychainItem, setSharedKeychainItem } from '../../modules/vimicate-shared-keychain';
import { deviceIDForPublicKeyWithDigest } from './deviceIdentityDigest';

const IDENTITY_KEY = 'org.vimicate.rn.dev.phase1.openclaw.identity.v1';
export type DeviceIdentity = { deviceId: string; publicKey: string; privateKey: string; createdAtMs: number };
type NativeDeviceIdentity = { deviceId: string; publicKey: string; privateKey: string; createdAtMs: number };
const base64Url = (bytes: Uint8Array) => fromByteArray(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

export async function deviceIDForPublicKey(publicKey: Uint8Array) {
  return deviceIDForPublicKeyWithDigest(
    publicKey,
    Crypto.CryptoDigestAlgorithm.SHA256,
    (algorithm, data) => Crypto.digest(algorithm as Crypto.CryptoDigestAlgorithm, data),
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function loadOrCreateIdentity(requireSharedIdentity = false, allowSharedIdentity = true): Promise<DeviceIdentity> {
  const shared = allowSharedIdentity ? await getSharedKeychainItem('identity') : null;
  if (shared) {
    try {
      const native = JSON.parse(shared) as NativeDeviceIdentity;
      const seed = toByteArray(native.privateKey);
      const publicKey = toByteArray(native.publicKey);
      const pair = seed.length === 32 ? nacl.sign.keyPair.fromSeed(seed) : null;
      if (pair && publicKey.length === 32 && equalBytes(pair.publicKey, publicKey) && native.deviceId === await deviceIDForPublicKey(publicKey)) {
        const identity = { ...native, privateKey: fromByteArray(pair.secretKey) };
        await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
        return identity;
      }
    } catch (error) {
      throw new Error(`The shared native OpenClaw device identity is invalid: ${error instanceof Error ? error.message : 'validation failed'}`);
    }
    throw new Error('The shared native OpenClaw device identity does not match its signing key. Reopen native Vimicate to repair the shared pairing; RN will not create a second device.');
  }
  if (requireSharedIdentity) {
    throw new Error('The native paired token exists but its shared OpenClaw device identity is missing. Reopen native Vimicate to restore it; RN will not register a second device.');
  }
  const stored = await SecureStore.getItemAsync(IDENTITY_KEY);
  if (stored) {
    try {
      const identity = JSON.parse(stored) as DeviceIdentity;
      const publicKey = toByteArray(identity.publicKey);
      const secretKey = toByteArray(identity.privateKey);
      const pair = secretKey.length === 64 ? nacl.sign.keyPair.fromSecretKey(secretKey) : null;
      if (pair && publicKey.length === 32 && equalBytes(pair.publicKey, publicKey) && identity.deviceId === await deviceIDForPublicKey(publicKey)) {
        const nativeIdentity: NativeDeviceIdentity = { ...identity, privateKey: fromByteArray(pair.secretKey.slice(0, 32)) };
        if (allowSharedIdentity) await setSharedKeychainItem('identity', JSON.stringify(nativeIdentity));
        return identity;
      }
    } catch { /* regenerate */ }
  }
  const pair = nacl.sign.keyPair.fromSeed(Crypto.getRandomBytes(32));
  const identity = { deviceId: await deviceIDForPublicKey(pair.publicKey), publicKey: fromByteArray(pair.publicKey), privateKey: fromByteArray(pair.secretKey), createdAtMs: Date.now() };
  const nativeIdentity: NativeDeviceIdentity = { ...identity, privateKey: fromByteArray(pair.secretKey.slice(0, 32)) };
  if (allowSharedIdentity) await setSharedKeychainItem('identity', JSON.stringify(nativeIdentity));
  await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return identity;
}
export async function resetLocalDeviceIdentityIfSimulator() { if (Device.isDevice === false) await SecureStore.deleteItemAsync(IDENTITY_KEY); }
export async function buildDeviceAuth(identity: DeviceIdentity, token: string, nonce: string, scopes: string[], options: { mode?: 'ui' | 'node'; role?: 'operator' | 'node'; deviceFamily?: 'ipad' | 'iphone' } = {}) {
  const signedAt = Date.now(); const clientId = 'openclaw-ios'; const mode = options.mode ?? 'ui'; const role = options.role ?? 'operator'; const deviceFamily = options.deviceFamily ?? 'ipad';
  const payload = ['v3', identity.deviceId, clientId, mode, role, scopes.join(','), String(signedAt), token, nonce, 'ios', deviceFamily].join('|');
  const signature = nacl.sign.detached(new TextEncoder().encode(payload), toByteArray(identity.privateKey));
  return { id: identity.deviceId, publicKey: base64Url(toByteArray(identity.publicKey)), signature: base64Url(signature), signedAt, nonce };
}
