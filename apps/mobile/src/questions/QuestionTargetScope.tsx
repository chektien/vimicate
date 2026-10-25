import { createContext, useCallback, useContext, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
type Region = { y: number; height: number };
type Target = { measureLayout: View['measureLayout'] };
const Context = createContext<{ reveal: (target: Target, owns: () => boolean) => void; release: (restore: boolean) => void } | null>(null);

/** Native measurement is relative to this exact recycler cell, never a source
 * line estimate. The pane remains the sole scroll writer. */
export function QuestionTargetScope({ children, reveal, capture, cancel }: { children: ReactNode; reveal: (region: Region) => void; capture: () => Region | null; cancel: () => void }) {
  const cell = useRef<View>(null); const saved = useRef<Region | null>(null); const alive = useRef(false);
  const engaged = useRef(false); const request = useRef<object>({});
  const committed = useRef({ reveal, capture, cancel });
  // Recycler renderItem closures change on ordinary pane renders. Publish their
  // owner only on commit without changing the target context's identity.
  useInsertionEffect(() => { committed.current = { reveal, capture, cancel }; });
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current = {}; if (engaged.current) committed.current.cancel(); };
  }, []);
  const value = useMemo(() => ({
    reveal: (target: Target, owns: () => boolean) => {
      const owner = cell.current; if (!owner || !alive.current) return;
      engaged.current = true;
      if (!saved.current) saved.current = committed.current.capture();
      const measurement = request.current = {};
      target.measureLayout(owner, (_x, y, _width, height) => {
        if (alive.current && request.current === measurement && owner === cell.current && owns()) committed.current.reveal({ y, height });
      }, () => {});
    },
    release: (restore: boolean) => {
      request.current = {};
      const position = saved.current; saved.current = null;
      if (engaged.current) committed.current.cancel(); engaged.current = false;
      if (restore && alive.current && position) committed.current.reveal(position);
    },
  }), []);
  return <Context.Provider value={value}><View ref={cell} collapsable={false}>{children}</View></Context.Provider>;
}

export function useQuestionTarget(active: boolean, identity: string, returnRevision = 0) {
  const scope = useContext(Context); const target = useRef<View>(null); const epoch = useRef<object>({});
  const committedScope = useRef(scope);
  useLayoutEffect(() => { committedScope.current = scope; });
  useLayoutEffect(() => () => committedScope.current?.release(false), []);
  const returned = useRef(returnRevision);
  const reveal = useCallback(() => {
    const request = epoch.current; if (active && target.current) scope?.reveal(target.current, () => epoch.current === request);
  }, [active, scope]);
  useLayoutEffect(() => {
    epoch.current = {};
    return () => { epoch.current = {}; };
  }, [identity, reveal]);
  useEffect(reveal, [identity, reveal]);
  useEffect(() => {
    if (!active) scope?.release(returned.current !== returnRevision);
    returned.current = returnRevision;
  }, [active, returnRevision, scope]);
  return { ref: target, onLayout: reveal, collapsable: false as const };
}
