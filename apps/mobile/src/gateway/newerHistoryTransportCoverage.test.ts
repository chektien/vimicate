import { expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { loadVisibleNewerHistoryBatch } from './loadVisibleNewerHistoryBatch';

it.each(['current', 'archived'] as const)('does not skip unread byte-capped %s raw pages when moving forward', async (kind) => {
  const key = 'byte-capped-forward';
  const total = 1000;
  const row = (i: number): WorkspaceMessage => ({id:`r${i}`,role:'user',text:`Message ${i}`,source:'history',sessionKey:key});
  const history = vi.fn(async (_key:string, limit:number, offset:number) => {
    const count = Math.min(10,limit,total-offset);
    const next = offset+count;
    return {sessionKey:key,offset,totalMessages:total,hasMore:next<total,nextOffset:next<total?next:null,
      messages:Array.from({length:count},(_,i)=>({...row(total-next+i),content:row(total-next+i).text}))};
  });
  const client={history,decorateMessages:(rows:WorkspaceMessage[])=>rows} as unknown as OpenClawClient;
  const id = '00000000-0000-4000-8000-000000000001';
  const current = '00000000-0000-4000-8000-000000000002';
  const old = {sessionId:id,order:0,state:'archived' as const,sourceRevision:'immutable'};
  const archive = kind === 'archived' ? {identity:{sessionKey:key,currentSessionId:current,currentSessionStartedAtMs:200,contract:'sqlite-family-v1' as const},familyToken:'family',segments:[old,{sessionId:current,order:1,state:'current' as const,sourceRevision:'current'}],nextArchivedIndex:0,exhausted:false,pageCursor:{segmentIndex:0,nextOffset:901,totalRawRecords:total}} : null;
  client.archivedHistoryRequest = async params => ({...await history(key,params.limit as number,params.offset as number),contract:'sqlite-family-v1',proof:'verified-import+sqlite-ownership-v1',stableSessionKey:key,currentSessionId:current,currentSessionStartedAtMs:200,familyToken:'family',sessionId:id,segment:old});
  const input={client,sessionKey:key,path:'',archive,context:{},owns:()=>true,
    cursor:{sessionKey:key,nextOffset:901,totalMessages:total,hasMore:true},visible:[kind === 'archived' ? {...row(99),id:`archive:${id}:r99`,transcriptSessionId:id} : row(99)]};
  let scan = null as Awaited<ReturnType<typeof loadVisibleNewerHistoryBatch>>['scan'];
  let newer:WorkspaceMessage[]=[];
  for(let request=0;request<5 && !newer.length;request++) {
    const batch=await loadVisibleNewerHistoryBatch({...input,scan});scan=batch.scan;newer=batch.newer;
  }
  expect(newer.length).toBeGreaterThan(0);
  expect(newer[0]?.id).toBe(kind === 'archived' ? `archive:${id}:r100` : 'r100');
  expect(newer.map(row=>Number(row.id.split(':').at(-1)!.slice(1)))).toEqual(Array.from({length:newer.length},(_,i)=>100+i));
});
