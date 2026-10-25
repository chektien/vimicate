import { describe, expect, it } from 'vitest';
import { resolveProjectFileLink } from './projectFileLink';

describe('project transcript file link resolver', () => {
  it('normalizes relative document links and carries line references', () => {
    expect(resolveProjectFileLink('docs/guide.md', '~/repos/vimicate')).toEqual({ path: 'docs/guide.md' });
    expect(resolveProjectFileLink('./docs/space%20name.md:12:4', '~/repos/vimicate')).toEqual({ path: 'docs/space name.md', line: 12 });
    expect(resolveProjectFileLink('docs/guide.md#L31', '/Users/fixture/repos/vimicate')).toEqual({ path: 'docs/guide.md', line: 31 });
    expect(resolveProjectFileLink('docs/guide.md#installation', '/Users/fixture/repos/vimicate')).toEqual({ path: 'docs/guide.md' });
  });

  it('matches absolute roots on exact component boundaries', () => {
    const root = '/Users/fixture/repos/vimicate';
    expect(resolveProjectFileLink('/Users/fixture/repos/vimicate/docs/guide.md:7', root)).toEqual({ path: 'docs/guide.md', line: 7 });
    expect(resolveProjectFileLink('file:///Users/fixture/repos/vimicate/docs/space%20name.md#L9', root)).toEqual({ path: 'docs/space name.md', line: 9 });
    expect(resolveProjectFileLink('/Users/fixture/repos/vimicate-other/docs/guide.md', root)).toBeNull();
    expect(resolveProjectFileLink('/Users/fixture/repos/vimicate', root)).toBeNull();
  });

  it('recognizes only standard absolute-home aliases for tilde registry roots', () => {
    const root = '~/repos/vimicate';
    expect(resolveProjectFileLink('/Users/fixture/repos/vimicate/docs/guide.md', root)).toEqual({ path: 'docs/guide.md' });
    expect(resolveProjectFileLink('/home/runner/repos/vimicate/docs/guide.md', root)).toEqual({ path: 'docs/guide.md' });
    expect(resolveProjectFileLink('/srv/runner/repos/vimicate/docs/guide.md', root)).toBeNull();
    expect(resolveProjectFileLink('/Users/fixture/archive/repos/vimicate/docs/guide.md', root)).toBeNull();
  });

  it('rejects traversal, malformed encoding, unsupported schemes, and file authorities', () => {
    const root = '~/repos/vimicate';
    expect(resolveProjectFileLink('../secret.md', root)).toBeNull();
    expect(resolveProjectFileLink('docs/../../secret.md', root)).toBeNull();
    expect(resolveProjectFileLink('/Users/fixture/repos/vimicate/../secret.md', root)).toBeNull();
    expect(resolveProjectFileLink('docs/bad%2.md', root)).toBeNull();
    expect(resolveProjectFileLink('https://example.com/docs/guide.md', root)).toBeNull();
    expect(resolveProjectFileLink('file://server/Users/fixture/repos/vimicate/docs/guide.md', root)).toBeNull();
  });

  it('does not decode an already parsed citation path a second time', () => {
    expect(resolveProjectFileLink({ path: '/Users/fixture/repos/vimicate/docs/100% complete.md' }, '~/repos/vimicate'))
      .toEqual({ path: 'docs/100% complete.md' });
  });
});
