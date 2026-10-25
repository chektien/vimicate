export function nativeBuildIdentity(version: string | null | undefined, build: string | null | undefined) {
  return `Vimicate ${normalized(version)} build ${normalized(build)}`;
}

export function runtimeUpdateIdentity(updateId: string | null | undefined, embedded: boolean) {
  const identity = normalized(updateId);
  return embedded ? `Vimicate OTA embedded ${identity}` : `Vimicate OTA ${identity}`;
}

function normalized(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || 'unknown';
}
