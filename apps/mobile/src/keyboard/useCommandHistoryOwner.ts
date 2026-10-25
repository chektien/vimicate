import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { guardedBackgroundTaskDetail, launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { appendCommandHistory, loadCommandHistory } from '../storage/workspaceStore';
import { CommandHistoryOwner } from './commandHistory';

export function useCommandHistoryOwner(setStatus: Dispatch<SetStateAction<string>>) {
  const owner = useRef(new CommandHistoryOwner(loadCommandHistory, appendCommandHistory)).current;
  useEffect(() => {
    let active = true;
    launchGuardedBackgroundTask(
      () => owner.hydrate(),
      (error) => { if (active) setStatus(guardedBackgroundTaskDetail(error, 'command history restore failed')); },
    );
    return () => { active = false; };
  }, [owner, setStatus]);
  return owner;
}
