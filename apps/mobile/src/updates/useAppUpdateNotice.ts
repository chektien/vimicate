import { useCallback, useMemo, useRef, useState } from 'react';
import * as Updates from 'expo-updates';
import { appUpdateNoticePresentation } from './appUpdateNoticePresentation';
import { updateReleaseNotesFromManifest } from './updateReleaseNotes';

export function useAppUpdateNotice(restartHold: 'submission' | 'attachments' | null, persistDraft: () => Promise<void>) {
  const updates = Updates.useUpdates();
  const checking = useRef<Promise<string> | null>(null);
  const downloadedReleaseNotes = useMemo(() => {
    if (updates.downloadedUpdate?.type !== Updates.UpdateInfoType.NEW) return null;
    return updateReleaseNotesFromManifest(updates.downloadedUpdate.manifest);
  }, [updates.downloadedUpdate]);
  const appliedReleaseNotes = useMemo(
    () => updateReleaseNotesFromManifest(updates.currentlyRunning.manifest),
    [updates.currentlyRunning.manifest],
  );
  const [requestedKey, setRequestedKey] = useState('');
  const [expandedKey, setExpandedKey] = useState('');
  const [dismissedKey, setDismissedKey] = useState('');
  const updateKey = updates.isUpdatePending
    ? updates.downloadedUpdate?.updateId ?? 'pending-update'
    : updates.currentlyRunning.updateId ?? 'installed-update';
  const applied = !updates.isUpdatePending && appliedReleaseNotes !== null
    && (updates.restartCount > 0 || requestedKey === updateKey);
  const releaseNotes = updates.isUpdatePending ? downloadedReleaseNotes : appliedReleaseNotes;
  const [restartFailed, setRestartFailed] = useState(false);
  const presentation = useMemo(() => appUpdateNoticePresentation({
    pending: updates.isUpdatePending,
    applied,
    dismissed: Boolean(updateKey) && dismissedKey === updateKey,
    restartHold,
    restarting: updates.isRestarting,
    restartFailed,
    releaseTitle: releaseNotes?.title,
    fixes: releaseNotes?.fixes,
    updateLabel: (updates.isUpdatePending ? updates.downloadedUpdate?.updateId : updates.currentlyRunning.updateId)?.slice(0, 8),
  }), [applied, dismissedKey, releaseNotes, restartHold, restartFailed, updateKey, updates.currentlyRunning.updateId, updates.downloadedUpdate?.updateId, updates.isRestarting, updates.isUpdatePending]);

  const dismiss = useCallback(() => {
    setDismissedKey(updateKey);
    setExpandedKey('');
  }, [updateKey]);

  const showNotes = useCallback(() => {
    if (!releaseNotes) return 'update notes unavailable for this build';
    setRequestedKey(updateKey);
    setDismissedKey('');
    setExpandedKey(updateKey);
    return 'update notes opened';
  }, [releaseNotes, updateKey]);
  const toggleNotes = useCallback(() => {
    setExpandedKey((current) => current === updateKey ? '' : updateKey);
  }, [updateKey]);

  // Expo publishes isRestarting asynchronously; claim the restart at once so a
  // second tap cannot start a second draft write and reload.
  const restarting = useRef(false);
  const restart = useCallback(async () => {
    if (!updates.isUpdatePending || restartHold || updates.isRestarting || restarting.current) return;
    restarting.current = true;
    setRestartFailed(false);
    try {
      await persistDraft();
      await Updates.reloadAsync();
    } catch {
      restarting.current = false;
      setRestartFailed(true);
    }
  }, [persistDraft, restartHold, updates.isRestarting, updates.isUpdatePending]);

  const check = useCallback(() => {
    if (checking.current) return checking.current;
    const task = (async () => {
      if (updates.isUpdatePending) return 'update already downloaded';
      if (!Updates.isEnabled) return 'update check unavailable in this build';
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return 'app is current';
        await Updates.fetchUpdateAsync();
        return 'update downloaded';
      } catch {
        return 'update check failed';
      }
    })();
    checking.current = task;
    void task.finally(() => { if (checking.current === task) checking.current = null; });
    return task;
  }, [updates.isUpdatePending]);

  return { presentation, expanded: expandedKey === updateKey, toggleNotes, showNotes, dismiss, restart, check };
}

export type AppUpdateNoticeController = ReturnType<typeof useAppUpdateNotice>;
