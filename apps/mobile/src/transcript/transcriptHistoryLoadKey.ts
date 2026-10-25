import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';

export function requestsOlderTranscriptAtReviewTop(
  event: HardwareKeyEvent,
  cursorSourceRow: number,
  navigationSourceRows: readonly number[],
  cleanNormalState: boolean,
) {
  return requestsOlderTranscriptAtVisibleTop(
    event,
    cursorProjectsToOldestVisibleStop(cursorSourceRow, navigationSourceRows),
    cleanNormalState,
  );
}

export function requestsOlderTranscriptAtVisibleTop(
  event: HardwareKeyEvent,
  atOldestVisibleStop: boolean,
  cleanNormalState: boolean,
) {
  if (!cleanNormalState || event.isRepeat || event.control || event.command || event.option) return false;
  if (!atOldestVisibleStop) return false;
  return normalizedHardwareKey(event) === 'k';
}

export function cursorProjectsToOldestVisibleStop(cursorSourceRow: number, navigationSourceRows: readonly number[]) {
  if (!navigationSourceRows.length) return false;
  const exact = navigationSourceRows.indexOf(cursorSourceRow);
  if (exact >= 0) return exact === 0;
  const following = navigationSourceRows.findIndex((row) => row > cursorSourceRow);
  const projected = following < 0 ? navigationSourceRows.length - 1 : Math.max(0, following - 1);
  return projected === 0;
}

export function requestsNewerTranscriptAtReviewBottom(event: HardwareKeyEvent, cursorSourceRow: number,
  navigationSourceRows: readonly number[], cleanNormalState: boolean) {
  if (!cleanNormalState || event.isRepeat || event.control || event.command || event.option) return false;
  const last = navigationSourceRows.at(-1);
  return last !== undefined && cursorSourceRow >= last && normalizedHardwareKey(event) === 'j';
}
