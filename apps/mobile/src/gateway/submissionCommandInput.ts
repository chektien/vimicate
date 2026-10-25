import { colonCommandInput } from '../prompt/colonCommandInput';
import { modelCommandIntent } from './modelCommandProjection';

const LOCAL_COMMANDS = new Set([':new', ':status', ':commands', ':context', ':diagnostics', ':healthcheck', ':approvals', ':approve', ':deny', ':reload-projects', ':reconnect', ':repair', ':stop', ':new-thread', ':close-thread']);

/** Keeps explicit replacement commands distinct from local queued interruption. */
export function submissionCommandInput(body: string, isDelivery: boolean) {
  const commandText = colonCommandInput(body);
  const [commandToken = '', ...argumentParts] = commandText?.split(/\s+/) ?? [];
  const typedCommand = commandToken.toLocaleLowerCase();
  const interrupt = !isDelivery && typedCommand === ':interrupt';
  const commandArguments = interrupt ? commandText!.slice(commandToken.length).trimStart() : argumentParts.join(' ');
  const modelIntent = modelCommandIntent(typedCommand, commandArguments);
  return { commandText, commandToken, typedCommand, interrupt, commandArguments, modelIntent,
    locallyHandled: LOCAL_COMMANDS.has(typedCommand) || Boolean(modelIntent) };
}
