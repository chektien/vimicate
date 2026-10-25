import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { RunLifecycleSignal } from './runLifecycleProjection';

export function delegatedFailureQualification(signal: RunLifecycleSignal, messages: WorkspaceMessage[]) {
  if (signal.phase !== 'failed') return null;
  const owned = messages.filter((message) => message.sessionKey === signal.sessionKey && (!signal.runId || !message.runId || message.runId === signal.runId));
  const evidence = owned.map((message) => `${message.tool?.summary ?? ''}\n${message.text}`).join('\n');
  const delegated = /(?:ccwork(?:\.sh)?\s+(?:run|poll|tail)|\bsubagent\b|delegat(?:e|ed|ion)|remote_alive)/i.test(evidence);
  const ongoing = /(?:remote_alive["':\s]+true|["']?status["']?\s*[:=]\s*["']?running|process running with session id|\s--bg(?:\s|$))/i.test(evidence);
  const terminal = /(?:remote_alive["':\s]+false|["']?status["']?\s*[:=]\s*["']?(?:complete|completed|failed|error|dead))/i.test(evidence);
  return delegated && ongoing && !terminal
    ? { signal: { ...signal, phase: 'uncertain' as const }, detail: 'parent monitor interrupted · delegated work may continue' }
    : null;
}
