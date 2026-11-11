import { expect, it, vi } from 'vitest';
import { AsyncQuestionDiscovery, asyncQuestionDiscoveryRows } from './asyncQuestionDiscovery';
import { AsyncQuestionOwner } from '../questions/asyncQuestionOwner';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
const project = (key: string): WorkspaceProject => ({ id: key, sessionKey: key, sessionId: `generation-${key}`, name: key, path: '', branch: '', starred: false, threadCount: 0, state: 'idle', updatedAt: 1 });
const payload = (p: WorkspaceProject) => ({ sessionKey: p.sessionKey, sessionId: p.sessionId, messages: [
  { role: 'assistant', content: 'Review?', openclawAsyncDelivery: { itemId: 'review', questions: [{ title: 'Review?', options: ['Yes', 'Later'] }] }, __openclaw: { id: 'question', runId: 'run' } },
  { role: 'assistant', content: 'Done.', __openclaw: { id: 'final', runId: 'run', runTerminal: true, mirrorOrigin: 'codex-app-server' } },
] });
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const context = () => ({ revision: 'connection1:scene1', owns: () => true });

it('discovers a never-selected question with at most two flights and reuses unchanged census authority', async () => {
  const projects = ['a', 'b', 'c'].map(project); const finish = new Map<string, (value: unknown) => void>();
  const read = vi.fn((key: string) => new Promise(resolve => finish.set(key, resolve))); const owner = new AsyncQuestionOwner();
  const discovery = new AsyncQuestionDiscovery(read, rows => owner.observe(rows));
  discovery.reconcile(projects, context()); await drain(); expect(read.mock.calls.map(([key]) => key)).toEqual(['a', 'b']);
  finish.get('b')!(payload(projects[1]!)); await drain();
  expect([...owner.pendingCounts(() => true)]).toEqual([['b', 1]]); expect(read.mock.calls.map(([key]) => key)).toEqual(['a', 'b', 'c']);
  finish.get('a')!(payload(projects[0]!)); finish.get('c')!(payload(projects[2]!)); await drain();
  discovery.reconcile(projects.map(p => ({ ...p, unread: true })), context()); await drain(); expect(read).toHaveBeenCalledTimes(3);
  discovery.reconcile([{ ...projects[0]!, updatedAt: 2 }, ...projects.slice(1)], context()); await drain();
  expect(read.mock.calls.map(([key]) => key)).toEqual(['a', 'b', 'c', 'a']); discovery.retire(); finish.get('a')!(payload(projects[0]!)); await drain();
});

it('retires late reads and queued work without exceeding the transport bound when resumed', async () => {
  const finish: ((value: unknown) => void)[] = []; const read = vi.fn(() => new Promise(resolve => finish.push(resolve))); const publish = vi.fn();
  const discovery = new AsyncQuestionDiscovery(read, publish); const projects = ['a', 'b', 'c'].map(project);
  discovery.reconcile(projects, context()); await drain(); discovery.retire();
  discovery.reconcile(projects, { revision: 'connection2:scene2', owns: () => true }); await drain(); expect(read).toHaveBeenCalledTimes(2);
  finish[0]!(payload(projects[0]!)); await drain(); expect(publish).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(3);
  discovery.retire(); finish[1]!(payload(projects[1]!)); finish[2]!(payload(projects[0]!)); await drain();
  expect(publish).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(3);
});

it('rejects replaced/removed generation flights and cannot publish a wrong route, generation or malformed snapshot', async () => {
  const p = project('a'); const replacement = { ...p, sessionId: 'new-generation' };
  let finish!: (value: unknown) => void; const read = vi.fn(() => new Promise(resolve => { finish = resolve; })); const publish = vi.fn();
  const discovery = new AsyncQuestionDiscovery(read, publish); discovery.reconcile([p], context()); await drain();
  discovery.reconcile([replacement], context()); finish(payload(p)); await drain(); expect(publish).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(2);
  discovery.reconcile([], context()); finish(payload(replacement)); await drain(); expect(publish).not.toHaveBeenCalled();
  for (const value of [null, {}, { ...payload(p), sessionKey: 'other' }, { ...payload(p), sessionId: 'old' }, { ...payload(p), messages: Array(81).fill({}) }]) expect(asyncQuestionDiscoveryRows(value, p)).toBeNull();
});

it('does not retry failures in a render loop and does retry under fresh authority', async () => {
  const read = vi.fn(async () => { throw new Error('offline'); }); const publish = vi.fn(); const discovery = new AsyncQuestionDiscovery(read, publish);
  discovery.reconcile([project('a')], context()); await drain(); discovery.reconcile([project('a')], context()); await drain();
  expect(read).toHaveBeenCalledOnce(); expect(publish).not.toHaveBeenCalled();
  discovery.retire(); discovery.reconcile([project('a')], context()); await drain(); expect(read).toHaveBeenCalledTimes(2); discovery.retire();
});

it('never reads a retired admission or creates a question from ordinary prose', async () => {
  const read = vi.fn(); const publish = vi.fn(); const discovery = new AsyncQuestionDiscovery(read, publish);
  discovery.reconcile([project('a')], context()); discovery.retire(); await drain(); expect(read).not.toHaveBeenCalled();
  const p = project('a'); const owner = new AsyncQuestionOwner();
  owner.observe(asyncQuestionDiscoveryRows({ ...payload(p), messages: [{ role: 'assistant', content: 'Do you approve?' }] }, p)!);
  expect([...owner.pendingCounts(() => true)]).toEqual([]);
});

it('skips the selected transcript without forgetting completed offscreen discovery on selection changes', async () => {
  const a = project('a'), b = project('b'); const read = vi.fn(async (key: string) => payload(key === 'a' ? a : b));
  const discovery = new AsyncQuestionDiscovery(read, () => {});
  discovery.reconcile([a, b], { ...context(), selectedSessionKey: 'a' }); await drain();
  expect(read.mock.calls.map(([key]) => key)).toEqual(['b']);
  discovery.reconcile([a, b], { ...context(), selectedSessionKey: 'b' }); await drain();
  expect(read.mock.calls.map(([key]) => key)).toEqual(['b', 'a']);
  discovery.reconcile([a, b], { ...context(), selectedSessionKey: 'a' }); await drain();
  discovery.reconcile([a, b], { ...context(), selectedSessionKey: 'b' }); await drain();
  expect(read).toHaveBeenCalledTimes(2); discovery.retire();
});
