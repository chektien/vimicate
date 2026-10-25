import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { saveTranscriptCache } from '../storage/workspaceStore';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { DeferredPromptRefusals } from './deferredPromptRefusals';

/** The history owner's bounded write debounce. Suspension discards scheduled
 * publications; exact refused rows are filtered again at the storage boundary. */
export function useTranscriptPersistence(authority: MutableRefObject<HistoryPublicationAuthority | null>, refusals: MutableRefObject<DeferredPromptRefusals>) {
  const pendingPersistentWrites = useRef(new Map<string, WorkspaceMessage[]>());
  const persistentWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    const pending = [...pendingPersistentWrites.current.entries()]; pendingPersistentWrites.current.clear();
    persistentWriteTimer.current = null;
    for (const [sessionKey, rows] of pending) void saveTranscriptCache(sessionKey, refusals.current.filter(sessionKey, rows)).catch(() => undefined);
  }, [refusals]);
  const persistLater = useCallback((sessionKey: string, rows: WorkspaceMessage[]) => {
    if (!sessionKey || !authority.current?.isActive) return;
    rows = refusals.current.filter(sessionKey, rows);
    pendingPersistentWrites.current.set(sessionKey, rows);
    if (!persistentWriteTimer.current) persistentWriteTimer.current = setTimeout(flush, 500);
  }, [authority, refusals, flush]);
  const suspendPersistence = useCallback(() => {
    if (persistentWriteTimer.current) clearTimeout(persistentWriteTimer.current);
    persistentWriteTimer.current = null;
    pendingPersistentWrites.current.clear();
  }, []);
  useEffect(() => () => {
    if (persistentWriteTimer.current) clearTimeout(persistentWriteTimer.current);
    flush();
  }, [flush]);
  return { persistLater, suspendPersistence };
}
