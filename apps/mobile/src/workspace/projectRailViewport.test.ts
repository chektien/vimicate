import { describe, expect, it } from 'vitest';
import { projectRevealPosition, shouldRevealProjectIndex } from './projectRailViewport';

describe('project rail viewport', () => {
  it('keeps ordinary j/k movement still while the cursor remains safely visible', () => {
    expect(shouldRevealProjectIndex(5, { first: 2, last: 8 })).toBe(false);
    expect(shouldRevealProjectIndex(2, { first: 2, last: 8 })).toBe(true);
    expect(shouldRevealProjectIndex(8, { first: 2, last: 8 })).toBe(true);
  });

  it('reveals outside targets near the edge they crossed', () => {
    expect(projectRevealPosition(1, { first: 2, last: 8 })).toBe(0.12);
    expect(projectRevealPosition(9, { first: 2, last: 8 })).toBe(0.82);
  });
});
