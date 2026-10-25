import { expect, it } from 'vitest';
import { isSharedDownloadsLink } from './sharedDownloadsLink';

it('nominates only iCloud Downloads-shaped local file links for host resolution', () => {
  for (const path of [
    '~/icloud/Downloads/Sessions plan.md',
    '/Users/fixture/icloud/Downloads/Sessions plan.md',
    '/Users/fixture/Library/Mobile Documents/com~apple~CloudDocs/Downloads/Sessions plan.md',
  ]) expect(isSharedDownloadsLink({ kind: 'local-file', path })).toBe(true);
  for (const path of [
    '~/Downloads/Sessions plan.md', '/Users/fixture/Downloads/Sessions plan.md',
    '/Users/other/private.md', '/repo/icloud/Downloads/Sessions plan.md',
  ]) expect(isSharedDownloadsLink({ kind: 'local-file', path })).toBe(false);
  expect(isSharedDownloadsLink({ kind: 'web', url: 'https://example.com' })).toBe(false);
});
