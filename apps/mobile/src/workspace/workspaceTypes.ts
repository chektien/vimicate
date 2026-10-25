import type { QuestionRecord } from '../questions/questionTypes';
import type { TranscriptMessageMetadata } from './transcriptMetadata';
import { sessionActivityTimestamp } from './sessionActivityTimestamp';
import { isHiddenWorkspaceSession } from './workspaceSessionVisibility';
import { arrayAt, stringAt, numberAt, isRecord } from './workspacePayloadFields';
export { semanticWorkspaceRole, workspaceRole } from './workspaceRole';
export type WorkspaceRunPhase = 'submitting' | 'accepted' | 'running' | 'waiting' | 'completed' | 'failed' | 'uncertain';
export type WorkspaceProject = {
  id: string;
  sessionKey: string;
  name: string;
  path: string;
  branch: string;
  starred: boolean;
  threadCount: number;
  state: 'idle' | 'running' | 'error';
  runPhase?: WorkspaceRunPhase;
  group?: string;
  updatedAt?: number;
  kind?: 'project' | 'thread';
  parentSessionKey?: string;
  rootSessionKey?: string;
  projectName?: string;
  unread?: boolean;
  markedUnreadAt?: number;
  modelProvider?: string;
  model?: string;
  agentRuntime?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
  totalTokens?: number;
  contextTokens?: number;
  estimatedCostUsd?: number;
  sessionId?: string;
  sessionStartedAtMs?: number;
  /** Explicit current label supplied by the Gateway session census. */
  backendLabel?: string;
};

export type WorkspaceMessageRole = 'user' | 'assistant' | 'narration' | 'tool' | 'run' | 'approval' | 'media' | 'error' | 'openclaw' | 'session' | 'workspace' | 'command' | 'boundary' | 'config' | 'system' | 'vimicate' | 'operator';
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';
export type WorkspaceAttachment = { artifactId?: string; artifactSessionKey?: string; id: string; filename: string; mimeType: string; byteCount?: number; pixelWidth?: number; pixelHeight?: number; uri?: string; headers?: Record<string, string> };

export type WorkspaceMessage = TranscriptMessageMetadata & {
  id: string;
  role: WorkspaceMessageRole;
  text: string;
  timestamp?: string;
  state?: 'streaming' | 'complete' | 'error';
  runId?: string;
  sessionKey?: string;
  source?: 'history' | 'local' | 'live';
  /** Ephemeral original Gateway chat envelope before item-preamble convergence. */
  chatCumulativeText?: string;
  /** Ephemeral exact terminal reply from the run lifecycle, not chat's aggregate. */
  terminalReplyText?: string;
  /** One proven terminal live identity absorbed by this canonical assistant. */
  absorbedLiveIdentity?: { messageId: string; runId: string };
  toolGroup?: { count: number; lastMessageId: string }; // Ephemeral display header, never canonical.
  tool?: { name: string; summary: string; durationMs?: number };
  attachments?: WorkspaceAttachment[];
  question?: QuestionRecord;
  approval?: { id: string; kind: 'exec' | 'plugin'; allowedDecisions: ApprovalDecision[]; resolved: boolean; expiresAtMs?: number; outcome?: 'allowed' | 'denied' | 'expired' | 'resolved-externally' };
  recovery?: { sourceMessageId: string; state: 'available' | 'loading' | 'failed' | 'unavailable' | 'recovered'; detail?: string };
};

const offlineNames = ['vimicate', 'agenttools', 'ai-phd-supervisor', 'smartagents-framework', 'nvim-pde', 'sit', 'notes', 'dotfiles'];
export const offlineProjects: WorkspaceProject[] = offlineNames.map((name, index) => ({
  id: `offline-${name}`,
  sessionKey: `agent:main:${name}`,
  name,
  path: `~/repos/${name}`,
  branch: index === 0 ? 'main' : '—',
  starred: index === 0,
  threadCount: index === 0 ? 3 : 1,
  state: 'idle',
}));

export const startupMessages: WorkspaceMessage[] = [
  { id: 'startup-1', role: 'system', text: 'MVP terminal chat ready. Type in prompt, use Normal to leave insert mode, and Send to submit.' },
  { id: 'startup-2', role: 'system', text: 'Pair with an OpenClaw setup code first. Manual token entry is an advanced dev fallback.' },
];

export function projectsFromPayload(payload: Record<string, unknown>): WorkspaceProject[] {
  return projectThreadProjection(sessionEntriesFromPayload(payload));
}

export function sessionEntriesFromPayload(payload: Record<string, unknown>): WorkspaceProject[] {
  const rows = arrayAt(payload, ['sessions', 'items', 'results']);
  const defaults = isRecord(payload.defaults) ? payload.defaults : {};
  const defaultRuntime = isRecord(defaults.agentRuntime) ? defaults.agentRuntime : {};
  const seen = new Set<string>();
  const entries = rows.flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const sessionKey = stringAt(raw, ['sessionKey', 'key', 'id']);
    if (!sessionKey || seen.has(sessionKey) || raw.archived === true) return [];
    seen.add(sessionKey);
    const explicitLabel = stringAt(raw, ['label']);
    const suppliedLabel = explicitLabel || stringAt(raw, ['displayName', 'name']);
    const label = vimicateRootLabel(sessionKey) || suppliedLabel || sessionKey.split(':').at(-1) || `session-${index + 1}`;
    if (isHiddenWorkspaceSession(sessionKey, label)) return [];
    const metadata = isRecord(raw.metadata) ? raw.metadata : {};
    const path = stringAt(raw, ['cwd', 'path', 'spawnedCwd', 'spawnedWorkspaceDir']) || stringAt(metadata, ['cwd', 'repoPath']) || inferredProjectPath(sessionKey, label);
    const stateValue = stringAt(raw, ['state', 'status']);
    const group = stringAt(raw, ['group', 'groupTitle']) || stringAt(metadata, ['group', 'groupTitle']);
    const updatedAt = sessionActivityTimestamp(raw);
    const parentSessionKey = stringAt(raw, ['parentSessionKey']) || stringAt(metadata, ['parentSessionKey']);
    const runtime = isRecord(raw.agentRuntime) ? raw.agentRuntime : defaultRuntime;
    const modelProvider = stringAt(raw, ['modelProvider']) || stringAt(defaults, ['modelProvider']);
    const model = stringAt(raw, ['model']) || stringAt(defaults, ['model']);
    const agentRuntime = stringAt(runtime, ['id']);
    const thinkingLevel = stringAt(raw, ['thinkingLevel']) || stringAt(defaults, ['thinkingDefault']);
    const totalTokens = numberAt(raw, ['totalTokens']);
    const contextTokens = numberAt(raw, ['contextTokens']) || numberAt(defaults, ['contextTokens']);
    const estimatedCostUsd = numberAt(raw, ['estimatedCostUsd']);
    const sessionId = stringAt(raw, ['sessionId']);
    const sessionStartedAtMs = numberAt(raw, ['sessionStartedAt', 'sessionStartedAtMs']);
    return [{
      id: sessionKey,
      sessionKey,
      name: label,
      path,
      branch: stringAt(raw, ['branch']) || stringAt(metadata, ['branch']) || '—',
      starred: Boolean(raw.starred ?? raw.pinned ?? metadata.starred),
      threadCount: numberAt(raw, ['threadCount', 'childrenCount']) || 1,
      state: raw.hasActiveRun === true || stateValue.includes('run') || stateValue.includes('stream') || stateValue.includes('queue') ? 'running' : stateValue.includes('error') || stateValue.includes('fail') ? 'error' : 'idle',
      ...(group ? { group } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(parentSessionKey ? { parentSessionKey } : {}),
      ...(raw.unread === true ? { unread: true } : {}),
      ...(typeof raw.markedUnreadAt === 'number' && Number.isFinite(raw.markedUnreadAt) && raw.markedUnreadAt >= 0 ? { markedUnreadAt: raw.markedUnreadAt } : {}),
      ...(modelProvider ? { modelProvider } : {}),
      ...(model ? { model } : {}),
      ...(agentRuntime ? { agentRuntime } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(typeof raw.effectiveFastMode === 'boolean' ? { fastMode: raw.effectiveFastMode } : {}),
      ...(totalTokens ? { totalTokens } : {}),
      ...(contextTokens ? { contextTokens } : {}),
      ...(estimatedCostUsd ? { estimatedCostUsd } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(sessionStartedAtMs ? { sessionStartedAtMs } : {}),
      ...(explicitLabel ? { backendLabel: explicitLabel } : {}),
    } satisfies WorkspaceProject];
  });
  return entries;
}

function projectThreadProjection(entries: WorkspaceProject[]) {
  const roots = entries.filter((entry) => isVimicateProjectRoot(entry.sessionKey));
  if (!roots.length) return entries;
  const byKey = new Map(entries.map((entry) => [entry.sessionKey, entry]));
  const rootKeys = new Set(roots.map((root) => root.sessionKey));
  const rootFor = (entry: WorkspaceProject) => {
    const explicitThreadRoot = entry.sessionKey.match(/^(agent:[^:]+:direct:vimicate-ios(?::project:[^:]+)?):thread:/)?.[1];
    if (explicitThreadRoot && rootKeys.has(explicitThreadRoot)) return explicitThreadRoot;
    let parent = entry.parentSessionKey;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      if (rootKeys.has(parent)) return parent;
      visited.add(parent);
      parent = byKey.get(parent)?.parentSessionKey;
    }
    return '';
  };
  return roots.flatMap((root) => {
    const threads = entries.filter((entry) => entry.sessionKey !== root.sessionKey && !entry.sessionKey.includes(':subagent:') && rootFor(entry) === root.sessionKey)
      .map((thread) => ({ ...thread, kind: 'thread' as const, rootSessionKey: root.sessionKey, projectName: root.name, parentSessionKey: thread.parentSessionKey || root.sessionKey, threadCount: 0, path: root.path, ...(root.group ? { group: root.group } : {}) }));
    return [{ ...root, kind: 'project' as const, rootSessionKey: root.sessionKey, threadCount: threads.length + 1 }, ...threads];
  });
}

function isVimicateProjectRoot(sessionKey: string) {
  return sessionKey === 'agent:main:direct:vimicate-ios' || /^agent:[^:]+:direct:vimicate-ios:project:[^:]+$/.test(sessionKey);
}

function vimicateRootLabel(sessionKey: string) {
  if (sessionKey === 'agent:main:direct:vimicate-ios') return 'vimicate';
  return sessionKey.match(/^agent:[^:]+:direct:vimicate-ios:project:([^:]+)$/)?.[1] ?? '';
}

function inferredProjectPath(sessionKey: string, label: string) {
  if (sessionKey === 'agent:main:direct:vimicate-ios') return '~/repos/vimicate';
  const slug = sessionKey.match(/:direct:vimicate-ios:project:([^:]+)/)?.[1];
  return `~/repos/${slug || label}`;
}
