import { describe, expect, it } from 'vitest';
import {
  COMPACT_DRAWER_COMMIT_TRAVEL,
  COMPACT_DRAWER_MAX_SETTLE_MS,
  COMPACT_DRAWER_MIN_SETTLE_MS,
  COMPACT_DRAWER_VELOCITY_ASSIST,
  compactDrawerCommits,
  compactDrawerSettleDuration,
  compactDrawerTranslation,
  createCompactDrawerMotion,
  type CompactDrawerIntent,
} from './compactDrawerGesture';

const WIDTH = 283; // compactProjectDrawerWidth(393, 'phone')

// Replays one physical finger path at a chosen touch-sample interval. The path
// is the same every time; only the schedule the events arrive on changes.
function replay(path: (elapsed: number) => number, span: number, schedule: number[], intent: CompactDrawerIntent) {
  const motion = createCompactDrawerMotion({ width: WIDTH, open: intent === 'close' });
  motion.begin(0);
  for (const at of schedule) if (at > 0 && at < span) motion.track(path(at), at);
  return motion.release(path(span), span, intent);
}

const evenly = (span: number, interval: number) => Array.from({ length: Math.ceil(span / interval) }, (_, step) => step * interval);

describe('compact drawer motion', () => {
  it('tracks the finger one to one and stops at both ends of the drawer', () => {
    const motion = createCompactDrawerMotion({ width: WIDTH, open: false });
    motion.begin(0);
    expect(motion.track(0, 8)).toBe(-WIDTH);
    expect(motion.track(30, 16)).toBe(-WIDTH + 30);
    expect(motion.track(120, 24)).toBe(-WIDTH + 120);
    expect(motion.track(WIDTH + 90, 32)).toBe(0);
    expect(motion.track(-40, 40)).toBe(-WIDTH);
  });

  it('commits the same gesture whatever schedule its touch samples arrive on', () => {
    // 34 points of deliberate travel over 150ms, sampled densely, sparsely and
    // through a stalled JavaScript thread that delivers nothing for 130ms.
    const path = (elapsed: number) => (34 * elapsed) / 150;
    const dense = replay(path, 150, evenly(150, 8), 'open');
    const sparse = replay(path, 150, evenly(150, 55), 'open');
    const stalled = replay(path, 150, [0, 20, 140], 'open');

    expect(dense.commit).toBe(true);
    expect(sparse.commit).toBe(dense.commit);
    expect(stalled.commit).toBe(dense.commit);
    expect(sparse.target).toBe(dense.target);
    expect(stalled.target).toBe(dense.target);
  });

  it('refuses the same short gesture whatever schedule its touch samples arrive on', () => {
    const path = (elapsed: number) => (14 * elapsed) / 150;
    for (const schedule of [evenly(150, 8), evenly(150, 55), [0, 20, 140]]) {
      const settlement = replay(path, 150, schedule, 'open');
      expect(settlement.commit).toBe(false);
      expect(settlement.target).toBe(-WIDTH);
    }
  });

  it('keeps the travel a commit needs inside one narrow band at every release speed', () => {
    const committingTravel = (speed: number) => {
      for (let travel = 0; travel <= 120; travel += 0.5) if (compactDrawerCommits(travel, speed)) return travel;
      return Number.POSITIVE_INFINITY;
    };
    const required = [-4, -2, -0.8, -0.3, 0, 0.3, 0.8, 2, 4].map(committingTravel);
    const smallest = Math.min(...required);
    const largest = Math.max(...required);

    expect(smallest).toBeGreaterThanOrEqual(COMPACT_DRAWER_COMMIT_TRAVEL - COMPACT_DRAWER_VELOCITY_ASSIST);
    expect(largest).toBeLessThanOrEqual(COMPACT_DRAWER_COMMIT_TRAVEL + COMPACT_DRAWER_VELOCITY_ASSIST);
    expect(largest - smallest).toBeLessThanOrEqual(2 * COMPACT_DRAWER_VELOCITY_ASSIST);
    // Monotonic: a faster flick never asks for more travel than a slower one.
    expect([...required].sort((left, right) => right - left)).toEqual(required);
  });

  it('replaces a heuristic whose committing travel depended on unseen sampling', () => {
    const superseded = (dx: number, vx: number) => Math.max(dx, vx * 140) > 42;
    // The same forty-point drag committed or did nothing depending only on how
    // the last two touch samples happened to land.
    expect(superseded(6, 0.31)).toBe(true);
    expect(superseded(40, 0)).toBe(false);
    expect(compactDrawerCommits(6, 0.31)).toBe(false);
    expect(compactDrawerCommits(40, 0)).toBe(true);
  });

  it('asks for the same travel to close as to open, independent of drawer width', () => {
    const opening = replay((elapsed) => (34 * elapsed) / 150, 150, evenly(150, 12), 'open');
    const closing = replay((elapsed) => (-34 * elapsed) / 150, 150, evenly(150, 12), 'close');
    expect(opening.commit).toBe(true);
    expect(closing.commit).toBe(true);
    // The superseded closing rule scaled with the drawer, so this same travel
    // did nothing on a phone-width drawer.
    expect(34).toBeLessThan(WIDTH * 0.25);
  });

  it('does not let a paused finger release as if it had flicked', () => {
    const motion = createCompactDrawerMotion({ width: WIDTH, open: false });
    motion.begin(0);
    motion.track(20, 40);
    motion.track(24, 80);
    // The finger rests for a third of a second before lifting.
    const settlement = motion.release(24, 420, 'open');
    expect(settlement.commit).toBe(false);
  });

  it('settles inside a bounded band, quicker for shorter distances and faster releases', () => {
    expect(compactDrawerSettleDuration(WIDTH, 0)).toBeLessThanOrEqual(COMPACT_DRAWER_MAX_SETTLE_MS);
    expect(compactDrawerSettleDuration(WIDTH, 0)).toBeGreaterThanOrEqual(COMPACT_DRAWER_MIN_SETTLE_MS);
    expect(compactDrawerSettleDuration(28, 0)).toBeLessThan(compactDrawerSettleDuration(WIDTH, 0));
    expect(compactDrawerSettleDuration(WIDTH, 2.6)).toBeLessThan(compactDrawerSettleDuration(WIDTH, 0));
    for (const distance of [0, -WIDTH, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const speed of [0, -3, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
        const duration = compactDrawerSettleDuration(distance, speed);
        expect(duration).toBeGreaterThanOrEqual(COMPACT_DRAWER_MIN_SETTLE_MS);
        expect(duration).toBeLessThanOrEqual(COMPACT_DRAWER_MAX_SETTLE_MS);
      }
    }
  });

  it('settles a committed reveal within the same bounded band', () => {
    const settlement = replay((elapsed) => (34 * elapsed) / 150, 150, evenly(150, 12), 'open');
    expect(settlement.target).toBe(0);
    expect(settlement.duration).toBeGreaterThanOrEqual(COMPACT_DRAWER_MIN_SETTLE_MS);
    expect(settlement.duration).toBeLessThanOrEqual(COMPACT_DRAWER_MAX_SETTLE_MS);
  });

  it('picks a settling drawer up where it stands rather than at its destination', () => {
    const motion = createCompactDrawerMotion({ width: WIDTH, open: true });
    const dismissal = motion.settle(-WIDTH, 1_000, 0);
    expect(dismissal.duration).toBeGreaterThan(0);
    // Grabbed a third of the way through the dismissal.
    const resumed = motion.begin(1_000 + dismissal.duration / 3);
    expect(resumed).toBeLessThan(0);
    expect(resumed).toBeGreaterThan(-WIDTH);
    expect(motion.track(0, 1_020)).toBe(resumed);
  });

  it('returns a terminated drag to the state it started from', () => {
    const motion = createCompactDrawerMotion({ width: WIDTH, open: false });
    motion.begin(0);
    motion.track(60, 40);
    const settlement = motion.cancel(48, 'open');
    expect(settlement.commit).toBe(false);
    expect(settlement.target).toBe(-WIDTH);
    expect(motion.dragging()).toBe(false);
  });

  it('repositions a closed drawer for a new width without a transition', () => {
    const motion = createCompactDrawerMotion({ width: WIDTH, open: false });
    motion.resize(320);
    expect(motion.place(-320)).toBe(-320);
    expect(motion.target()).toBe(-320);
    expect(compactDrawerTranslation(320, -320, 500)).toBe(0);
  });
});
