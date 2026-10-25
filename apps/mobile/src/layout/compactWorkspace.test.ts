import { describe, expect, it } from 'vitest';
import { compactProjectDrawerWidth, usesCompactWorkspace } from './compactWorkspace';

describe('compact workspace geometry', () => {
  it('uses the native compact threshold and preserves phone landscape', () => {
    expect(usesCompactWorkspace(393, 852)).toBe(true);
    expect(usesCompactWorkspace(852, 393)).toBe(true);
    expect(usesCompactWorkspace(699, 1024)).toBe(true);
    expect(usesCompactWorkspace(700, 1024)).toBe(false);
    expect(usesCompactWorkspace(1024, 768)).toBe(false);
  });

  it('keeps the familiar rail width on compact iPad while preserving the wider phone drawer', () => {
    expect(compactProjectDrawerWidth(320, 'pad')).toBe(224);
    expect(compactProjectDrawerWidth(393, 'pad')).toBe(224);
    expect(compactProjectDrawerWidth(700, 'pad')).toBe(224);
    expect(compactProjectDrawerWidth(180, 'pad')).toBe(180);

    expect(compactProjectDrawerWidth(320, 'phone')).toBe(264);
    expect(compactProjectDrawerWidth(393, 'phone')).toBeCloseTo(282.96);
    expect(compactProjectDrawerWidth(430, 'phone')).toBeCloseTo(300);
    expect(compactProjectDrawerWidth(700, 'phone')).toBe(300);
  });
});
