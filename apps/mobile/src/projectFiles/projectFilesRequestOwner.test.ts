import { describe, expect, it } from 'vitest';
import { ProjectFilesRequestOwner } from './projectFilesRequestOwner';

describe('ProjectFilesRequestOwner', () => {
  it('aborts and rejects superseded and closed requests', () => {
    const owner = new ProjectFilesRequestOwner();
    const first = owner.begin();
    const second = owner.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.current()).toBe(false);
    expect(second.current()).toBe(true);
    owner.invalidate();
    expect(second.signal.aborted).toBe(true);
    expect(second.current()).toBe(false);
  });
});
