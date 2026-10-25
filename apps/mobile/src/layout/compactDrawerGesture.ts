// Motion policy for the compact projects drawer.
//
// BUG-282: the superseded owner decided a reveal with
// `Math.max(gesture.dx, gesture.vx * 140) > 42`. That is two rules joined by
// an OR — a flick committed after roughly six points of travel while a steady
// drag demanded forty-two — and `PanResponder` derives `vx` from the last pair
// of touch samples, so which rule applied depended on how the touch stream
// happened to be scheduled rather than on anything the finger did. This owner
// replaces it with one band: a single travel, in either direction, that a
// release speed may only nudge by a bounded amount.

export type CompactDrawerIntent = 'open' | 'close';

export type CompactDrawerSettlement = {
  commit: boolean;
  target: number;
  duration: number;
};

// The travel that commits a transition when the finger releases at rest.
export const COMPACT_DRAWER_COMMIT_TRAVEL = 32;
// The most a flick may shave off that travel, or a reversal add to it.
export const COMPACT_DRAWER_VELOCITY_ASSIST = 12;
// Release speed is projected across this horizon before it is capped.
export const COMPACT_DRAWER_PROJECTION_MS = 40;
// Speed is averaged over this trailing window rather than read from the last
// pair of samples, so a stalled or bursty touch stream cannot invent a flick.
export const COMPACT_DRAWER_VELOCITY_WINDOW_MS = 90;
export const COMPACT_DRAWER_VELOCITY_SAMPLES = 12;
// Horizontal travel that claims the responder, and the width of the strip
// along the screen edge that listens for it.
export const COMPACT_DRAWER_ACTIVATION_SLOP = 4;
export const COMPACT_DRAWER_EDGE_REVEAL_WIDTH = 24;
// A settle is always quick and always bounded; within the band it is
// proportional to the distance left to cover and to the speed handed over.
export const COMPACT_DRAWER_MIN_SETTLE_MS = 110;
export const COMPACT_DRAWER_MAX_SETTLE_MS = 200;
export const COMPACT_DRAWER_SETTLE_SPEED = 1.55;

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

export function compactDrawerTranslation(width: number, base: number, dx: number) {
  const span = Math.max(0, finite(width));
  return Math.min(0, Math.max(-span, finite(base) + finite(dx)));
}

export function compactDrawerVelocityAssist(speed: number) {
  const projected = finite(speed) * COMPACT_DRAWER_PROJECTION_MS;
  return Math.min(COMPACT_DRAWER_VELOCITY_ASSIST, Math.max(-COMPACT_DRAWER_VELOCITY_ASSIST, projected));
}

export function compactDrawerCommits(travel: number, speed: number) {
  return finite(travel) + compactDrawerVelocityAssist(speed) >= COMPACT_DRAWER_COMMIT_TRAVEL;
}

export function compactDrawerSettleDuration(distance: number, speed: number) {
  const remaining = Math.abs(finite(distance));
  const covered = Math.max(COMPACT_DRAWER_SETTLE_SPEED, Math.abs(finite(speed)));
  return Math.round(Math.min(COMPACT_DRAWER_MAX_SETTLE_MS, Math.max(COMPACT_DRAWER_MIN_SETTLE_MS, remaining / covered)));
}

// The analytic form of the settle curve the view runs as `Easing.out(cubic)`.
// Knowing it here lets a finger that grabs a settling drawer pick it up where
// it actually is without a per-frame listener on a natively driven value.
export function compactDrawerSettleEase(progress: number) {
  const bounded = Math.min(1, Math.max(0, finite(progress)));
  return 1 - (1 - bounded) ** 3;
}

export function createCompactDrawerMotion(initial: { width: number; open: boolean }) {
  let width = Math.max(0, finite(initial.width));
  let resting = initial.open ? 0 : -width;
  let from = resting;
  let startedAt = 0;
  let duration = 0;
  let dragging = false;
  let base = 0;
  const samples: { dx: number; at: number }[] = [];

  const positionAt = (at: number) => {
    if (duration <= 0) return resting;
    const progress = (finite(at) - startedAt) / duration;
    return progress >= 1 ? resting : from + (resting - from) * compactDrawerSettleEase(progress);
  };

  const speed = () => {
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return 0;
    const elapsed = last.at - first.at;
    return elapsed > 0 ? (last.dx - first.dx) / elapsed : 0;
  };

  const record = (dx: number, at: number) => {
    if (!Number.isFinite(dx) || !Number.isFinite(at)) return;
    samples.push({ dx, at });
    while (samples.length > 2 && at - (samples[0]?.at ?? at) > COMPACT_DRAWER_VELOCITY_WINDOW_MS) samples.shift();
    while (samples.length > COMPACT_DRAWER_VELOCITY_SAMPLES) samples.shift();
  };

  const settle = (target: number, at: number, handoff: number): CompactDrawerSettlement => {
    const start = positionAt(at);
    const next = compactDrawerSettleDuration(target - start, handoff);
    from = start;
    resting = target;
    startedAt = finite(at);
    duration = next;
    dragging = false;
    return { commit: false, target, duration: next };
  };

  const conclude = (commit: boolean, at: number, handoff: number, intent: CompactDrawerIntent): CompactDrawerSettlement => {
    const opening = intent === 'open';
    // The position the finger left behind is authoritative, so drop any curve
    // still in flight before the settle reads where to start from.
    duration = 0;
    return { ...settle(commit === opening ? 0 : -width, at, handoff), commit };
  };

  return {
    // Where the drawer is headed. The view uses it to tell a transition it has
    // already started apart from one a prop change is only now asking for.
    target: () => resting,
    dragging: () => dragging,
    resize: (next: number) => { width = Math.max(0, finite(next)); },
    place: (value: number) => {
      resting = compactDrawerTranslation(width, value, 0);
      from = resting;
      duration = 0;
      return resting;
    },
    settle,
    begin: (at: number) => {
      base = positionAt(at);
      resting = base;
      duration = 0;
      dragging = true;
      samples.length = 0;
      record(0, at);
      return base;
    },
    track: (dx: number, at: number) => {
      if (!dragging) return resting;
      record(dx, at);
      resting = compactDrawerTranslation(width, base, dx);
      return resting;
    },
    release: (dx: number, at: number, intent: CompactDrawerIntent) => {
      record(dx, at);
      const direction = intent === 'open' ? 1 : -1;
      const toward = speed() * direction;
      const commit = dragging && compactDrawerCommits(finite(dx) * direction, toward);
      if (dragging) resting = compactDrawerTranslation(width, base, dx);
      return conclude(commit, at, Math.abs(toward), intent);
    },
    cancel: (at: number, intent: CompactDrawerIntent) => conclude(false, at, 0, intent),
  };
}

export type CompactDrawerMotion = ReturnType<typeof createCompactDrawerMotion>;
