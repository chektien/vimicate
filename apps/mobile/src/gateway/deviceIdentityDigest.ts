export type ByteDigest = (algorithm: string, data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;

export async function deviceIDForPublicKeyWithDigest(
  publicKey: Uint8Array,
  algorithm: string,
  digest: ByteDigest,
) {
  // Keep an owned TypedArray at the native boundary. Expo's iOS digest bridge
  // rejects an ArrayBuffer even though TypeScript's BufferSource accepts one.
  const input = new Uint8Array(publicKey);
  const hash = new Uint8Array(await digest(algorithm, input));
  return Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('');
}
