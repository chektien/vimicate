import { describe, expect, it } from 'vitest';
import { retainTranscriptRecyclerTopology } from './transcriptRecyclerTopology';

function row(key: string, text: string) { return { key, text }; }

describe('transcript recycler topology', () => {
  it('does not report a structural data update when 480 row keys retain their order', () => {
    const previous = Array.from({ length: 480 }, (_, index) => row(`r${index}`, `before ${index}`));
    const current = previous.map((item, index) => index === 478 ? row(item.key, 'streamed revision') : item);

    expect(retainTranscriptRecyclerTopology(previous, current)).toBe(previous);
  });

  it('reports a structural update for an append, removal, or reordered key', () => {
    const previous = [row('r0', 'zero'), row('r1', 'one')];
    const appended = [...previous, row('r2', 'two')];
    const removed = previous.slice(0, 1);
    const reordered = [previous[1]!, previous[0]!];

    expect(retainTranscriptRecyclerTopology(previous, appended)).toBe(appended);
    expect(retainTranscriptRecyclerTopology(previous, removed)).toBe(removed);
    expect(retainTranscriptRecyclerTopology(previous, reordered)).toBe(reordered);
  });
});
