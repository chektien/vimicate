import { describe, expect, it, vi } from 'vitest';
import { createTranscriptLayoutBurstDiagnostics } from './transcriptLayoutBurstDiagnostics';

function harness() {
  const tasks: Array<() => void> = [];
  const record = vi.fn();
  const read = vi.fn(() => ({ offset: 42, contentHeight: 400, viewportHeight: 100 }));
  const owner = createTranscriptLayoutBurstDiagnostics(record, (task) => tasks.push(task));
  const commit = (count: number) => { for (let i = 0; i < count; i++) owner.layoutCommit(read); };
  return { owner, tasks, record, read, commit };
}

describe('synchronous transcript layout burst diagnostics', () => {
  it('is dormant before commit and quiet during ordinary layouts', () => {
    const h = harness(); h.commit(100);
    expect(h.tasks).toHaveLength(0);
    h.owner.activate(); h.commit(7);
    expect(h.tasks).toHaveLength(1);
    expect(h.read).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
  });
  it('samples only four thresholds, with one deferred reset and bounded reads', () => {
    const h = harness(); h.owner.activate(); h.commit(10_000);
    expect(h.tasks).toHaveLength(1); expect(h.read).toHaveBeenCalledTimes(4);
    expect(h.record.mock.calls.map(([fields]) => fields.layoutCommits)).toEqual([8, 16, 32, 48]);
    expect(h.record.mock.calls[0]?.[0]).toMatchObject({ sourceCommits: 0, offset: 42 });
  });
  it('distinguishes internal list relayouts from parent presentation and topology publications', () => {
    const h = harness(); h.owner.activate();
    const data = {}, rows = {};
    h.owner.sourceCommit(data, rows); h.owner.sourceCommit(data, rows);
    h.owner.sourceCommit(data, {}); h.owner.sourceCommit({}, {}); h.commit(8);
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({
      layoutCommits: 8, sourceCommits: 4, topologyChanges: 2, presentationChanges: 3,
    }));
  });
  it('starts a new burst after yielding without calling the reader from the deferred reset', () => {
    const h = harness(); h.owner.activate(); h.commit(8); h.tasks.shift()!();
    expect(h.read).toHaveBeenCalledTimes(1);
    h.commit(8); expect(h.tasks).toHaveLength(1);
    expect(h.record.mock.calls.map(([fields]) => fields.layoutCommits)).toEqual([8, 8]);
  });
  it('rejects retired callbacks and prevents an old reset from erasing a reactivated burst', () => {
    const h = harness(); const dispose = h.owner.activate(); h.commit(4);
    dispose(); h.commit(100); expect(h.record).not.toHaveBeenCalled();
    const disposeNew = h.owner.activate(); h.commit(4);
    h.tasks.shift()!(); dispose(); h.commit(4);
    expect(h.record.mock.calls[0]?.[0].layoutCommits).toBe(8);
    disposeNew(); h.tasks.shift()!(); h.commit(100);
    expect(h.record).toHaveBeenCalledOnce();
  });
  it('does not let diagnostic read or sink failure escape into React', () => {
    const h = harness(); h.owner.activate(); h.read.mockImplementation(() => { throw new Error('retired native ref'); });
    expect(() => h.commit(8)).not.toThrow();
    h.read.mockReturnValue({ offset: 1, contentHeight: 2, viewportHeight: 3 });
    h.record.mockImplementation(() => { throw new Error('unavailable diagnostics'); });
    expect(() => h.commit(8)).not.toThrow();
  });
});
