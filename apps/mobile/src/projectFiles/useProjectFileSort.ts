import { useCallback, useRef, useState } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { ProjectFileEntry } from '../gateway/projectFiles';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { visibleProjectFileEntries, type FileListNavigation } from './projectFileBrowserCore';
import { DEFAULT_FILE_SORT, FILE_SORT_CHOICES, fileSortLabel, type ProjectFileSort } from './projectFileSort';

type Cell<T> = { current: T };
/** One in-memory sort preference per Files location; no filesystem mutation. */
export function useProjectFileSort(entries: ProjectFileEntry[], showHidden: boolean,
  navigation: Cell<FileListNavigation>, setNavigation: (next: FileListNavigation) => void, canChange: () => boolean) {
  const [order, setOrder] = useState<ProjectFileSort>(DEFAULT_FILE_SORT);
  const orderRef = useRef(order);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const dismiss = useCallback(() => { visibleRef.current = false; setVisible(false); }, []);
  const toggle = () => {
    if (!canChange()) return;
    const next = { ...navigation.current, pending: '' as const, count: '' };
    navigation.current = next; setNavigation(next);
    visibleRef.current = !visibleRef.current; setVisible(visibleRef.current);
  };
  const choose = (next: ProjectFileSort) => {
    if (!canChange()) { dismiss(); return; }
    const selected = visibleProjectFileEntries(entries, showHidden, orderRef.current)[navigation.current.index]?.path;
    const rows = visibleProjectFileEntries(entries, showHidden, next);
    const index = selected === undefined ? navigation.current.index : rows.findIndex(row => row.path === selected);
    const nav: FileListNavigation = { index, pending: '', count: '' };
    orderRef.current = next; setOrder(next); navigation.current = nav; setNavigation(nav); dismiss();
  };
  const reverse = () => choose({ ...orderRef.current, direction: orderRef.current.direction === 'asc' ? 'desc' : 'asc' });
  const handleKey = (event: HardwareKeyEvent) => {
    if (!visibleRef.current) return false;
    const key = normalizedHardwareKey(event);
    if (key === 'escape' || event.control && key === '[') dismiss();
    else if (!event.control && !event.command && !event.option) {
      const choice = FILE_SORT_CHOICES.find(choice => choice.key === key);
      if (choice) choose({ field: choice.field, direction: choice.direction });
      else if (key === 'r') reverse();
      else if (key === 'q') dismiss();
    }
    return true;
  };
  return { order, orderRef, visible, label: fileSortLabel(order), choose, reverse, toggle, dismiss, handleKey };
}
