import type { ModelChoice } from '../gateway/modelMatching';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { cycleCommandCompletion, selectCommandCompletion } from '../gateway/commandCompletion';
import type { GatewayCommand } from '../gateway/gatewayCommands';
import type { CommandSession, SearchSession } from '../ui/WorkspaceCommandBar';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from './hardwareKey';
import { recallCommand } from './commandHistory';
import { appendCommandLinePaste, handleCommandLineKey, type CommandLineAction } from './commandLine';

type MutableValue<T> = Pick<MutableRefObject<T>, 'current'>;

export function workspaceCommandLineActions({ commandRef, searchRef, setCommand, setSearch, commands, modelChoices, historyRef }: {
  commandRef: MutableValue<CommandSession | null>;
  searchRef: MutableValue<SearchSession | null>;
  setCommand: Dispatch<SetStateAction<CommandSession | null>>;
  setSearch: Dispatch<SetStateAction<SearchSession | null>>;
  commands: GatewayCommand[];
  modelChoices: ModelChoice[];
  historyRef?: MutableValue<string[]>;
}) {
  const actions = {
    handleKey(event: HardwareKeyEvent): CommandLineAction {
      const command = commandRef.current;
      if (!command) return 'none';
      if (!event.control && !event.command && !event.option) {
        if (normalizedHardwareKey(event) === 'tab') { actions.complete(event.shift); return 'none'; }
        if (!event.shift && ['up', 'down'].includes(event.key)) { actions.recall(event.key === 'up' ? -1 : 1); return 'none'; }
      }
      const result = handleCommandLineKey(command, event);
      if (result.action === 'none' && result.state.query !== command.query) actions.updateQuery(result.state.query);
      return result.action;
    },
    paste(text: string) {
      const command = commandRef.current;
      if (command) { setCommand({ ...appendCommandLinePaste(command, text), history: undefined, cursor: undefined, completion: undefined, completionNotice: undefined }); return; }
      const search = searchRef.current;
      if (search) setSearch(appendCommandLinePaste(search, text));
    },
    updateQuery(query: string, eventCount?: number) {
      const command = commandRef.current;
      if (command) {
        if (eventCount !== undefined && eventCount < (command.nativeEventCount ?? 0)) return;
        setCommand({ ...command, query, nativeEventCount: eventCount ?? command.nativeEventCount ?? 0, history: undefined, cursor: undefined, completion: undefined, completionNotice: undefined }); return;
      }
      const search = searchRef.current;
      if (search && (eventCount === undefined || eventCount >= (search.nativeEventCount ?? 0))) {
        setSearch({ ...search, query, nativeEventCount: eventCount ?? search.nativeEventCount ?? 0 });
      }
    },
    recall(direction: -1 | 1) {
      const command = commandRef.current;
      if (command) setCommand(recallCommand(historyRef?.current ?? [], command, direction));
    },
    cancel() { setCommand(null); setSearch(null); },
    selectCompletion(value: string, offered: CommandSession) {
      const command = commandRef.current;
      // A touch started on an older render must not overwrite subsequent typing.
      if (!command || command !== offered) return;
      const selected = selectCommandCompletion(commands, command, value, { models: modelChoices });
      if (selected !== command) setCommand({ ...selected, history: undefined });
    },
    complete(reverse: boolean) {
      const command = commandRef.current;
      if (command) setCommand({ ...cycleCommandCompletion(commands, command, reverse, { models: modelChoices }), history: undefined });
    },
  };
  return actions;
}
