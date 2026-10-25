import { describe, expect, it } from 'vitest';
import { projectRegisteredGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { latestHistoryWindow } from './historyWindow';
import { sessionFailureNotice, sessionFailureNotices } from './sessionFailureNotice';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const snapshot = { key: 'one', sessionId: '11111111-1111-4111-8111-111111111111', status: 'failed', lastRunId: 'announce:child:failed', lastRunError: 'Native submission binding is no longer current.', endedAt: 1_792_378_722_825 };
const projects = [{ sessionKey: 'one', path: '' }];

describe('session failure transcript receipts', () => {
  it('projects a callback failure even without a currently tracked user run', () => {
    const projected = projectRegisteredGatewayEvent({ event: 'sessions.changed', payload: snapshot }, projects);
    expect(projected?.message).toMatchObject({ role: 'error', state: 'error', sessionKey: 'one', runId: snapshot.lastRunId, timestamp: String(snapshot.endedAt) });
    expect(projected?.message.text).toContain('Background result delivery failed');
    expect(projected?.message.text).toContain(snapshot.lastRunError);
  });

  it('recovers the same identity through a census and repeated updates', () => {
    const live = projectRegisteredGatewayEvent({ event: 'sessions.changed', payload: snapshot }, projects)!.message;
    const recovered = sessionFailureNotices({ sessions: [snapshot] }, projects)[0]!;
    expect(recovered.id).toBe(live.id);
    expect([live, recovered, recovered].reduce(upsertLiveMessage, [] as WorkspaceMessage[])).toHaveLength(1);
  });

  it('shows untracked lifecycle failures without detail and converges with the later snapshot', () => {
    const live = projectRegisteredGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: snapshot.lastRunId, stream: 'lifecycle', data: { phase: 'error' } } }, projects)!.message;
    expect(live).toMatchObject({ role: 'error', state: 'error' });
    const recovered = sessionFailureNotice(snapshot)!;
    const rows = [live, recovered, live, recovered].reduce(upsertLiveMessage, [] as WorkspaceMessage[]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: recovered.text, timestamp: recovered.timestamp, transcriptSessionId: snapshot.sessionId });
  });

  it('retains a timestamped failure across canonical refresh and JSON restoration', () => {
    const notice = sessionFailureNotice(snapshot)!;
    const history: WorkspaceMessage[] = [{ id: 'answer', role: 'assistant', text: 'Release verified', sessionKey: 'one', source: 'history', timestamp: String(snapshot.endedAt - 1000) }];
    const restored = JSON.parse(JSON.stringify([...history, notice]));
    expect(latestHistoryWindow(history, restored, 'one').some(row => row.id === notice.id)).toBe(true);
  });

  it('never borrows selected-session or active-run identity', () => {
    expect(sessionFailureNotice({ ...snapshot, key: undefined })).toBeNull();
    expect(sessionFailureNotices({ sessions: [{ ...snapshot, key: 'hidden' }] }, projects)).toEqual([]);
    const reset = [{ ...projects[0]!, sessionId: '22222222-2222-4222-8222-222222222222' }];
    expect(sessionFailureNotices({ sessions: [snapshot] }, reset)).toEqual([]);
    expect(projectRegisteredGatewayEvent({ event: 'sessions.changed', payload: snapshot }, reset)).toBeNull();
    expect(projectRegisteredGatewayEvent({ event: 'sessions.changed', payload: snapshot }, [{ sessionKey: 'other', path: '' }])).toBeNull();
    expect(sessionFailureNotice({ ...snapshot, status: 'running', hasActiveRun: true })).toBeNull();
    expect(sessionFailureNotice({ ...snapshot, status: 'done' })).toBeNull();
  });

  it('reports missing detail honestly, with a stable terminal identity rather than update time', () => {
    const notice = sessionFailureNotice({ ...snapshot, lastRunId: undefined, lastRunError: undefined })!;
    expect(notice.runId).toBeUndefined();
    expect(notice.text).toContain('did not provide an error detail');
    expect(sessionFailureNotice({ ...snapshot, lastRunId: undefined, lastRunError: undefined, updatedAt: snapshot.endedAt + 3000 })?.id).toBe(notice.id);
    expect(sessionFailureNotice({ ...snapshot, lastRunId: undefined, endedAt: undefined })).toBeNull();
  });

  it('keeps separate failures and generations distinct and bounds untrusted detail', () => {
    const first = sessionFailureNotice(snapshot)!;
    expect(sessionFailureNotice({ ...snapshot, lastRunId: 'another-run' })?.id).not.toBe(first.id);
    expect(sessionFailureNotice({ ...snapshot, sessionId: '22222222-2222-4222-8222-222222222222' })?.id).not.toBe(first.id);
    expect(sessionFailureNotice({ ...snapshot, lastRunError: 'x'.repeat(10000) })!.text.length).toBeLessThan(2200);
  });
});
