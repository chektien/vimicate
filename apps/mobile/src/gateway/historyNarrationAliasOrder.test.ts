import { expect, it } from 'vitest';
import { mergeLatestHistory } from './historyPagination';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const sessionKey = 'thread';
const canonical = (item: string, seq: number, generation = 'generation'): WorkspaceMessage => ({
  id: `native-narration:${generation}:${item}`, role: 'narration', source: 'history',
  sessionKey, transcriptSessionId: generation, narrationItemId: item, text: item,
  timestamp: String(1_700_000_000_000 + seq), displayPosition: { source: generation, rawSeq: seq },
});
const page = [canonical('published', 6673), canonical('verified', 6698), canonical('later', 6715)];
const alias = { ...page[2]!, id: 'live-item-run-later' };

it('replaces a retained narration alias at its canonical page position, including a polluted cache', () => {
  let current = [alias, ...page.slice(0, 2)];
  for (let refresh = 0; refresh < 3; refresh++) {
    current = mergeLatestHistory(page, current, sessionKey);
    expect(current.map(row => row.text)).toEqual(['published', 'verified', 'later']);
    expect(current.map(row => row.displayPosition?.rawSeq)).toEqual([6673, 6698, 6715]);
    expect(current[2]?.id).toBe(alias.id);
  }
});
it('retains an older out-of-page narration and does not alias equal text from another item or generation', () => {
  const older = canonical('older', 6600);
  const otherItem = { ...canonical('other-item', 6670), text: 'later' };
  const otherGeneration = canonical('later', 10, 'previous-generation');
  const merged = mergeLatestHistory(page, [otherGeneration, older, otherItem, alias], sessionKey);
  expect(merged).toHaveLength(6);
  expect(merged).toContainEqual(otherGeneration);
  expect(merged).toContainEqual(older);
  expect(merged).toContainEqual(otherItem);
  expect(merged.filter(row => row.narrationItemId === 'later' && row.transcriptSessionId === 'generation')).toHaveLength(1);
});
