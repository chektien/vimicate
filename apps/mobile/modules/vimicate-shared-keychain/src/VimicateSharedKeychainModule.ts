import { NativeModule, requireOptionalNativeModule } from 'expo';

export type SharedKeychainRecord = 'identity' | 'credential' | 'endpoint';

declare class VimicateSharedKeychainModule extends NativeModule<{}> {
  getItem(record: SharedKeychainRecord): Promise<string | null>;
  setItem(record: SharedKeychainRecord, value: string): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<VimicateSharedKeychainModule>('VimicateSharedKeychain');

function requiredModule() {
  if (!nativeModule) {
    throw new Error('The Vimicate shared-Keychain bridge is unavailable. Install the Vimicate RN build instead of opening this project in Expo Go.');
  }
  return nativeModule;
}

export function getSharedKeychainItem(record: SharedKeychainRecord) {
  return requiredModule().getItem(record);
}

export function setSharedKeychainItem(record: SharedKeychainRecord, value: string) {
  return requiredModule().setItem(record, value);
}
