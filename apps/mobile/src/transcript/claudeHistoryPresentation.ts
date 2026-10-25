import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { reconcileClaudePromptIdentities } from './claudePromptIdentity';

/** Claude's native transcript splits one CLI delivery around tool calls. A
 * provider switch exposes its SQLite aggregate instead. Keep the native steps
 * at the aggregate's canonical turn slot, without rewriting stored history or
 * inventing native rawSeq/run authority for those steps. */
export function projectClaudeHistoryDeliveries(messages: WorkspaceMessage[]) {
  messages = reconcileClaudePromptIdentities(messages);
  const matches: Array<{ aggregate: WorkspaceMessage; members: WorkspaceMessage[]; promptAliases: WorkspaceMessage[]; footers: WorkspaceMessage[] }> = [];
  for (const aggregate of messages) {
    const provenance = aggregate.cliProvenance;
    if (provenance?.kind !== 'claude-aggregate' || aggregate.role !== 'assistant'
      || aggregate.source !== 'history' || !aggregate.sessionKey || !aggregate.transcriptSessionId
      || !aggregate.displayPosition || aggregate.attachments?.length || aggregate.recovery
      || aggregate.idempotencyKey !== `cli-assistant:${provenance.runId}`
      || aggregate.state === 'streaming' || aggregate.state === 'error') continue;
    const scope = (row: WorkspaceMessage) => row.source === 'history'
      && row.sessionKey === aggregate.sessionKey && row.transcriptSessionId === aggregate.transcriptSessionId;
    const prompts = messages.filter(row => scope(row) && row.role === 'user'
      && row.idempotencyKey === `${provenance.runId}:user`
      && row.displayPosition?.source === aggregate.displayPosition!.source
      && row.displayPosition.rawSeq < aggregate.displayPosition!.rawSeq);
    if (prompts.length !== 1) continue;
    const prompt = prompts[0]!;
    const start = timestamp(prompt), end = timestamp(aggregate);
    if (start === null || end === null || end < start || end - start > 300_000) continue;
    if (messages.some(row => scope(row) && (row.role === 'user' || row.role === 'boundary') && row !== prompt
      && row.displayPosition?.source === aggregate.displayPosition!.source
      && row.displayPosition.rawSeq > prompt.displayPosition!.rawSeq
      && row.displayPosition.rawSeq < aggregate.displayPosition!.rawSeq)) continue;

    const groups = new Map<string, WorkspaceMessage[]>();
    for (const row of messages) {
      const native = row.cliProvenance;
      const time = timestamp(row);
      if (native?.kind !== 'claude-native' || !scope(row) || row.displayPosition
        || time === null || time < start || time > end) continue;
      const group = groups.get(native.sessionId) ?? [];
      group.push(row); groups.set(native.sessionId, group);
    }
    const candidates = [...groups.values()].flatMap(group => {
      const promptAliases = group.filter(row => nativePromptAlias(row, prompt, provenance.runId));
      if (promptAliases.length > 1) return [];
      const members = group.filter(row => row.role === 'assistant' || row.role === 'narration' || row.role === 'tool');
      if (members.length + promptAliases.length !== group.length) return [];
      if (members.some(row => row.attachments?.length
        || row.recovery || row.state === 'streaming' || row.state === 'error'
        || row.runId && row.runId !== provenance.runId
        || row.cliProvenance?.kind !== 'claude-native'
        || row.id !== row.cliProvenance.externalId && !row.id.startsWith(`${row.cliProvenance.externalId}#tool-`))) return [];
      members.sort((a, b) => timestamp(a)! - timestamp(b)!);
      const parts = members.filter(row => (row.role === 'assistant' || row.role === 'narration') && row.text.trim());
      if (parts.length < 2 || new Set(parts.map(row => row.cliProvenance?.kind === 'claude-native'
        ? row.cliProvenance.externalId : '')).size !== parts.length) return [];
      // Exact text is a consistency check *after* source, generation, native
      // identities and the aggregate's explicit run-bound prompt are proven.
      // No similarity, generic text-only or cross-turn deduplication.
      if (!['\n', '\n\n'].some(joiner => parts.map(row => row.text).join(joiner) === aggregate.text)) return [];
      return [{ members, promptAliases }];
    });
    if (candidates.length !== 1) continue;
    const footers = messages.filter(row => row.role === 'run' && row.sessionKey === aggregate.sessionKey
      && (!row.transcriptSessionId || row.transcriptSessionId === aggregate.transcriptSessionId)
      && row.state === 'complete' && (row.runId === provenance.runId || row.id === `history-run-${aggregate.id}`));
    matches.push({ aggregate, ...candidates[0]!, footers });
  }
  if (!matches.length) return messages;
  const uses = new Map<WorkspaceMessage, number>();
  for (const match of matches) for (const row of [...match.members, ...match.promptAliases]) uses.set(row, (uses.get(row) ?? 0) + 1);
  const accepted = matches.filter(match => [...match.members, ...match.promptAliases].every(row => uses.get(row) === 1));
  if (!accepted.length) return messages;
  const replacements = new Map(accepted.map(match => [match.aggregate, match]));
  const moved = new Set(accepted.flatMap(match => [...match.members, ...match.promptAliases, ...match.footers]));
  return messages.flatMap(row => {
    const match = replacements.get(row);
    if (match) {
      const footer = match.footers.find(candidate => candidate.id === `history-run-${row.id}`) ?? match.footers.at(-1);
      return [...match.members, ...(footer ? [footer] : [])];
    }
    return moved.has(row) ? [] : [row];
  });
}

function nativePromptAlias(row: WorkspaceMessage, prompt: WorkspaceMessage, runId: string) {
  const provenance = row.cliProvenance;
  return row.role === 'user' && provenance?.kind === 'claude-native'
    && row.id === provenance.externalId && row.text === prompt.text
    && !row.attachments?.length && !prompt.attachments?.length && !row.recovery
    && row.state !== 'streaming' && row.state !== 'error'
    && (!row.runId || row.runId === runId);
}

function timestamp(row: WorkspaceMessage) {
  if (!row.timestamp) return null;
  const value = Number(row.timestamp);
  if (Number.isFinite(value)) return value >= 0 ? value : null;
  const parsed = Date.parse(row.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}
