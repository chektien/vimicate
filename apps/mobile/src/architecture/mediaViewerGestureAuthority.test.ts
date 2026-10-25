// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('media viewer gesture authority', () => {
  it('wires one vertical capture owner without removing explicit dismissal', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/transcript/TranscriptMediaViewer.tsx'), 'utf8');
    expect(source).toContain('PanResponder.create');
    expect(source).toContain('onMoveShouldSetPanResponderCapture');
    expect(source).toContain('mediaViewerDismissalGesture');
    expect(source).toContain('accessibilityLabel="Close image viewer"');
  });
});
