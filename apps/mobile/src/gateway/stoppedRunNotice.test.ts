import { expect, it } from 'vitest';
import { SessionRunRegistry } from './sessionRunRegistry';
import { sessionFailureNotice } from './sessionFailureNotice';
import { stoppedRunNotices } from './stoppedRunNotice';
import { upsertLiveMessage } from './gatewayEventProjection';

const notice = () => sessionFailureNotice({ sessionKey: 'thread', lastRunId: 'old', status: 'failed', lastRunError: 'agent run aborted', endedAt: 1234 })!;
it.each(['before', 'after'])('presents only a confirmed requested stop neutrally when terminal arrives %s receipt', order => {
  const registry = new SessionRunRegistry(); registry.registerRun('thread', 'old');
  const settle = registry.beginStopRequest('thread', 'old');
  const failure = notice(); let rows = [failure];
  if (order === 'before') {
    registry.observePhase('thread', 'failed', 'old');
    expect(stoppedRunNotices(rows, registry)).toBe(rows);
  }
  settle(true);
  rows = stoppedRunNotices(rows, registry);
  expect(rows[0]).toMatchObject({ id: failure.id, runId: 'old', timestamp: '1234', role: 'command', state: 'complete', text: 'Run stopped at your request.' });
  rows = stoppedRunNotices(upsertLiveMessage(rows, failure), registry);
  expect(rows).toHaveLength(1); expect(rows[0]?.role).toBe('command');
});
it('keeps late stop receipts scoped to the predecessor and leaves successor errors intact', () => {
  const registry = new SessionRunRegistry(); registry.registerRun('thread', 'old');
  const settle = registry.beginStopRequest('thread', 'old'); registry.registerRun('thread', 'next'); settle(true);
  expect(registry.runFor('thread')).toBe('next');
  const failure = notice();
  const rows = stoppedRunNotices([failure, { ...failure, id: 'session-failure:next', runId: 'next' }], registry);
  expect(rows[0]?.role).toBe('command'); expect(rows[1]?.role).toBe('error');
});
it('does not hide unrelated provider errors, unconfirmed aborts or prose mentioning aborts', () => {
  const registry = new SessionRunRegistry(); registry.registerRun('thread', 'old');
  const failure = notice(); const rows = [failure];
  registry.beginStopRequest('thread', 'old')(false);
  expect(stoppedRunNotices(rows, registry)).toBe(rows);
  registry.beginStopRequest('thread', 'old')(true);
  for (const patch of [{ text: 'Run failed · provider crashed' }, { text: 'Run failed · agent run aborted while saving corrupted output' },
    { role: 'assistant' as const }, { sessionKey: 'other' }, { id: 'tool-result' }]) {
    const current = [{ ...failure, ...patch }]; expect(stoppedRunNotices(current, registry)).toBe(current);
  }
});
it('does not manufacture confirmation for a run not owned when Stop was requested', () => {
  const registry = new SessionRunRegistry(); registry.registerRun('thread', 'next');
  registry.beginStopRequest('thread', 'old')(true);
  expect(registry.stopWasConfirmed('thread', 'old')).toBe(false);
});

it('retains a bounded set of consecutive confirmed stops and clears them with registry disposal', () => {
  const registry = new SessionRunRegistry();
  for (let i = 0; i < 33; i++) {
    registry.registerRun('thread', `run-${i}`);
    registry.beginStopRequest('thread', `run-${i}`)(true);
  }
  expect(registry.stopWasConfirmed('thread', 'run-0')).toBe(false);
  const rows = [1, 32].map(i => ({ ...notice(), runId: `run-${i}`, id: `session-failure:run-${i}` }));
  expect(stoppedRunNotices(rows, registry).map(row => row.role)).toEqual(['command', 'command']);
  registry.clear(); expect(stoppedRunNotices(rows, registry)).toBe(rows);
});
