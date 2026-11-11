import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
import { confirmRailRemoval, railRemovalCommand, railRemovalStatus } from './railRemoval';

describe('rail removal', () => {
  it('closes child threads and removes top-level projects', () => {
    expect(railRemovalCommand({ kind: 'thread', name: 't' })).toBe(':close-thread');
    expect(railRemovalCommand({ kind: 'project', name: 'p' })).toBe(':remove-project');
  });
  it('removes a thread at once but asks before removing a project', () => {
    const remove = vi.fn(), alert = vi.fn();
    confirmRailRemoval({ kind: 'thread', name: 't' }, remove, alert);
    expect(remove).toHaveBeenCalledTimes(1); expect(alert).not.toHaveBeenCalled();
    confirmRailRemoval({ kind: 'project', name: 'Example Project' }, remove, alert);
    expect(remove).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = alert.mock.calls[0]!;
    expect(title).toBe('Remove Example Project?'); expect(body).toContain('folder');
    buttons.find((b: { text: string }) => b.text === 'Remove').onPress();
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it('never clears the status silently when removal fails', () => {
    expect(railRemovalStatus({ kind: 'project', name: 'p' }, false)).toContain('could not remove project p');
    expect(railRemovalStatus({ kind: 'thread', name: 't' }, true)).toBe('');
  });
});
