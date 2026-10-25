import { describe, expect, it } from 'vitest';
import { threadSortCommand } from './threadSortCommand';

describe(':thread-sort', () => {
  it('supports explicit modes, aliases, and toggle', () => {
    expect(threadSortCommand('', 'manual').mode).toBe('activity');
    expect(threadSortCommand('toggle', 'activity').mode).toBe('manual');
    expect(threadSortCommand('latest', 'manual').mode).toBe('activity');
    expect(threadSortCommand('registry', 'activity').mode).toBe('manual');
  });
  it('fails closed for unsupported arguments', () => expect(threadSortCommand('chaos', 'manual')).toEqual({ message: ':thread-sort expects activity, manual, or toggle.' }));
});
