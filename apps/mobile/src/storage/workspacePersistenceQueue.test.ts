import { describe, expect, it } from 'vitest';
import { WorkspacePersistenceQueue } from './workspacePersistenceQueue';

describe('workspace persistence queue', () => {
  it('serializes native writes', async () => {
    const queue = new WorkspacePersistenceQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.enqueue('first', async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      events.push('first:end');
    });
    const second = queue.enqueue('second', async () => { events.push('second'); });
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('holds writes while inactive and coalesces a key to its newest value', async () => {
    const queue = new WorkspacePersistenceQueue();
    const values: string[] = [];
    queue.setActive(false);
    const older = queue.enqueue('draft:one', async () => { values.push('older'); });
    const newer = queue.enqueue('draft:one', async () => { values.push('newer'); });
    await Promise.resolve();
    expect(values).toEqual([]);
    queue.setActive(true);
    await Promise.all([older, newer]);
    expect(values).toEqual(['newer']);
  });

  it('orders a foreground read barrier after writes queued while inactive', async () => {
    const queue = new WorkspacePersistenceQueue();
    const events: string[] = [];
    queue.setActive(false);
    const write = queue.enqueue('state:selection', async () => { events.push('selected-thread'); });
    const barrier = queue.barrier().then(() => { events.push('read'); });
    await Promise.resolve();
    expect(events).toEqual([]);

    queue.setActive(true);
    await Promise.all([write, barrier]);
    expect(events).toEqual(['selected-thread', 'read']);
  });

  it('continues after a rejected write', async () => {
    const queue = new WorkspacePersistenceQueue();
    const events: string[] = [];
    const failed = queue.enqueue('failed', async () => { throw new Error('write failed'); });
    const recovered = queue.enqueue('next', async () => { events.push('next'); });
    await expect(failed).rejects.toThrow('write failed');
    await recovered;
    expect(events).toEqual(['next']);
  });

  it('leases an in-flight write through suspension and starts no later write until active', async () => {
    const events: string[] = [];
    const queue = new WorkspacePersistenceQueue(async (task) => {
      events.push('lease:start');
      try {
        await task();
      } finally {
        events.push('lease:end');
      }
    });
    let finishFirst: (() => void) | undefined;
    const first = queue.enqueue('first', async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      events.push('first:end');
    });
    await Promise.resolve();
    queue.setActive(false);
    const second = queue.enqueue('second', async () => { events.push('second'); });
    expect(events).toEqual(['lease:start', 'first:start']);

    finishFirst?.();
    await first;
    expect(events).toEqual(['lease:start', 'first:start', 'first:end', 'lease:end']);

    queue.setActive(true);
    await second;
    expect(events).toEqual([
      'lease:start',
      'first:start',
      'first:end',
      'lease:end',
      'lease:start',
      'second',
      'lease:end',
    ]);
  });

  it('always releases the native activity lease when a write rejects', async () => {
    const events: string[] = [];
    const queue = new WorkspacePersistenceQueue(async (task) => {
      events.push('lease:start');
      try {
        await task();
      } finally {
        events.push('lease:end');
      }
    });
    const failed = queue.enqueue('failed', async () => {
      events.push('write');
      throw new Error('native write failed');
    });
    await expect(failed).rejects.toThrow('native write failed');
    expect(events).toEqual(['lease:start', 'write', 'lease:end']);
  });

  it('starts fail-closed so cold-launch schema work waits for an active scene', async () => {
    const events: string[] = [];
    const queue = new WorkspacePersistenceQueue(async (task) => {
      events.push('lease:start');
      try { await task(); } finally { events.push('lease:end'); }
    }, false);

    const initialized = queue.enqueue('database:init', async () => { events.push('schema'); });
    await Promise.resolve();
    expect(events).toEqual([]);

    queue.setActive(true);
    await initialized;
    expect(events).toEqual(['lease:start', 'schema', 'lease:end']);
  });
});
