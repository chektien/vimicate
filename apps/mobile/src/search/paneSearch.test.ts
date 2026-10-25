import { describe, expect, it } from 'vitest';
import { findProjectSearchMatch, findTextSearchMatch, repeatedVimSearchDirection, searchInputCharacter, vimSearchDirectionForKey } from './paneSearch';

describe('pane-scoped Vim search', () => {
  const projects = [
    { id: '1', sessionKey: 'a', name: 'vimicate', path: '~/repos/vimicate', branch: 'main', starred: false, threadCount: 1, state: 'idle' as const },
    { id: '2', sessionKey: 'b', name: 'notes', path: '~/notes', branch: '—', starred: false, threadCount: 1, state: 'idle' as const },
    { id: '3', sessionKey: 'c', name: 'dotfiles', path: '~/.config', branch: 'main', starred: false, threadCount: 1, state: 'idle' as const },
  ];

  it('wraps project matches in both directions', () => {
    expect(findProjectSearchMatch(projects, 'main', 'a', 1)).toBe('c');
    expect(findProjectSearchMatch(projects, 'main', 'a', -1)).toBe('c');
    expect(findProjectSearchMatch(projects, 'notes', 'c', 1)).toBe('b');
  });

  it('wraps prompt-buffer matches in both directions', () => {
    expect(findTextSearchMatch('one two one', 'one', 0, 1)).toBe(8);
    expect(findTextSearchMatch('one two one', 'one', 8, 1)).toBe(0);
    expect(findTextSearchMatch('one two one', 'one', 0, -1)).toBe(8);
    expect(findTextSearchMatch('one two one', 'missing', 8, 1)).toBeNull();
  });

  it('turns hardware key events into searchable characters', () => {
    expect(searchInputCharacter('a', true)).toBe('A');
    expect(searchInputCharacter('/', true)).toBe('?');
    expect(searchInputCharacter('backspace', false)).toBe('');
  });

  it('preserves Vim forward/reverse search semantics for slash, question, n and N', () => {
    expect(vimSearchDirectionForKey('/')).toBe(1);
    expect(vimSearchDirectionForKey('?')).toBe(-1);
    expect(repeatedVimSearchDirection(-1, 'n')).toBe(-1);
    expect(repeatedVimSearchDirection(-1, 'N')).toBe(1);
  });
});
