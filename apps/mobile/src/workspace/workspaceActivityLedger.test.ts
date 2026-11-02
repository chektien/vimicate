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

  it('retains newer local activity against stale nonzero server clocks without blocking later server activity', () => {
    const ledger = new WorkspaceActivityLedger(); ledger.record('answer', 700);
    expect(ledger.reconcile([project('answer', 500)])[0]?.updatedAt).toBe(700);
    expect(ledger.reconcile([project('answer', 900)])[0]?.updatedAt).toBe(900);
    const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized());
    expect(restored.reconcile([project('answer', 600)])[0]?.updatedAt).toBe(900);
  });

  it('records local interaction and survives serialization without inventing unknown activity', () => {
    const ledger = new WorkspaceActivityLedger(); ledger.record('old', 700);
    const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized());
    expect(restored.reconcile([project('old'), project('unknown')]).map((value) => value.updatedAt)).toEqual([700, undefined]);
  });
});


it('preserves legacy server-first clocks across save, reconcile and migration roundtrips', () => {
  let ledger = new WorkspaceActivityLedger();
  ledger.restore(JSON.stringify([['idle', 900], ['other', 800]]));
  for (let pass = 0; pass < 3; pass++) {
    expect.soft(ledger.reconcile([project('idle', 500), project('other')], 'compatibility').map(row => row.updatedAt)).toEqual([500, 800]);
    ledger.record('unrelated', 1000);
    const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized()); ledger = restored;
  }
  expect(ledger.reconcile([project('idle', 400), project('other', 300)], 'compatibility').map(row => row.updatedAt)).toEqual([400, 300]);
});

it('replaces a legacy read maximum with proven fresh activity, even when that activity is older', () => {
  const ledger = new WorkspaceActivityLedger(); ledger.restore(JSON.stringify([['answer', 900]]));
  ledger.reconcile([project('answer', 500)]);
  ledger.record('answer', 700);
  const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized());
  expect(restored.reconcile([project('answer', 500)])[0]?.updatedAt).toBe(700);
  expect(restored.reconcile([project('answer', 1000)])[0]?.updatedAt).toBe(1000);
});


it('retains newer server activity as a fallback without promoting legacy provenance', () => {
  const ledger = new WorkspaceActivityLedger(); ledger.restore(JSON.stringify([['idle', 900]]));
  expect(ledger.reconcile([project('idle', 1100)], 'compatibility')[0]?.updatedAt).toBe(1100);
  const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized());
  expect(restored.reconcile([project('idle')])[0]?.updatedAt).toBe(1100);
  expect(restored.reconcile([project('idle', 500)], 'compatibility')[0]?.updatedAt).toBe(500);
});


it('keeps proven server activity when replacing a legacy fallback with an older live event', () => {
  const ledger = new WorkspaceActivityLedger(); ledger.restore(JSON.stringify([['idle', 900]]));
  ledger.reconcile([project('idle', 800)]);
  const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized());
  expect(restored.record('idle', 700)).toBe(800);
  expect(restored.reconcile([project('idle', 500)])[0]?.updatedAt).toBe(800);
});


it('does not bless a legacy fallback when registry or startup reprojects the current presentation', () => {
  const ledger = new WorkspaceActivityLedger(); ledger.restore(JSON.stringify([['idle', 900]]));
  const projected = ledger.reconcile([project('idle')]);
  ledger.reconcile(projected, 'presentation');
  const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized());
  expect(restored.record('idle', 700)).toBe(700);
  expect(restored.reconcile([project('idle', 500)])[0]?.updatedAt).toBe(700);
});
