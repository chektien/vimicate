export type ThreadSortMode = 'manual' | 'activity';

export function threadSortCommand(argumentsInput: string, current: ThreadSortMode): { mode?: ThreadSortMode; message: string } {
  const argument = argumentsInput.trim().toLocaleLowerCase();
  const mode = argument === '' || argument === 'toggle'
    ? current === 'manual' ? 'activity' : 'manual'
    : ['activity', 'latest', 'latest-activity'].includes(argument) ? 'activity'
      : ['manual', 'registry'].includes(argument) ? 'manual' : undefined;
  return mode
    ? { mode, message: `:thread-sort — ${mode === 'activity' ? 'latest activity' : 'manual grouped'} order.` }
    : { message: ':thread-sort expects activity, manual, or toggle.' };
}
