export type PersistedWorkspaceSelection = {
  sessionKey: string;
  projectID: string;
};

const EMPTY_SELECTION: PersistedWorkspaceSelection = { sessionKey: '', projectID: '' };
const MAX_PERSISTED_SELECTION_BYTES = 4_096;
const MAX_IDENTITY_LENGTH = 1_024;

export function serializedPersistedWorkspaceSelection(sessionKey: string, projectID: string) {
  return JSON.stringify({ sessionKey, projectID });
}

export function parsedPersistedWorkspaceSelection(raw: string | null): PersistedWorkspaceSelection {
  const value = raw?.trim() ?? '';
  if (!value || value.length > MAX_PERSISTED_SELECTION_BYTES) return EMPTY_SELECTION;
  if (!value.startsWith('{')) return { sessionKey: boundedIdentity(value), projectID: '' };
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    const sessionKey = boundedIdentity(record.sessionKey);
    if (!sessionKey) return EMPTY_SELECTION;
    return { sessionKey, projectID: boundedIdentity(record.projectID) };
  } catch {
    return EMPTY_SELECTION;
  }
}

function boundedIdentity(value: unknown) {
  return typeof value === 'string' && value.length <= MAX_IDENTITY_LENGTH ? value.trim() : '';
}
