import { expect, it } from 'vitest';
import { HistoryPublicationReceiptOwner } from './historyPublicationReceipt';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const row = (id: string, text = id): WorkspaceMessage => ({ id, role: 'assistant', text });

it('waits for the matching React publication commit, not transport completion', async () => {
  const owner = new HistoryPublicationReceiptOwner();
  const ticket = owner.stage([row('top')], () => true);
  let settled = false; void ticket.publication.then(() => { settled = true; });
  owner.commit(ticket.revision - 1, [row('top')]);
  await Promise.resolve(); expect(settled).toBe(false);
  owner.commit(ticket.revision, [row('older'), row('top')]);
  await expect(ticket.publication).resolves.toEqual({ committed: true, published: true, addedMessageCount: 1 });
});
it('recognizes extensions of a stable identity as loaded history', async () => {
  const owner = new HistoryPublicationReceiptOwner();
  const ticket = owner.stage([row('tool', 'partial')], () => true);
  owner.commit(ticket.revision, [row('tool', 'partial\nolder detail')]);
  await expect(ticket.publication).resolves.toEqual({ committed: true, published: true, addedMessageCount: 0 });
});
it('settles a genuine no-op only on commit', async () => {
  const owner = new HistoryPublicationReceiptOwner();
  const ticket = owner.stage([row('top')], () => true);
  owner.commit(ticket.revision, [row('top')]);
  await expect(ticket.publication).resolves.toEqual({ committed: true, published: false, addedMessageCount: 0 });
});
it.each(['authority', 'unmount', 'superseded'])('retires a receipt on %s without leaking its waiter', async (reason) => {
  const owner = new HistoryPublicationReceiptOwner(); let owns = true;
  const ticket = owner.stage([row('top')], () => owns);
  if (reason === 'authority') { owns = false; owner.commit(ticket.revision, [row('older')]); }
  else if (reason === 'unmount') owner.retire();
  else { const second = owner.stage([row('top')], () => true); owner.retire(); await second.publication; }
  await expect(ticket.publication).resolves.toEqual({ committed: false, published: false, addedMessageCount: 0 });
});
