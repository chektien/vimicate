import { describe, expect, it } from 'vitest';
import { acceptSessionCensusAttention, acceptWorkspaceAttention, WorkspaceAttentionLedger, workspaceAttentionSignal } from './workspaceAttention';

describe('workspace attention publication', () => {
  it('ignores read/metadata updates but notices genuine background completion activity', () => {
    const ledger = new WorkspaceAttentionLedger();
    const row = { key: 'thread', sessionId: 'generation', hasActiveRun: false, lastActivityAt: 100, updatedAt: 100 };
    ledger.reconcileSessionCensus({ sessions: [row] });
    expect(ledger.reconcileSessionCensus({ sessions: [{ ...row, updatedAt: 900, lastReadAt: 900 }] }).signals).toEqual([]);
    expect(ledger.reconcileSessionCensus({ sessions: [{ ...row, updatedAt: 900, lastActivityAt: 200 }] }).signals).toMatchObject([{ sessionKey: 'thread', occurredAt: 200000 }]);
  });

  it('rebases legacy metadata-clock census without losing unread or delivery deduplication', () => {
    const ledger = new WorkspaceAttentionLedger();
    ledger.restore(JSON.stringify({ identities: ['already-delivered'], unreadSessions: ['other'], sessionCensus: [['thread', 900000, 'terminal', '', 'generation']] }));
    expect(ledger.isUnread('other')).toBe(true); expect(ledger.accept('already-delivered')).toBe(false);
    const row = { key: 'thread', sessionId: 'generation', hasActiveRun: false, lastActivityAt: 100, updatedAt: 900 };
    expect(ledger.reconcileSessionCensus({ sessions: [row] }).signals).toEqual([]);
    expect(ledger.reconcileSessionCensus({ sessions: [{ ...row, lastActivityAt: 200 }] }).signals).toHaveLength(1);
  });

  it('classifies selected or background final delivery by explicit session ownership', () => {
    expect(workspaceAttentionSignal({ event: 'chat', payload: { sessionKey: 'summaries', runId: 'r1', state: 'final', timestamp: 1_800_000_000 } })).toEqual({ sessionKey: 'summaries', identity: 'session.complete\u0000summaries\u0000r1', occurredAt: 1_800_000_000_000 });
    expect(workspaceAttentionSignal({ event: 'cron.delivery.completed', payload: { destinationSessionKey: 'emails', deliveryId: 'd1' } }, 42)).toEqual({ sessionKey: 'emails', identity: 'delivery.complete\u0000emails\u0000d1', occurredAt: 42 });
    expect(workspaceAttentionSignal({ event: 'agent', payload: { sessionKey: 'summaries', runId: 'r2', stream: 'lifecycle', data: { phase: 'end', endedAtMs: 1_800_000_001_000 } } })).toEqual({ sessionKey: 'summaries', identity: 'session.complete\u0000summaries\u0000r2', occurredAt: 1_800_000_001_000 });
    expect(workspaceAttentionSignal({ event: 'chat', payload: { sessionKey: 'notes', state: 'delta' } })).toBeNull();
  });

  it('publishes each delivery identity once across persistence restore', () => {
    const ledger = new WorkspaceAttentionLedger(); expect(ledger.accept('delivery')).toBe(true); expect(ledger.accept('delivery')).toBe(false); ledger.markUnread('summaries');
    const restored = new WorkspaceAttentionLedger(); restored.restore(ledger.serialized()); expect(restored.accept('delivery')).toBe(false); expect(restored.isUnread('summaries')).toBe(true);
    restored.clearUnread('summaries'); expect(restored.isUnread('summaries')).toBe(false);
  });

  it('bounds unread sessions during a long-lived process', () => {
    const ledger = new WorkspaceAttentionLedger();
    for (let index = 0; index <= 2_048; index += 1) ledger.markUnread(`session-${index}`);

    expect(ledger.isUnread('session-0')).toBe(false);
    expect(ledger.isUnread('session-1')).toBe(true);
    expect(ledger.isUnread('session-2048')).toBe(true);
    expect(JSON.parse(ledger.serialized()).unreadSessions).toHaveLength(2_048);

    ledger.markUnread('session-1');
    ledger.markUnread('session-2049');
    expect(ledger.isUnread('session-1')).toBe(true);
    expect(ledger.isUnread('session-2')).toBe(false);
  });

  it('turns the real OpenClaw active-to-idle census into durable background attention', () => {
    const ledger = new WorkspaceAttentionLedger();
    expect(ledger.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'running', hasActiveRun: true, activeRunIds: ['cron-1'], updatedAt: 1_800_000_000 },
      { key: 'selected', status: 'running', hasActiveRun: true, activeRunIds: ['selected-1'], updatedAt: 1_800_000_000 },
    ] })).toEqual({ changed: true, signals: [] });

    const completed = ledger.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'idle', hasActiveRun: false, activeRunIds: [], updatedAt: 1_800_000_100 },
      { key: 'selected', status: 'idle', hasActiveRun: false, activeRunIds: [], updatedAt: 1_800_000_100 },
    ] });
    expect(completed.changed).toBe(true);
    expect(completed.signals).toEqual([
      { sessionKey: 'emails', identity: 'session.complete\u0000emails\u0000cron-1', occurredAt: 1_800_000_100_000 },
      { sessionKey: 'selected', identity: 'session.complete\u0000selected\u0000selected-1', occurredAt: 1_800_000_100_000 },
    ]);

    expect(acceptWorkspaceAttention(ledger, completed.signals[0]!, 'selected')).toEqual({ accepted: true, unread: true });
    expect(acceptWorkspaceAttention(ledger, completed.signals[1]!, 'selected')).toEqual({ accepted: true, unread: false });
    expect(ledger.isUnread('emails')).toBe(true);
    expect(ledger.isUnread('selected')).toBe(false);
  });

  it('does not replay a terminal census after persistence but accepts the next cron completion', () => {
    const first = new WorkspaceAttentionLedger();
    first.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'running', hasActiveRun: true, activeRunIds: ['cron-1'], updatedAt: 100 },
    ] });
    const completed = first.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'idle', hasActiveRun: false, activeRunIds: [], updatedAt: 200 },
    ] });
    expect(acceptWorkspaceAttention(first, completed.signals[0]!, '')).toEqual({ accepted: true, unread: true });

    const restored = new WorkspaceAttentionLedger();
    restored.restore(first.serialized());
    expect(restored.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'idle', hasActiveRun: false, activeRunIds: [], updatedAt: 200 },
    ] })).toEqual({ changed: false, signals: [] });

    expect(restored.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'running', hasActiveRun: true, activeRunIds: ['cron-2'], updatedAt: 250 },
    ] })).toEqual({ changed: true, signals: [] });
    expect(restored.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'idle', hasActiveRun: false, activeRunIds: [], updatedAt: 300 },
    ] })).toEqual({
      changed: true,
      signals: [{ sessionKey: 'emails', identity: 'session.complete\u0000emails\u0000cron-2', occurredAt: 300_000 }],
    });
  });

  it('ignores a stale late census and non-terminal activity advancement', () => {
    const ledger = new WorkspaceAttentionLedger();
    ledger.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'running', runId: 'cron-2', updatedAt: 500 },
    ] });
    expect(ledger.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'completed', runId: 'cron-1', updatedAt: 400 },
    ] })).toEqual({ changed: false, signals: [] });
    expect(ledger.reconcileSessionCensus({ sessions: [
      { key: 'emails', status: 'running', runId: 'cron-2', updatedAt: 600 },
    ] })).toEqual({ changed: true, signals: [] });
  });

  it('publishes accepted census attention once and suppresses unread on the selected session', () => {
    const ledger = new WorkspaceAttentionLedger();
    const accepted: Array<[string, number, boolean]> = [];
    acceptSessionCensusAttention(ledger, { sessions: [
      { key: 'emails', status: 'running', hasActiveRun: true, activeRunIds: ['cron-1'], updatedAt: 100 },
      { key: 'notes', status: 'running', hasActiveRun: true, activeRunIds: ['notes-1'], updatedAt: 100 },
    ] }, 'notes', (...entry) => accepted.push(entry));

    expect(acceptSessionCensusAttention(ledger, { sessions: [
      { key: 'emails', status: 'idle', hasActiveRun: false, activeRunIds: [], updatedAt: 200 },
      { key: 'notes', status: 'idle', hasActiveRun: false, activeRunIds: [], updatedAt: 200 },
    ] }, 'notes', (...entry) => accepted.push(entry))).toBe(true);
    expect(accepted).toEqual([
      ['emails', 200_000, true],
      ['notes', 200_000, false],
    ]);
    expect(ledger.isUnread('emails')).toBe(true);
    expect(ledger.isUnread('notes')).toBe(false);
  });
});
