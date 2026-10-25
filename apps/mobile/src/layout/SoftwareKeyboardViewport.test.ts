// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyboardViewportInset, usesManagedKeyboardViewport } from './softwareKeyboardViewportPolicy';

describe('software keyboard workspace viewport', () => {
  it('shrinks the iOS workspace above the software keyboard', () => {
    expect(usesManagedKeyboardViewport('ios')).toBe(true);
  });

  it('leaves platforms with automatic resizing unchanged', () => {
    expect(usesManagedKeyboardViewport('android')).toBe(false);
  });

  it('ignores an iPad keyboard frame emitted by the other foreground app', () => {
    expect(keyboardViewportInset(
      { y: 24, height: 1130 },
      { screenY: 0, height: 1130 },
      { active: true, local: false },
    )).toBe(0);
  });

  it('bounds a malformed local frame by keyboard height and a visible-workspace floor', () => {
    expect(keyboardViewportInset(
      { y: 24, height: 1130 },
      { screenY: 0, height: 345 },
      { active: true, local: true },
    )).toBe(345);

    expect(keyboardViewportInset(
      { y: 0, height: 300 },
      { screenY: 0, height: 280 },
      { active: true, local: true },
    )).toBe(80);
  });

  it('uses only the real overlap for a local docked keyboard and clears while inactive', () => {
    expect(keyboardViewportInset(
      { y: 24, height: 1130 },
      { screenY: 800, height: 354 },
      { active: true, local: true },
    )).toBe(354);
    expect(keyboardViewportInset(
      { y: 24, height: 1130 },
      { screenY: 800, height: 354 },
      { active: false, local: true },
    )).toBe(0);
  });

  it('wires local-window and app-state authority without the unbounded stock wrapper', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/layout/SoftwareKeyboardViewport.tsx'), 'utf8');
    expect(source).not.toContain('KeyboardAvoidingView');
    expect(source).toContain('event.isEventFromThisApp === false');
    expect(source).toContain("AppState.addEventListener('change'");
    expect(source).toContain('measureInWindow');
    expect(source).toContain('keyboardViewportInset');
  });
});
