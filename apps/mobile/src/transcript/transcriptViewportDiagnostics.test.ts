import { describe, expect, it } from 'vitest';
import { createTranscriptViewportDiagnostics, transcriptBlankViewportDecline } from './transcriptViewportDiagnostics';

describe('transcript viewport diagnostics', () => {
  it('emits only opaque correlation and numeric viewport state', () => {
    const events: string[] = [];
    const recorder = createTranscriptViewportDiagnostics('session:example slides:/Users/fixture/private', (message) => events.push(message), () => 10);
    recorder.record('reveal', { sourceCursor: 20_001, renderCursor: 99, requested: 99, target: 98, itemCount: 100, first: 80, last: 90, tail: false, reason: 'navigation' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatch(/^reveal ds=[0-9a-f]{8} s=20001 r=99 q=99 t=98 n=100 v=80-90 f=0 why=navigation$/);
    expect(events[0]).not.toContain('example slides');
    expect(events[0]).not.toContain('/Users/fixture');
    expect(events[0]).not.toContain('session:');
  });

  it('rate limits held-key samples but permits forced intent transitions', () => {
    let time = 1_000;
    const events: string[] = [];
    const recorder = createTranscriptViewportDiagnostics('dataset', (message) => events.push(message), () => time);
    expect(recorder.record('reveal', { sourceCursor: 1 })).toBe(true);
    time += 20;
    expect(recorder.record('reveal', { sourceCursor: 2 })).toBe(false);
    expect(recorder.record('mode', { tail: false, reason: 'drag' }, true)).toBe(true);
    time += 250;
    expect(recorder.record('reveal', { sourceCursor: 3 })).toBe(true);
    expect(events).toHaveLength(3);
  });

  it('deduplicates repeated off-content anomalies for one second', () => {
    let time = 5_000;
    const events: string[] = [];
    const recorder = createTranscriptViewportDiagnostics('dataset', (message) => events.push(message), () => time);
    expect(recorder.record('off-content', { offset: 800, contentHeight: 500, viewportHeight: 200 })).toBe(true);
    time += 999;
    expect(recorder.record('off-content', { offset: 800, contentHeight: 500, viewportHeight: 200 })).toBe(false);
    time += 1;
    expect(recorder.record('off-content', { offset: 800, contentHeight: 500, viewportHeight: 200 })).toBe(true);
  });

  it('records a content-backed blank viewport without transcript data', () => {
    const events: string[] = [];
    const recorder = createTranscriptViewportDiagnostics('private-session', (message) => events.push(message), () => 5_000);
    expect(recorder.record('blank-content', { itemCount: 120, first: null, last: null, contentHeight: 4_800, viewportHeight: 720 }, true)).toBe(true);
    expect(events).toEqual([expect.stringMatching(/^blank-content ds=[0-9a-f]{8} n=120 v=none h=4800 vh=720$/)]);
    expect(events[0]).not.toContain('private-session');
  });

  it('records stale cross-dataset writer rejection without transcript content', () => {
    const events: string[] = [];
    const recorder = createTranscriptViewportDiagnostics('session-b', (message) => events.push(message), () => 10);
    recorder.record('writer', { action: 'drop-tail', reason: 'dataset' }, true);
    expect(events).toEqual([expect.stringMatching(/^writer ds=[0-9a-f]{8} act=drop-tail why=dataset$/)]);
  });
});

it('records the first declined blank guard with every decision input and writer', () => {
  const events: string[] = [];
  const recorder = createTranscriptViewportDiagnostics('private', (line) => events.push(line), () => 5_000);
  const state = { userScrollActive: false, pendingDatasetReset: true, viewportWorkPending: true,
    itemCount: 90, hasMountedVisibleCells: false, contentHeight: 3_000, viewportHeight: 600 };
  recorder.record('blank-check', { userScroll: state.userScrollActive, reset: state.pendingDatasetReset,
    work: 'post-layout', itemCount: state.itemCount, mounted: state.hasMountedVisibleCells,
    contentHeight: state.contentHeight, viewportHeight: state.viewportHeight,
    block: transcriptBlankViewportDecline(state) ?? 'none' });
  expect(events[0]).toContain('n=90');
  expect(events[0]).toContain('h=3000 vh=600');
  expect(events[0]).toContain('drag=0 reset=1 mounted=0 work=post-layout block=pendingDatasetReset');
  expect(transcriptBlankViewportDecline({ ...state, pendingDatasetReset: false })).toBe('viewportWorkPending');
  expect(transcriptBlankViewportDecline({ ...state, userScrollActive: true })).toBe('userScrollActive');
  expect(transcriptBlankViewportDecline({ ...state, pendingDatasetReset: false, viewportWorkPending: false })).toBeNull();
});
