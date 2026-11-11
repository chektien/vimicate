import { useCallback, useState } from 'react';
import { latestHistoryLoadingReporter, type LatestHistoryLoading } from './latestHistoryLoading';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';

/** Read-only request signal. Latest history keeps all request authority. */
export function useLatestLoading(authority: { current: HistoryPublicationAuthority | null }) {
  const [loading, setLoading] = useState<LatestHistoryLoading>(null);
  const clear = useCallback(() => setLoading(null), []);
  return { sessionKey: loading?.owns() ? loading.sessionKey : undefined, clear, report: latestHistoryLoadingReporter(setLoading, authority) };
}
