import { colonCommandInput } from '../prompt/colonCommandInput';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export type TranscriptDisplayOptions = { verbose: boolean; progress: boolean };

export function visibleTranscriptMessages(messages: WorkspaceMessage[], options: TranscriptDisplayOptions) {
  return messages.filter((message) => {
    if (!options.progress && message.source === 'live' && (message.role === 'run' || message.role === 'narration')) return false;
    if (!options.verbose && message.source === 'live' && ['openclaw', 'session', 'workspace', 'config'].includes(message.role)) return false;
    return true;
  });
}

export function transcriptOptionCommand(input: string, options: TranscriptDisplayOptions): { options?: TranscriptDisplayOptions; message?: string } {
  const [name = '', argument = ''] = colonCommandInput(input)?.toLocaleLowerCase().split(/\s+/) ?? [];
  if (name !== ':verbose' && name !== ':progress') return {};
  const property = name === ':verbose' ? 'verbose' : 'progress';
  const current = options[property];
  const target = !argument || argument === 'toggle' ? !current
    : ['on', 'true', 'yes', '1'].includes(argument) ? true
      : ['off', 'false', 'no', '0'].includes(argument) ? false : undefined;
  if (target === undefined) return { message: `${name} on|off — currently ${current ? 'on' : 'off'}.` };
  return { options: { ...options, [property]: target }, message: `${name} ${target ? 'on' : 'off'}.` };
}
