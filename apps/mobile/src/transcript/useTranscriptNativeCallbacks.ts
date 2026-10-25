import { useInsertionEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { FlashListProps } from '@shopify/flash-list';

type NativeCallbacks<T> = {
  onScroll: NonNullable<FlashListProps<T>['onScroll']>;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: NonNullable<FlashListProps<T>['onScrollEndDrag']>;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
  onContentSizeChange: NonNullable<FlashListProps<T>['onContentSizeChange']>;
  onLayout: NonNullable<FlashListProps<T>['onLayout']>;
  onViewableItemsChanged: NonNullable<FlashListProps<T>['onViewableItemsChanged']>;
};

/** Bind native events to the keyed list mount, not the selected dataset ref. */
export function useTranscriptNativeCallbacks<T>(datasetKey: string, callbacks: NativeCallbacks<T>): NativeCallbacks<T> {
  const current = useRef(callbacks);
  useInsertionEffect(() => { current.current = callbacks; });
  // A child's layout effect can publish initial content before the parent's
  // layout effect runs. Admit that first commit; cleanup retires the outgoing
  // mount before the replacement's layout effects. A→B→A gets a new lifetime.
  const lifetime = useMemo(() => ({ active: true }), [datasetKey]);
  useLayoutEffect(() => {
    lifetime.active = true;
    return () => { lifetime.active = false; };
  }, [lifetime]);
  return useMemo(() => {
    const bind = <K extends keyof NativeCallbacks<T>>(key: K): NativeCallbacks<T>[K] =>
      ((...args: Parameters<NativeCallbacks<T>[K]>) => {
        if (!lifetime.active) return;
        const callback = current.current[key] as (...values: Parameters<NativeCallbacks<T>[K]>) => void;
        callback(...args);
      }) as NativeCallbacks<T>[K];
    return {
      onScroll: bind('onScroll'), onScrollBeginDrag: bind('onScrollBeginDrag'),
      onScrollEndDrag: bind('onScrollEndDrag'), onMomentumScrollBegin: bind('onMomentumScrollBegin'),
      onMomentumScrollEnd: bind('onMomentumScrollEnd'), onContentSizeChange: bind('onContentSizeChange'),
      onLayout: bind('onLayout'), onViewableItemsChanged: bind('onViewableItemsChanged'),
    };
  }, [lifetime]);
}
