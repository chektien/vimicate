export type UpdateReleaseNotes = {
  title: string;
  fixes: string[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function releaseNotesCandidate(manifest: unknown): unknown {
  const root = asRecord(manifest);
  const extra = asRecord(root?.extra);
  const expoClient = asRecord(extra?.expoClient);
  const expoClientExtra = asRecord(expoClient?.extra);
  const embeddedExpoConfig = asRecord(root?.expoClient);
  const embeddedExtra = asRecord(embeddedExpoConfig?.extra);
  return extra?.vimicateUpdate
    ?? expoClientExtra?.vimicateUpdate
    ?? embeddedExtra?.vimicateUpdate;
}

export function updateReleaseNotesFromManifest(manifest: unknown): UpdateReleaseNotes | null {
  const candidate = asRecord(releaseNotesCandidate(manifest));
  if (!candidate) return null;

  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  const fixes = Array.isArray(candidate.fixes)
    ? candidate.fixes
        .filter((fix): fix is string => typeof fix === 'string')
        .map((fix) => fix.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];

  if (!title && fixes.length === 0) return null;
  return {
    title: title || 'Vimicate update',
    fixes,
  };
}
