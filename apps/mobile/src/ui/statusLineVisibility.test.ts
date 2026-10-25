import { describe, expect, it } from 'vitest';
import { statusLineVisibility } from './statusLineVisibility';

describe('status-line responsive priority', () => {
  it('keeps provider quota visible in a compact workspace', () => {
    expect(statusLineVisibility(true)).toEqual({
      path: false,
      branch: false,
      quota: true,
      position: false,
    });
  });

  it('shows the complete status set when workspace chrome is expanded', () => {
    expect(statusLineVisibility(false)).toEqual({
      path: true,
      branch: true,
      quota: true,
      position: true,
    });
  });
});
