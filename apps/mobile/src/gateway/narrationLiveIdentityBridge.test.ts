import { expect, it } from 'vitest';
import { mergeLatestHistory } from './historyPagination';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const live: WorkspaceMessage = { id: 'live-item-run-item', role: 'narration', source: 'live', sessionKey: 'one', runId: 'run', text: 'progress' };
const canonical: WorkspaceMessage = { ...live, id: 'native-narration:generation:item', source: 'history', transcriptSessionId: 'generation', narrationItemId: 'item', displayPosition: { source: 'sqlite', rawSeq: 20 } };

it('joins the exact unhydrated live item to its canonical narration on latest refresh and late replay', () => {
  let rows = mergeLatestHistory([canonical], [live], 'one');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ transcriptSessionId: 'generation', narrationItemId: 'item', displayPosition: canonical.displayPosition });
  rows = coalesceTranscriptIdentities([...rows, live]);
  expect(rows).toHaveLength(1);
});
it('never bridges another run, session, explicit generation or contradictory item', () => {
  for (const different of [
    { ...live, runId: 'other' }, { ...live, sessionKey: 'other' },
    { ...live, transcriptSessionId: 'other' }, { ...live, narrationItemId: 'other' },
    { ...live, id: 'unrelated-live-id' },
  ]) expect(coalesceTranscriptIdentities([canonical, different])).toHaveLength(2);
});
it('does not infer a generation if the same live alias has conflicting canonical owners', () => {
  const another = { ...canonical, id: 'native-narration:other:item', transcriptSessionId: 'other' };
  expect(coalesceTranscriptIdentities([canonical, another, live])).toHaveLength(3);
});
