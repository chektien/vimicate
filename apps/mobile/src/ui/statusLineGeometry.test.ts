import { describe, expect, it } from 'vitest';
import { STATUS_LINE_LEFT_INSET, STATUS_LINE_RIGHT_INSET } from './statusLineGeometry';

describe('status-line physical edge containment', () => {
  it('gives right-edge operational indicators more breathing room without changing the left mode rhythm', () => {
    expect(STATUS_LINE_LEFT_INSET).toBe(6);
    expect(STATUS_LINE_RIGHT_INSET).toBeGreaterThan(STATUS_LINE_LEFT_INSET);
    expect(STATUS_LINE_RIGHT_INSET).toBe(12);
  });
});
