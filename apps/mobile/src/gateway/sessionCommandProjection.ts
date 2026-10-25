import { sessionStatusSupplement } from './sessionStatusTruth';

export function sessionStatusText(payload: Record<string, unknown>, fallbackKey: string) {
  const session = record(payload.session); const runtime = record(session.agentRuntime);
  const label = text(session.label) || text(session.displayName) || fallbackKey;
  const tokens = number(session.totalTokens); const context = number(session.contextTokens); const cost = number(session.estimatedCostUsd);
  return [
    `:status — ${label}`,
    `session ${text(session.key) || fallbackKey}`,
    `state ${text(session.status) || 'idle'}  model ${[text(session.modelProvider), text(session.model)].filter(Boolean).join('/') || 'default'}  runtime ${text(runtime.id) || 'default'}`,
    `thinking ${text(session.thinkingLevel) || text(session.thinkingDefault) || 'default'}  fast ${session.effectiveFastMode === true ? 'on' : 'off'}`,
    `tokens ${tokens || 0}${context ? ` / ${context}` : ''}${cost ? `  cost $${cost.toFixed(4)}` : ''}`,
    ...sessionStatusSupplement(payload),
  ].join('\n');
}

export function commandListText(commands: { name: string; description: string }[]) {
  return commands.length ? commands.map((command) => `:${command.name}${command.description ? `  ${command.description}` : ''}`).join('\n') : 'No OpenClaw commands are currently advertised.';
}

export function workspaceContextText(project: { name: string; id: string; path: string; group?: string; sessionKey: string; sessionId?: string; parentSessionKey?: string; modelProvider?: string; model?: string }, gatewayStatus: string, activeRun: boolean, commandCount: number) {
  return [
    ':context',
    `workspace=${project.name} id=${project.id} group=${project.group || 'none'}`,
    `repo=${project.path || 'unknown'}`,
    `session=${project.sessionKey}`,
    `currentSessionID=${project.sessionId || 'unknown'} parentSessionKey=${project.parentSessionKey || 'none'}`,
    `gateway=${gatewayStatus} run=${activeRun ? 'active' : 'idle'}`,
    `model=${[project.modelProvider, project.model].filter(Boolean).join('/') || 'default'}`,
    `commands=${commandCount}`,
  ].join('\n');
}

export function healthcheckText(payload: Record<string, unknown>) {
  const status = text(payload.status) || text(payload.state) || (payload.ok === true ? 'ok' : 'unknown');
  const version = text(payload.version) || text(record(payload.gateway).version);
  return `:healthcheck — ${status}${version ? `\ngateway version ${version}` : ''}`;
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
