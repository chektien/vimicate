import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  openURL: vi.fn(),
  openLocalPath: vi.fn(),
}));

vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
  Linking: { openURL: mocks.openURL },
  Platform: { OS: 'ios' },
}));
vi.mock('../../modules/vimicate-file-links', () => ({
  default: { openLocalPath: mocks.openLocalPath },
}));

import { openTranscriptLink, transcriptLinkAccessibilityHint } from './openTranscriptLink';

beforeEach(() => {
  mocks.alert.mockReset();
  mocks.openURL.mockReset();
  mocks.openLocalPath.mockReset();
});

it('does not offer an unresolved relative link to the native Files mapping', async () => {
  const target = { kind: 'local-file' as const, path: 'docs/guide.md' };
  await openTranscriptLink(target);
  expect(mocks.openLocalPath).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith('File location unavailable', 'Open this file link from a connected workspace so its exact location can be resolved.');
  expect(transcriptLinkAccessibilityHint(target)).toContain('project Files');
});

it('keeps web links external but never guesses an absolute file provider mapping', async () => {
  mocks.openLocalPath.mockResolvedValue({ status: 'opened' });
  await openTranscriptLink({ kind: 'local-file', path: '/Users/fixture/Documents/guide.md' });
  await openTranscriptLink({ kind: 'web', url: 'https://example.com/' });
  expect(mocks.openLocalPath).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith('File location unavailable', expect.stringContaining('exact location'));
  expect(mocks.openURL).toHaveBeenCalledWith('https://example.com/');
});
