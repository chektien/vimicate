// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const drawer = readFileSync(new URL('../../src/layout/CompactProjectDrawer.tsx', import.meta.url), 'utf8');

describe('compact project drawer gesture authority', () => {
  it('builds each pan responder once instead of rebuilding it from parent identity', () => {
    // BUG-282's root cause. `PanResponder.create` keeps the accumulated `dx`
    // and `vx` of a live gesture in the closure it builds, so a responder
    // rebuilt mid-swipe restarts from a single frame's delta. The superseded
    // owner memoized both responders on `onOpen`, `onDismiss` and `width` —
    // values the shell supplies fresh on every render — so ordinary transcript
    // traffic snapped the drawer back and moved the trigger point.
    expect(drawer).not.toContain('useMemo(() => PanResponder.create');
    expect(drawer).toContain('useRef<Engine | null>(null)');
    expect(drawer).toContain('if (!engine.current) engine.current = createEngine(live)');
    expect(drawer).toContain('live.current');
  });

  it('tracks the finger in both directions', () => {
    // The superseded opening gesture had no move handler at all: the pane did
    // not leave the edge until the finger lifted.
    expect(drawer.match(/onPanResponderMove:/g)).toHaveLength(1);
    expect(drawer).toContain("opening: responder('open'), closing: responder('close')");
    expect(drawer).toContain('motion.track(gesture.dx, Date.now())');
  });

  it('decides commits and settles through the motion owner, not an inline heuristic', () => {
    expect(drawer).not.toMatch(/gesture\.vx/);
    expect(drawer).not.toContain('width * 0.25');
    expect(drawer).toContain("from './compactDrawerGesture'");
    expect(drawer).toContain('motion.release(gesture.dx, Date.now(), intent)');
    expect(drawer).toContain('duration: settlement.duration');
  });

  it('settles on a decelerating curve rather than the default ease-in-out', () => {
    expect(drawer).toContain('Easing.out(Easing.cubic)');
    expect(drawer).toContain('easing: SETTLE_EASING');
    expect(drawer).toContain('useNativeDriver: true');
  });

  it('keeps per-render animated node and style churn out of the drag', () => {
    // A fresh interpolation node on every shell render re-attached the scrim to
    // a natively driven value while the finger was still moving.
    expect(drawer).toContain('useMemo(() => translateX.interpolate(');
    expect(drawer).toContain('const scrimStyle = useMemo(');
    expect(drawer).toContain('const drawerStyle = useMemo(');
  });

  it('leaves a touch it does not claim to the surface underneath', () => {
    // The edge strip used to claim every touch that started within it.
    expect(drawer).toContain('onStartShouldSetPanResponder: () => false');
    expect(drawer).toContain('COMPACT_DRAWER_EDGE_REVEAL_WIDTH');
    // A claimed horizontal drag is not handed to a scroll view inside the pane.
    expect(drawer).toContain('onPanResponderTerminationRequest: () => false');
  });
});
