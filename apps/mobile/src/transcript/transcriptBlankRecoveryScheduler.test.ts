import { expect, it } from 'vitest';
import { TranscriptBlankRecoveryScheduler } from './transcriptBlankRecoveryScheduler';
import { createTranscriptViewportDiagnostics } from './transcriptViewportDiagnostics';

it('records pending work and schedule status, then restores the tail range from current state', () => {
  const frames: Array<() => void> = [];
  const lines: string[] = [];
  const recovered: number[] = [];
  const scheduler = new TranscriptBlankRecoveryScheduler((callback) => { frames.push(callback); return frames.length; }, () => {});
  const diagnostics = createTranscriptViewportDiagnostics('private', (line) => lines.push(line), () => 5_000);
  let itemCount = 4;
  let postLayout: number | null = 1;
  const input = {
    datasetKey: 'private', generation: 'revision', ownsGeneration: (key: unknown) => key === 'revision',
    snapshot: () => ({ userScrollActive: false, pendingDatasetReset: false,
      writers: { tail: null, indexed: null, revision: null, postLayout, reviewRestore: false, olderHistory: false },
      itemCount, hasMountedVisibleCells: false, contentHeight: 800, viewportHeight: 400, offset: 350,
      followTail: true, visible: { first: 0, last: 2 } }),
    record: diagnostics.record, diagnosticFields: () => ({ itemCount, first: 0, last: 2 }),
    recoverTailRange: (row: number) => recovered.push(row), recoverBlank: () => { throw new Error('unexpected blank recovery'); },
  };
  scheduler.schedule(input);
  scheduler.schedule(input);
  expect(lines.filter(line => line.startsWith('blank-schedule'))).toEqual([
    expect.stringContaining('n=4 o=350 h=800 vh=400 block=queued'),
    expect.stringContaining('n=4 o=350 h=800 vh=400 block=pending'),
  ]);
  frames.shift()?.();
  postLayout = null;
  itemCount = 5;
  frames.shift()?.();
  expect(lines).toContainEqual(expect.stringContaining('blank-check ds='));
  expect(lines.find(line => line.startsWith('blank-check'))).toContain('n=5 o=350 h=800 vh=400 drag=0 reset=0 mounted=0 work=none block=none');
  expect(lines.find(line => line.startsWith('partial-content'))).toContain('n=5 v=0-2 why=recovery');
  expect(recovered).toEqual([4]);
  scheduler.schedule(input);
  expect(lines.at(-1)).toContain('block=attempted');
});

it('does not restore a partial tail while an older-history anchor owns the viewport', () => {
  const frames: Array<() => void> = [];
  const recovered: number[] = [];
  const scheduler = new TranscriptBlankRecoveryScheduler((callback) => { frames.push(callback); return frames.length; }, () => {});
  scheduler.schedule({
    datasetKey: 'review', generation: 'prepend', ownsGeneration: () => true,
    snapshot: () => ({ userScrollActive: false, pendingDatasetReset: false,
      writers: { tail: null, indexed: null, revision: null, postLayout: null, reviewRestore: false, olderHistory: true },
      itemCount: 50, hasMountedVisibleCells: true, contentHeight: 4000, viewportHeight: 400, offset: 500,
      followTail: true, visible: { first: 5, last: 10 } }),
    record: () => {}, diagnosticFields: () => ({}),
    recoverTailRange: (row) => recovered.push(row), recoverBlank: () => { throw new Error('unexpected blank recovery'); },
  });
  frames.shift()?.();
  frames.shift()?.();
  expect(recovered).toEqual([]);
});
