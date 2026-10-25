const RUN_SAFE_COMMANDS = new Set([
  'status', 'commands', 'context', 'diagnostics', 'healthcheck', 'approvals', 'approve', 'deny',
  'reload-projects', 'reconnect', 'repair', 'stop', 'interrupt', 'new-thread', 'close-thread',
  // OpenClaw option/status commands are deliberately usable as steering
  // controls while a turn is active.
  'think', 'models', 'model', 'fast',
]);

const DISCONNECTED_SAFE_COMMANDS = new Set(['diagnostics', 'reconnect', 'repair']);

export function gatewayCommandIsRunSafe(commandName: string) {
  return RUN_SAFE_COMMANDS.has(commandName.trim().replace(/^:/, '').toLocaleLowerCase());
}

export function gatewayCommandRunsDisconnected(commandName: string) {
  return DISCONNECTED_SAFE_COMMANDS.has(commandName.trim().replace(/^:/, '').toLocaleLowerCase());
}

export function shouldRefreshHistoryAfterCommand(runActive: boolean) {
  return !runActive;
}
