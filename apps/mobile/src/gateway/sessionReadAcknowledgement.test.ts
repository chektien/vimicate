import { describe, expect, it, vi } from 'vitest';
import { sessionEntriesFromPayload, type WorkspaceProject } from '../workspace/workspaceTypes';
import { acknowledgeSelectedSessionRead } from './sessionReadAcknowledgement';

const project = (marker?: number): WorkspaceProject => sessionEntriesFromPayload({ sessions: [{
  key: 'read-thread', sessionId: 'read-generation', unread: true,
  ...(marker === undefined ? {} : { markedUnreadAt: marker }),
}] })[0]!;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('scoped read acknowledgement', () => {
  it('round-trips the census marker and refuses to erase a newer explicit unread mark', async () => {
    let marker = 100;
    const opened = project(marker);
    marker = 200;
    const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
      expect(params).toEqual({ key: 'read-thread', unread: false, expectedSessionId: 'read-generation', expectedMarkedUnreadAt: 100 });
      if (params.expectedMarkedUnreadAt !== marker) return { applied: false };
      marker = 0; return { applied: true };
    });
    const refresh = vi.fn(async () => {});
    acknowledgeSelectedSessionRead({ status: 'connected', request } as never, opened, () => true, refresh, vi.fn());
    await tick();
    expect(marker).toBe(200);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each(['success', 'failure'] as const)('retires %s callbacks when selection or scene ownership is lost', async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const request = vi.fn(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    const refresh = vi.fn(async () => {}); const failed = vi.fn(); let owned = true;
    acknowledgeSelectedSessionRead({ status: 'connected', request } as never, project(), () => owned, refresh, failed);
    owned = false;
    if (outcome === 'success') resolve(); else reject(new Error('retired transport'));
    await tick();
    expect(refresh).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });

  it('does not dispatch offline, retired, or without a concrete session identity', () => {
    const request = vi.fn(); const refresh = vi.fn(async () => {}); const failed = vi.fn();
    const connected = { status: 'connected' as const, request };
    acknowledgeSelectedSessionRead({ status: 'idle', request }, project(), () => true, refresh, failed);
    acknowledgeSelectedSessionRead(connected, project(), () => false, refresh, failed);
    const unidentified = project(); delete unidentified.sessionId;
    acknowledgeSelectedSessionRead(connected, unidentified, () => true, refresh, failed);
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a rejected owned acknowledgement without claiming success or retrying', async () => {
    const request = vi.fn(async () => { throw new Error('permission denied'); });
    const refresh = vi.fn(async () => {}); const failed = vi.fn();
    acknowledgeSelectedSessionRead({ status: 'connected', request }, project(), () => true, refresh, failed);
    await tick();
    expect(request).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledOnce();
  });
});
