import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

/**
 * Hardware key streams can deliver several events before React renders.
 * This state wrapper advances the dispatcher's authoritative value
 * immediately while still scheduling the ordinary React render.
 */
export function useSynchronousState<T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>, MutableRefObject<T>] {
  const [value, setRenderedValue] = useState(initial);
  const valueRef = useRef(value);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    const next = typeof update === 'function' ? (update as (current: T) => T)(valueRef.current) : update;
    valueRef.current = next;
    setRenderedValue(next);
  }, []);
  return [value, setValue, valueRef];
}
