import { describe, expect, it } from 'vitest';
import { WorkspaceActivityLedger } from './workspaceActivityLedger';
import type { WorkspaceProject } from './workspaceTypes';

const project = (sessionKey: string, updatedAt?: number): WorkspaceProject => ({ id: sessionKey, sessionKey, name: sessionKey, path: '~', branch: '—', starred: false, threadCount: 1, state: 'idle', ...(updatedAt ? { updatedAt } : {}) });

describe('durable workspace activity ledger', () => {
  it('retains a known timestamp when a partial session refresh omits it', () => {
    const ledger = new WorkspaceActivityLedger();
    ledger.reconcile([project('video-analysis', 500), project('other', 400)]);
    expect(ledger.reconcile([project('video-analysis'), project('other', 600)]).map((value) => value.updatedAt)).toEqual([500, 600]);
  });

  it('records local interaction and survives serialization without inventing unknown activity', () => {
    const ledger = new WorkspaceActivityLedger(); ledger.record('old', 700);
    const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized());
    expect(restored.reconcile([project('old'), project('unknown')]).map((value) => value.updatedAt)).toEqual([700, undefined]);
  });
});
