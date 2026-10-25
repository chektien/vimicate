import { describe, expect, it } from 'vitest';
import { TranscriptBlankViewportRecoveryOwner } from './transcriptBlankViewportRecovery';

function frameHarness() {
  let next = 1;
  const frames = new Map<number, () => void>();
  return {
    schedule: (callback: () => void) => { const id = next; next += 1; frames.set(id, callback); return id; },
    cancel: (id: number) => { frames.delete(id); },
    runNext: () => { const entry = frames.entries().next().value as [number, () => void] | undefined; if (!entry) return; frames.delete(entry[0]); entry[1](); },
    pending: () => frames.size,
  };
}

describe('blank transcript viewport recovery owner', () => {
  it('confirms for two frames and permits only one write per content generation', () => {
    const frames = frameHarness();
    const owner = new TranscriptBlankViewportRecoveryOwner(frames.schedule, frames.cancel);
    let recoveries = 0;
    owner.schedule('session-a', 'revision-1', (key) => key === 'revision-1', () => true, () => { recoveries += 1; });
    frames.runNext(); expect(recoveries).toBe(0);
    frames.runNext(); expect(recoveries).toBe(1);
    owner.schedule('session-a', 'revision-1', () => true, () => true, () => { recoveries += 1; });
    frames.runNext(); frames.runNext();
    expect(recoveries).toBe(1);
    expect(frames.pending()).toBe(0);
  });

  it('reports queue, pending and spent schedule decisions', () => {
    const frames = frameHarness();
    const owner = new TranscriptBlankViewportRecoveryOwner(frames.schedule, frames.cancel);
    const schedule = () => owner.schedule('session-a', 'revision-1', () => true, () => true, () => {});
    expect(schedule()).toBe('queued');
    expect(schedule()).toBe('pending');
    frames.runNext(); frames.runNext();
    expect(schedule()).toBe('attempted');
  });

  it('cancels when rows become visible and rejects stale datasets', () => {
    const frames = frameHarness();
    const owner = new TranscriptBlankViewportRecoveryOwner(frames.schedule, frames.cancel);
    let recoveries = 0;
    owner.schedule('session-a', 'revision-1', () => false, () => true, () => { recoveries += 1; });
    frames.runNext(); frames.runNext();
    expect(recoveries).toBe(0);
    owner.schedule('session-b', 'revision-1', () => true, () => true, () => { recoveries += 1; });
    owner.settledVisible();
    expect(frames.pending()).toBe(0);
    expect(recoveries).toBe(0);
  });

  it('rearms when a different dataset reuses the same revision label', () => {
    const frames = frameHarness();
    const owner = new TranscriptBlankViewportRecoveryOwner(frames.schedule, frames.cancel);
    let recoveries = 0;
    owner.schedule('session-a', 'revision-1', () => true, () => true, () => { recoveries += 1; });
    frames.runNext(); frames.runNext();
    owner.schedule('session-b', 'revision-1', () => true, () => true, () => { recoveries += 1; });
    frames.runNext(); frames.runNext();
    expect(recoveries).toBe(2);
  });

  it('rearms the bounded recovery budget after the viewport becomes visible', () => {
    const frames = frameHarness();
    const owner = new TranscriptBlankViewportRecoveryOwner(frames.schedule, frames.cancel);
    let generation = 'session-a@revision-1';
    let recoveries = 0;
    owner.schedule('session-a', generation, (key) => key === generation, () => true, () => { recoveries += 1; });
    for (let index = 0; index < 8; index += 1) frames.runNext();
    expect(recoveries).toBe(1);

    owner.schedule('session-a', generation, (key) => key === generation, () => true, () => { recoveries += 1; });
    expect(frames.pending()).toBe(0);

    owner.settledVisible();
    generation = 'session-a@revision-2';
    owner.schedule('session-a', generation, (key) => key === generation, () => true, () => { recoveries += 1; });
    frames.runNext(); frames.runNext();
    expect(recoveries).toBe(2);
  });

  it('retires an older pending generation before the newer one confirms', () => {
    const frames = frameHarness();
    const owner = new TranscriptBlankViewportRecoveryOwner(frames.schedule, frames.cancel);
    let generation = 'session-a@revision-1';
    let recoveries = 0;
    owner.schedule('session-a', generation, (key) => key === generation, () => true, () => { recoveries += 1; });
    frames.runNext();

    generation = 'session-a@revision-2';
    owner.schedule('session-a', generation, (key) => key === generation, () => true, () => { recoveries += 1; });
    expect(frames.pending()).toBe(1);
    frames.runNext(); frames.runNext();
    expect(recoveries).toBe(1);
  });

  it('does not rearm an unbounded recovery episode across live revisions', () => {
    const frames = frameHarness();
    const owner = new TranscriptBlankViewportRecoveryOwner(frames.schedule, frames.cancel);
    let recoveries = 0;

    for (let revision = 1; revision <= 20; revision += 1) {
      const generation = `session-a@revision-${revision}`;
      owner.schedule('session-a', generation, (key) => key === generation, () => true, () => { recoveries += 1; });
      frames.runNext(); frames.runNext();
    }

    expect(recoveries).toBe(3);
    expect(frames.pending()).toBe(0);

    owner.settledVisible();
    owner.schedule('session-a', 'session-a@revision-21', () => true, () => true, () => { recoveries += 1; });
    frames.runNext(); frames.runNext();
    expect(recoveries).toBe(4);
  });
});
