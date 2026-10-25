import { useCallback, useEffect, useRef, useState } from 'react';
import { loadValue, saveValue } from '../storage/workspaceStore';
import { adjustedPaneFontScales, DEFAULT_PANE_FONT_SCALES, parsedPaneFontScales, type PaneFontScales, type PaneFontTarget } from './paneFontScales';
import { PANE_FONT_SCALES_KEY } from './paneFontScaleStorage';

export function usePaneFontScales() {
  const [scales, setScales] = useState<PaneFontScales>(DEFAULT_PANE_FONT_SCALES);
  const scalesRef = useRef(scales); scalesRef.current = scales;
  const touched = useRef(false);

  useEffect(() => {
    let active = true;
    void loadValue(PANE_FONT_SCALES_KEY).then((stored) => {
      if (!active || touched.current) return;
      const restored = parsedPaneFontScales(stored);
      scalesRef.current = restored;
      setScales(restored);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const adjust = useCallback((pane: PaneFontTarget, direction: 1 | -1) => {
    touched.current = true;
    const next = adjustedPaneFontScales(scalesRef.current, pane, direction);
    scalesRef.current = next;
    setScales(next);
    void saveValue(PANE_FONT_SCALES_KEY, JSON.stringify(next)).catch(() => undefined);
    return next[pane];
  }, []);

  return { scales, adjust };
}
