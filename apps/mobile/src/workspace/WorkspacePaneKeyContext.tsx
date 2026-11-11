import { createContext, useContext } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';

type RoutePaneKey = (event: HardwareKeyEvent, mode: 'insert' | 'normal', releaseEditor: () => void, scope: string) => boolean;
const Context = createContext<{ route: RoutePaneKey; cancel: () => void } | null>(null);
export const WorkspacePaneKeyProvider = Context.Provider;
export const useWorkspacePaneKey = () => useContext(Context);
