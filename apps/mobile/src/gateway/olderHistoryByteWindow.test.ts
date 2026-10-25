import { expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
import { olderHistoryWindow } from './historyWindow';
import { olderReviewBytes, OLDER_REVIEW_BYTE_LIMIT } from './olderHistoryVisibleRows';
import { loadVisibleOlderHistoryBatch } from './loadVisibleOlderHistoryBatch';
import { olderPageHistoryPublication } from './historyReviewPublication';

const key = 'byte-window';
const tool = (id: string): WorkspaceMessage => ({ id, role: 'tool', text: 'x'.repeat(20_000), sessionKey: key, source: 'history' });

it('evicts the newer suffix at the byte ceiling even when folded row cost fits', () => {
  const rows = Array.from({length: 150}, (_, i) => tool(String(i)));
  const window = olderHistoryWindow([], rows, key, 2048, '2');
  expect(window.slice(0,3).map(row => row.id)).toEqual(['0','1','2']);
  expect(window.length).toBeLessThan(rows.length);
  expect(olderReviewBytes(window)).toBeLessThanOrEqual(OLDER_REVIEW_BYTE_LIMIT);
});

it('loads through a folded continuation from a byte-full review instead of advancing one record per click', async () => {
  const visible = Array.from({length: 104}, (_, i) => tool(`visible-${i}`));
  const raw = [{ id:'earlier-answer', role:'assistant', content:'Earlier conversation' },
    ...Array.from({length: 20}, (_, i) => ({id:`older-${i}`,role:'tool',content:'y'.repeat(20_000)}))];
  const history = vi.fn(async (_key: string, limit: number, offset: number) => {
    const end = raw.length - offset;
    const messages = raw.slice(Math.max(0,end-limit),end);
    const next = offset + messages.length;
    return {sessionKey:key,messages,hasMore:next<raw.length,nextOffset:next<raw.length?next:null,totalMessages:raw.length};
  });
  const client = {history,decorateMessages:(rows:WorkspaceMessage[])=>rows} as unknown as OpenClawClient;
  const result = await loadVisibleOlderHistoryBatch({client,sessionKey:key,path:'',visible,narration:[],archive:null,
    cursor:{sessionKey:key,hasMore:true,nextOffset:1,totalMessages:raw.length},context:{},owns:()=>true});
  expect(result.older.some(row=>row.id==='earlier-answer')).toBe(true);
  expect(result.cursor?.hasMore).toBe(false);
  expect(history).toHaveBeenCalledOnce();
  const published = olderPageHistoryPublication(visible,[],result.older,key,[],true,2048).visible;
  expect(published.some(row=>row.id===visible[0]!.id)).toBe(true);
  expect(olderReviewBytes(published)).toBeLessThanOrEqual(OLDER_REVIEW_BYTE_LIMIT);
});
