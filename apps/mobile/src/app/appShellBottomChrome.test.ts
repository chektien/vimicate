// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(resolve(process.cwd(), 'src/app/AppShell.tsx'), 'utf8');
const chrome = readFileSync(resolve(process.cwd(), 'src/app/BottomSafeAreaChrome.tsx'), 'utf8');

describe('AppShell bottom chrome safe-area ownership', () => {
  it('fills the bottom safe area with footer chrome while keeping controls inset', () => {
    expect(shell).toContain("edges={['top', 'left', 'right']}");
    expect(shell).toContain('<BottomSafeAreaChrome>');
    expect(shell).not.toContain("edges={['top', 'bottom', 'left', 'right']}");
    expect(chrome).toContain('useSafeAreaInsets');
    expect(chrome).toContain('useContext(SoftwareKeyboardInsetContext)');
    expect(chrome).toContain('Math.max(0, safeAreaInsets.bottom - keyboardInset)');
    expect(chrome).toContain('style={[styles.bottomChrome, { paddingBottom }]}');
    expect(chrome).toContain("bottomChrome: { backgroundColor: colors.canvas }");
  });
});
