import { describe, expect, it } from 'vitest';
import { historyDisplayOrder } from './historyDisplayOrder';
import { nativeTranscriptMetadata, nativeTranscriptMedia, transcriptDisplayPosition, transcriptSessionIdentity, type TranscriptDisplayPosition } from './transcriptMetadata';

type Row = { id: string; timestamp?: string; displayPosition?: TranscriptDisplayPosition };
const row = (id: string, rawSeq: number, activity?: TranscriptDisplayPosition['activity'], source = 'one'): Row => ({
  id, timestamp: String(100 - rawSeq), displayPosition: { source, rawSeq, ...(activity ? { activity } : {}) },
});
const activity = (id: string, rawSeq: number, afterRawSeq: number | null, scopeId = 'run', startOrder = 0) => row(id, rawSeq, { afterRawSeq, scopeId, startOrder });
const order = (rows: Row[]) => historyDisplayOrder(rows, () => true);
const ids = (rows: Row[]) => rows.map((value) => value.id);

describe('history display order owner', () => {
  it('repositions late activity without sorting stable records by timestamp', () => {
    expect(ids(order([row('prompt', 1), row('answer', 2), activity('checking', 3, 1)])))
      .toEqual(['prompt', 'checking', 'answer']);
  });

  it('keeps run cohorts together, ordered by their first physical record then start order', () => {
    const rows = [row('prompt', 1), row('answer', 2), activity('a-late', 4, 1, 'a', 2),
      activity('b', 5, 1, 'b'), activity('a-early', 6, 1, 'a', 1)];
    expect(ids(order(rows))).toEqual(['prompt', 'a-early', 'a-late', 'b', 'answer']);
  });

  it('supports leading activity, missing paginated anchors and all-activity pages', () => {
    expect(ids(order([row('answer', 8), activity('leading', 9, null), activity('partial', 10, 4)])))
      .toEqual(['leading', 'partial', 'answer']);
    expect(ids(order([activity('later', 8, 4, 'run', 2), activity('earlier', 9, 4, 'run', 1)])))
      .toEqual(['earlier', 'later']);
  });

  it('does not cross unpositioned or different-source barriers', () => {
    const rows = [row('first', 1), { id: 'boundary' }, activity('late', 4, null), row('other', 0, undefined, 'two')];
    expect(order(rows)).toBe(rows);
  });

  it('fails conservatively if stable physical coordinates are already non-monotonic', () => {
    const rows = [row('second', 2), row('first', 1), activity('late', 4, 1)];
    expect(order(rows)).toBe(rows);
  });

  it('preserves legacy timestamp slots, stable equal timestamps and ineligible rows', () => {
    const rows: Row[] = [{ id: 'late', timestamp: '3' }, { id: 'untimed' }, { id: 'fixed', timestamp: '0' },
      { id: 'early-a', timestamp: '1' }, { id: 'early-b', timestamp: '1' }];
    expect(ids(historyDisplayOrder(rows, (value) => value.id !== 'fixed')))
      .toEqual(['early-a', 'untimed', 'fixed', 'early-b', 'late']);
  });

  it('is idempotent and retains original row references', () => {
    const rows = [row('prompt', 1), row('answer', 2), activity('checking', 3, 1)];
    const composed = order(rows);
    expect(order(composed)).toBe(composed);
    expect(composed[1]).toBe(rows[2]);
  });
});

describe('untrusted transcript metadata', () => {
  it.each([
    null, [], {}, { source: '', rawSeq: 1 }, { source: 's'.repeat(129), rawSeq: 1 },
    { source: 'one', rawSeq: -1 }, { source: 'one', rawSeq: 1.5 }, { source: 'one', rawSeq: Infinity },
    { source: 'one', rawSeq: Number.MAX_SAFE_INTEGER + 1 },
    { source: 'one', rawSeq: 3, activity: null },
    { source: 'one', rawSeq: 3, activity: { afterRawSeq: 3, scopeId: 'run', startOrder: 0 } },
    { source: 'one', rawSeq: 3, activity: { afterRawSeq: -1, scopeId: 'run', startOrder: 0 } },
    { source: 'one', rawSeq: 3, activity: { afterRawSeq: 1, scopeId: '', startOrder: 0 } },
    { source: 'one', rawSeq: 3, activity: { afterRawSeq: 1, scopeId: 's'.repeat(1025), startOrder: 0 } },
    { source: 'one', rawSeq: 3, activity: { afterRawSeq: 1, scopeId: 'run', startOrder: -1 } },
  ])('rejects malformed placement %#', (value) => {
    expect(transcriptDisplayPosition(value)).toBeUndefined();
  });

  it('retains only placement fields and rejects unbounded native identities', () => {
    expect(nativeTranscriptMetadata({ __openclaw: {
      id: 'x'.repeat(513), idempotencyKey: {}, runId: 'r'.repeat(257),
      transcriptPosition: { source: 'one', rawSeq: 0, runId: 'not-authority' },
    } })).toEqual({ id: '', idempotencyKey: '', runId: '', displayPosition: { source: 'one', rawSeq: 0 } });
  });

  it('reads the run identity the Gateway sends, and only from its own field', () => {
    // A placement descriptor is not run authority; the message's own metadata is.
    expect(nativeTranscriptMetadata({ __openclaw: {
      runId: 'run-77', transcriptPosition: { source: 'one', rawSeq: 0, runId: 'not-authority' },
    } })).toMatchObject({ runId: 'run-77' });
    expect(nativeTranscriptMetadata({ __openclaw: { transcriptPosition: { source: 'one', rawSeq: 0, runId: 'not-authority' } } }))
      .toMatchObject({ runId: '' });
  });

  it('accepts concrete UUIDs but never infers an identity from a route or path', () => {
    expect(transcriptSessionIdentity('00000000-0000-4000-A000-000000000127')).toBe('00000000-0000-4000-a000-000000000127');
    expect(transcriptSessionIdentity('agent:main:fixture')).toBeUndefined();
    expect(transcriptSessionIdentity('/tmp/session.jsonl')).toBeUndefined();
  });

  it('bounds native media and never promotes arbitrary text or nested instructions', () => {
    expect(nativeTranscriptMedia({ __openclaw: { media: ['image /tmp/file.png', null, { path: [] }, { text: '/tmp/file.png' }] } })).toEqual([]);
    expect(nativeTranscriptMedia({ __openclaw: { media: Array.from({ length: 1025 }, () => ({ path: '/tmp/file.png' })) } })).toEqual([]);
    expect(nativeTranscriptMedia({ __openclaw: { media: [{ path: '/tmp/file.png', kind: 'image', nested: { text: 'not media' } }] } }))
      .toEqual([{ type: 'image', path: '/tmp/file.png' }]);
    expect(nativeTranscriptMedia({ __openclaw: { media: [{
      url: 'media://inbound/report.png', kind: 'image', contentType: 'image/png',
      sizeBytes: 417975, width: 1179, height: 2556,
    }] } })).toEqual([{
      type: 'image', url: 'media://inbound/report.png', contentType: 'image/png',
      sizeBytes: 417975, width: 1179, height: 2556,
    }]);
    expect(nativeTranscriptMedia({ __openclaw: { media: [{
      path: '/tmp/file.png', sizeBytes: -1, width: Number.NaN, height: 0,
    }] } })).toEqual([{ type: 'media', path: '/tmp/file.png' }]);
  });
});
