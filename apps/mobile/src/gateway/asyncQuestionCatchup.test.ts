import { expect, it, vi } from 'vitest';
import { AsyncQuestionDiscovery, asyncQuestionDiscoveryRows } from './asyncQuestionDiscovery';
import { AsyncQuestionOwner } from '../questions/asyncQuestionOwner';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
const p: WorkspaceProject = { id: 'a', sessionKey: 'a', sessionId: '00000000-0000-4000-8000-000000000001', name: 'A', path: '', branch: '', starred: false, threadCount: 0, state: 'idle' };
const question = (id: string) => ({ role: 'assistant', content: 'Review?', openclawAsyncDelivery: { itemId: id, questions: [{ title: 'Review?', options: ['Yes', 'Later'] }] }, __openclaw: { id, runId: id } });
const answer = { role: 'user', content: '> Review?\n\nYes', __openclaw: { id: 'answer', runId: 'reply', replyToId: 'old' } };
const page = (offset: number, messages: unknown[], more: boolean, total = 240) => ({ sessionKey: 'a', sessionId: '00000000-0000-4000-8000-000000000001', offset, totalMessages: total, messages, hasMore: more, ...(more ? { nextOffset: offset + 80 } : {}) });
const context = () => ({ revision: 'scene:connection', owns: () => true, selectedSessionKey: 'a', catchupSessions: new Set(['a']) });
const drain = async () => { for (let i=0;i<100;i++) await Promise.resolve(); };
it('catches up a selected restored card when its saved answer and question occupy separate older pages', async () => {
 const original = new AsyncQuestionOwner(); const old = asyncQuestionDiscoveryRows(page(0,[question('old')],false),p)!;original.observe(old);
 const owner = new AsyncQuestionOwner();owner.restore(original.serialize());owner.observe(old);
 const pages = [page(0,[],true),page(80,[answer],true),page(160,[question('old'),question('unanswered')],false)];
 const read=vi.fn(async (_key: string, offset=0)=>pages[offset/80]);const discovery=new AsyncQuestionDiscovery(read,rows=>owner.observe(rows));
 discovery.reconcile([p],context());await drain();
 expect(read.mock.calls.map(args=>args[1])).toEqual([0,80,160]);
 expect(owner.view(old[0]!)?.state).toBe('confirmed');expect([...owner.pendingCounts(()=>true)]).toEqual([['a',1]]);
 discovery.reconcile([p],context());await drain();expect(read).toHaveBeenCalledTimes(3);discovery.retire();
});
it('rejects moving offsets, totals, routes and generations without publishing mixed history', async () => {
 for (const change of [{offset:0},{totalMessages:241},{sessionKey:'other'},{sessionId:'replacement'}]) {
  const read=vi.fn(async (_key:string,offset=0)=>offset===0?page(0,[],true):({...page(80,[answer],false),...change}));const publish=vi.fn();const discovery=new AsyncQuestionDiscovery(read,publish);
  discovery.reconcile([p],context());await drain();expect(publish).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(2);discovery.retire();
 }
});
it('bounds traversal and retains an unanswered question when coverage ends before its answer', async () => {
 const owner=new AsyncQuestionOwner();const old=asyncQuestionDiscoveryRows(page(0,[question('old')],false),p)!;owner.observe(old);
 const read=vi.fn(async (_key:string,offset=0)=>page(offset,[],true,8000));const discovery=new AsyncQuestionDiscovery(read,rows=>owner.observe(rows));
 discovery.reconcile([p],context());await drain();expect(read).toHaveBeenCalledTimes(16);expect(owner.view(old[0]!)?.state).toBe('pending');discovery.retire();
});
it('cannot publish a catchup page after generation replacement or scene retirement', async () => {
 let finish!: (value:unknown)=>void;const read=vi.fn((_key:string,offset=0)=>offset===0?Promise.resolve(page(0,[],true)):new Promise(resolve=>{finish=resolve;}));const publish=vi.fn();const discovery=new AsyncQuestionDiscovery(read,publish);
 discovery.reconcile([p],context());await drain();discovery.retire();finish(page(80,[answer],false));await drain();expect(publish).not.toHaveBeenCalled();
});

it('follows witnessed raw-record offsets rather than deriving them from the projected page length', async () => {
 const read=vi.fn(async (_key:string,offset=0)=>offset===0?{...page(0,[],true,1000),nextOffset:700}:page(700,[answer],false,1000));const publish=vi.fn();const discovery=new AsyncQuestionDiscovery(read,publish);
 discovery.reconcile([p],context());await drain();expect(read.mock.calls.map(args=>args[1])).toEqual([0,700]);expect(publish).toHaveBeenCalledOnce();discovery.retire();
});

it('retains causal witnesses without letting unrelated assistant output exhaust the evidence budget', async () => {
 const large = Array.from({ length: 24 }, (_, i) => ({ role: 'assistant', content: 'x'.repeat(100_000), __openclaw: { id: `large-${i}`, runId: 'origin' } }));
 const read = vi.fn(async (_key: string, offset = 0) => offset === 0 ? page(0, large, true) : page(80, [answer], false));
 const publish = vi.fn(); const discovery = new AsyncQuestionDiscovery(read, publish);
 discovery.reconcile([p], context()); await drain();
 expect(read.mock.calls.map(args => args[1])).toEqual([0, 80]); expect(publish).toHaveBeenCalledOnce();
 expect(publish.mock.calls[0]![0].filter((row: { role: string }) => row.role === 'assistant').every((row: { text: string; runId: string }) => row.text === '' && row.runId === 'origin')).toBe(true);
 discovery.retire();
});

it('uses generation-filtered restored facts only for catchup, not visible pending counts', () => {
 const old = asyncQuestionDiscoveryRows(page(0, [question('old')], false), p)!;
 const original = new AsyncQuestionOwner(); original.observe(old);
 const owner = new AsyncQuestionOwner(); owner.restore(original.serialize());
 expect([...owner.pendingCounts(() => true)]).toEqual([]);
 expect([...owner.catchupSessions(row => row.transcriptSessionId === p.sessionId)]).toEqual(['a']);
 expect([...owner.catchupSessions(row => row.transcriptSessionId === 'replacement')]).toEqual([]);
 owner.observe(asyncQuestionDiscoveryRows(page(0, [answer], false), p)!);
 expect([...owner.catchupSessions(() => true)]).toEqual([]);
});
