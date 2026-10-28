import { describe, expect, it } from 'vitest';
import { updateReleaseNotesFromManifest } from './updateReleaseNotes';

describe('OTA update release notes', () => {
  it('reads notes from a modern update manifest', () => {
    expect(updateReleaseNotesFromManifest({
      extra: {
        vimicateUpdate: {
          title: 'Transcript stability',
          fixes: [' Stable live rows ', 'No render-loop crash'],
        },
      },
    })).toEqual({
      title: 'Transcript stability',
      fixes: ['Stable live rows', 'No render-loop crash'],
    });
  });

  it('reads app config extra nested in the EAS expoClient manifest', () => {
    expect(updateReleaseNotesFromManifest({
      extra: {
        expoClient: {
          extra: {
            vimicateUpdate: {
              title: 'Chronology repair',
              fixes: ['Keeps replies beside their originating prompt'],
            },
          },
        },
      },
    })).toEqual({
      title: 'Chronology repair',
      fixes: ['Keeps replies beside their originating prompt'],
    });
  });

  it('rejects empty or malformed notes and bounds the visible fixes', () => {
    expect(updateReleaseNotesFromManifest({ extra: { vimicateUpdate: { title: ' ', fixes: [] } } })).toBeNull();
    expect(updateReleaseNotesFromManifest({ extra: { vimicateUpdate: {
      fixes: ['one', 'two', 'three', 'four', 'five'],
    } } })).toEqual({
      title: 'Vimicate update',
      fixes: ['one', 'two', 'three', 'four'],
    });
  });

  it('does not invent release notes for a contributor build', () => {
    expect(updateReleaseNotesFromManifest({
      updates: { enabled: false },
      extra: { appFlavor: 'vimicate-contributor', storageNamespace: 'org.vimicate.contributor' },
    })).toBeNull();
  });
});
