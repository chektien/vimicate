import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** OpenClaw's imported-history merger enriches a canonical prompt with the
 * native CLI session/external ID, retaining its SQLite ID and submission key.
 * That explicit bridge can retire an older cached native copy before a final
 * answer exists. Text/time proximity alone is never a submission identity.
 * This is display-only: retain both source rows in history/cache so a partial
 * canonical refresh cannot erase the native slot before its answer. */
export function reconcileClaudePromptIdentities(messages: WorkspaceMessage[]) {
  const groups = new Map<string, WorkspaceMessage[]>();
  for (const row of messages) {
    const native = row.cliProvenance;
    if (row.role !== 'user' || row.source !== 'history' || !row.sessionKey
      || !row.transcriptSessionId || native?.kind !== 'claude-native') continue;
    const key = JSON.stringify([row.sessionKey, row.transcriptSessionId, native.sessionId, native.externalId]);
    const group = groups.get(key) ?? [];
    group.push(row); groups.set(key, group);
  }
  const owners = new Map<WorkspaceMessage, WorkspaceMessage>();
  for (const group of groups.values()) {
    // More than two claims is ambiguous, even if a third copy has bad content.
    if (group.length !== 2) continue;
    const alias = group.find(row => row.cliProvenance?.kind === 'claude-native'
      && row.id === row.cliProvenance.externalId && !row.displayPosition && !row.idempotencyKey);
    const canonical = group.find(row => row !== alias && row.displayPosition && row.idempotencyKey?.endsWith(':user'));
    if (!alias || !canonical || alias.text !== canonical.text
      || group.some(row => row.attachments?.length || row.recovery || row.state === 'streaming' || row.state === 'error')
      || alias.runId && canonical.runId && alias.runId !== canonical.runId) continue;
    owners.set(alias, canonical); owners.set(canonical, canonical);
  }
  if (!owners.size) return messages;
  const emitted = new Set<WorkspaceMessage>();
  return messages.flatMap(row => {
    const owner = owners.get(row);
    if (!owner) return [row];
    if (emitted.has(owner)) return [];
    emitted.add(owner);
    // Preserve the first already-published prompt slot; the canonical copy
    // owns metadata. Do not move it after native answers from the older page.
    return [owner];
  });
}
