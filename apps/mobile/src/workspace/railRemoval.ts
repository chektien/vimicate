import { Alert } from 'react-native';
import { guardedBackgroundTaskDetail, launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import type { WorkspaceProject } from './workspaceTypes';

type RailRemovalTarget = Pick<WorkspaceProject, 'kind' | 'name'>;

/** `dd` on the rail closes a child thread or removes a top-level project from
 * the registry. Neither deletes folders. Projects ask first because the card
 * only returns when its projects.md entry is added back. */
export function railRemovalCommand(target: RailRemovalTarget) {
  return target.kind === 'thread' ? ':close-thread' : ':remove-project';
}

export function railRemovalStatus(target: RailRemovalTarget, accepted: boolean | undefined) {
  const noun = target.kind === 'thread' ? 'thread' : 'project';
  return accepted === undefined ? `removing ${noun} ${target.name}…` : accepted ? '' : `could not remove ${noun} ${target.name}; see the status line`;
}

export function confirmRailRemoval(target: RailRemovalTarget, remove: () => void, alert = Alert.alert) {
  if (target.kind === 'thread') { remove(); return; }
  alert(`Remove ${target.name}?`, 'This removes the project from Vimicate. Its folder and conversation history are kept.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: remove },
  ]);
}

type RailSubmit = (body: string, attachments: [], sessionKey: string) => Promise<boolean>;

export function removeFromRail(projects: readonly WorkspaceProject[], key: string, submit: RailSubmit, setStatus: (status: string) => void) {
  const target = projects.find((project) => project.sessionKey === key);
  if (!target) return;
  confirmRailRemoval(target, () => launchGuardedBackgroundTask(async () => {
    setStatus(railRemovalStatus(target, undefined));
    setStatus(railRemovalStatus(target, await submit(railRemovalCommand(target), [], key)));
  }, (error) => setStatus(guardedBackgroundTaskDetail(error, railRemovalStatus(target, false)))));
}
