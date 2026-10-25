import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OlderHistoryLoadResult } from '../gateway/historyPublicationReceipt';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

type Attempt = {
  datasetKey: string;
  beforeIDs: Set<string>;
  settled: boolean;
  result?: OlderHistoryLoadResult | undefined;
};

function olderHistoryLoadResult(value: unknown): OlderHistoryLoadResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<OlderHistoryLoadResult>;
  if (candidate.committed !== true || typeof candidate.published !== 'boolean' || !Number.isInteger(candidate.addedMessageCount)
    || (candidate.addedMessageCount ?? -1) < 0) return undefined;
  const visible = candidate.addedVisibleRowCount;
  return { committed: true, published: candidate.published, addedMessageCount: candidate.addedMessageCount!,
    ...(Number.isInteger(visible) && visible! >= 0 ? { addedVisibleRowCount: visible } : {}) };
}

type Presentation = {
  datasetKey: string;
  status: string;
  boundaryMessageIDs: string[];
};

export function useOlderHistoryRequestPresentation(options: {
  datasetKey: string;
  messages: readonly WorkspaceMessage[];
  canLoadOlder: boolean;
  loadingOlder: boolean;
  historyProblem?: string | undefined;
  onLoadOlder: () => unknown | Promise<unknown>;
}) {
  const attempt = useRef<Attempt | null>(null);
  const alive = useRef(true);
  const datasetKey = useRef(options.datasetKey);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [completionRevision, setCompletionRevision] = useState(0);
  const [presentation, setPresentation] = useState<Presentation>({
    datasetKey: options.datasetKey,
    status: '',
    boundaryMessageIDs: [],
  });

  useLayoutEffect(() => { datasetKey.current = options.datasetKey; });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      attempt.current = null;
      if (resultTimer.current) clearTimeout(resultTimer.current);
      resultTimer.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (presentation.datasetKey === options.datasetKey) return;
    attempt.current = null;
    if (resultTimer.current) clearTimeout(resultTimer.current);
    resultTimer.current = null;
    setPresentation({ datasetKey: options.datasetKey, status: '', boundaryMessageIDs: [] });
  }, [options.datasetKey, presentation.datasetKey]);

  useLayoutEffect(() => {
    const retained = new Set(options.messages.map(message => message.id));
    setPresentation(value => {
      if (value.datasetKey !== options.datasetKey) return value;
      const boundaries = value.boundaryMessageIDs.filter(id => retained.has(id));
      return boundaries.length === value.boundaryMessageIDs.length ? value : { ...value, boundaryMessageIDs: boundaries };
    });
  }, [options.datasetKey, options.messages]);

  useLayoutEffect(() => {
    const current = attempt.current;
    if (!current || current.datasetKey !== options.datasetKey) return;
    if (options.loadingOlder) {
      return;
    }
    if (options.historyProblem) {
      attempt.current = null;
      setPresentation(value => ({ ...value, status: '' }));
      return;
    }

    const retainedBoundary = options.messages.find(message => current.beforeIDs.has(message.id));
    const retainedIndex = retainedBoundary ? options.messages.indexOf(retainedBoundary) : -1;
    const added = retainedIndex < 0
      ? []
      : options.messages.slice(0, retainedIndex).filter(message => !current.beforeIDs.has(message.id));
    // Transport completion may precede the parent's React publication. Do not
    // turn that gap into a false "no older messages" result. A page that adds
    // data can be recognized from either the mounted rows or the publication
    // receipt. An exhausted cursor alone does not prove the page has committed.
    if (!added.length && !current.result?.published && !current.settled) return;

    attempt.current = null;
    const addedCount = current.result?.published
      ? current.result.addedMessageCount
      : added.length;
    const published = current.result?.published || added.length > 0;
    const status = published && addedCount > 0 && current.result?.addedVisibleRowCount === 0
      ? `${addedCount} older record${addedCount === 1 ? '' : 's'} loaded · no new visible rows`
      : addedCount
      ? `${addedCount} older message${addedCount === 1 ? '' : 's'} loaded`
      : published ? 'older history loaded'
      : options.canLoadOlder ? 'history checked · no older messages added' : 'oldest history reached';
    const retainedBoundaries = presentation.boundaryMessageIDs.filter(id => options.messages.some(message => message.id === id));
    const nextBoundary = published ? retainedBoundary?.id : undefined;
    const next = {
      datasetKey: options.datasetKey,
      status,
      boundaryMessageIDs: nextBoundary && !retainedBoundaries.includes(nextBoundary)
        ? [...retainedBoundaries, nextBoundary] : retainedBoundaries,
    };
    setPresentation(next);
    if (resultTimer.current) clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => {
      if (!alive.current) return;
      setPresentation(value => value.datasetKey === next.datasetKey && value.status === status
        ? { ...value, status: '' } : value);
      resultTimer.current = null;
    }, 4_000);
  }, [completionRevision, options.canLoadOlder, options.datasetKey, options.historyProblem, options.loadingOlder, options.messages, presentation.boundaryMessageIDs]);

  const request = useCallback(() => {
    if (!options.canLoadOlder || options.loadingOlder || attempt.current) return false;
    const owner: Attempt = {
      datasetKey: options.datasetKey,
      beforeIDs: new Set(options.messages.map(message => message.id)),
      settled: false,
    };
    attempt.current = owner;
    if (resultTimer.current) clearTimeout(resultTimer.current);
    resultTimer.current = null;
    setPresentation(value => ({ ...value, datasetKey: options.datasetKey, status: 'loading older history…' }));
    try {
      void Promise.resolve(options.onLoadOlder()).then(result => {
        if (result && typeof result === 'object' && 'publication' in result) return result.publication;
        return result;
      }).then((result) => {
        if (!alive.current || datasetKey.current !== owner.datasetKey || attempt.current !== owner) return;
        owner.result = olderHistoryLoadResult(result);
        owner.settled = true;
        setCompletionRevision(value => value + 1);
      }, () => {
        if (!alive.current || datasetKey.current !== owner.datasetKey || attempt.current !== owner) return;
        attempt.current = null;
        setPresentation(value => ({ ...value, status: 'older history failed' }));
      });
    } catch {
      attempt.current = null;
      setPresentation(value => ({ ...value, status: 'older history failed' }));
      return false;
    }
    return true;
  }, [options.canLoadOlder, options.datasetKey, options.loadingOlder, options.messages, options.onLoadOlder]);

  const owned = presentation.datasetKey === options.datasetKey
    ? presentation
    : { datasetKey: options.datasetKey, status: '', boundaryMessageIDs: [] };
  return {
    request,
    status: options.loadingOlder ? 'loading older history…' : owned.status,
    refreshing: options.loadingOlder || Boolean(attempt.current),
    boundaryMessageIDs: owned.boundaryMessageIDs,
  };
}
