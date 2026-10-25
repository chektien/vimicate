import { describe, expect, it, vi } from 'vitest';
import { guardedBackgroundTaskDetail, launchGuardedBackgroundTask } from './guardedBackgroundTask';

describe('fire-and-forget JavaScript boundary', () => {
  it('owns synchronous bridge throws', () => {
    const failure = vi.fn();
    launchGuardedBackgroundTask(() => { throw new Error('bridge failed'); }, failure);
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: 'bridge failed' }));
  });

  it('owns asynchronous rejections without rejecting its caller', async () => {
    const failure = vi.fn();
    launchGuardedBackgroundTask(async () => { throw new Error('write failed'); }, failure);
    await Promise.resolve();
    await Promise.resolve();
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: 'write failed' }));
  });

  it('derives a user-facing fallback for non-errors', () => {
    expect(guardedBackgroundTaskDetail(new Error('send failed at bridge'), 'failed')).toBe('send failed at bridge');
    expect(guardedBackgroundTaskDetail({ code: 1 }, 'failed')).toBe('failed');
  });
});
