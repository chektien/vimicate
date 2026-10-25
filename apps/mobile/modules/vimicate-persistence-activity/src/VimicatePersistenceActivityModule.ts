import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class VimicatePersistenceActivityModule extends NativeModule<{}> {
  beginPersistenceWrite(): Promise<string | null>;
  endPersistenceWrite(token: string): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<VimicatePersistenceActivityModule>(
  'VimicatePersistenceActivity',
);

/**
 * Keep one already-started, short workspace write eligible to finish if iOS
 * backgrounds the app. Queue suspension still prevents any later write from
 * entering SQLite until the app is active again.
 */
export async function withPersistenceActivity<T>(task: () => Promise<T>): Promise<T> {
  const token = await nativeModule?.beginPersistenceWrite() ?? null;
  try {
    return await task();
  } finally {
    if (token) await nativeModule?.endPersistenceWrite(token);
  }
}
