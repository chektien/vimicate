import { describe, expect, it } from 'vitest';
import { mediaViewerDismissalGesture } from './mediaViewerDismissalGesture';

describe('media viewer dismissal gesture', () => {
  it('claims only a downward vertically dominant drag at base zoom', () => {
    expect(mediaViewerDismissalGesture({ dx: 4, dy: 18, vy: 0.2, height: 1000, zoomScale: 1 }).claim).toBe(true);
    expect(mediaViewerDismissalGesture({ dx: 30, dy: 18, vy: 0.2, height: 1000, zoomScale: 1 }).claim).toBe(false);
    expect(mediaViewerDismissalGesture({ dx: 4, dy: -18, vy: -0.2, height: 1000, zoomScale: 1 }).claim).toBe(false);
    expect(mediaViewerDismissalGesture({ dx: 4, dy: 18, vy: 0.2, height: 1000, zoomScale: 1.2 }).claim).toBe(false);
  });

  it('dismisses by distance or downward velocity and otherwise restores', () => {
    expect(mediaViewerDismissalGesture({ dx: 8, dy: 140, vy: 0.2, height: 1000, zoomScale: 1 }).dismiss).toBe(true);
    expect(mediaViewerDismissalGesture({ dx: 8, dy: 42, vy: 1.2, height: 1000, zoomScale: 1 }).dismiss).toBe(true);
    expect(mediaViewerDismissalGesture({ dx: 8, dy: 80, vy: 0.4, height: 1000, zoomScale: 1 }).dismiss).toBe(false);
  });

  it('returns a bounded positive visual offset and opacity', () => {
    expect(mediaViewerDismissalGesture({ dx: 0, dy: -50, vy: 0, height: 1000, zoomScale: 1 })).toMatchObject({ offset: 0, opacity: 1 });
    expect(mediaViewerDismissalGesture({ dx: 0, dy: 300, vy: 0, height: 1000, zoomScale: 1 })).toMatchObject({ offset: 300, opacity: 0.76 });
    expect(mediaViewerDismissalGesture({ dx: 0, dy: 2000, vy: 0, height: 1000, zoomScale: 1 })).toMatchObject({ offset: 1000, opacity: 0.2 });
  });
});
