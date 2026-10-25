// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/updates/AppUpdateNotice.tsx'), 'utf8');

describe('app update notice visual contract', () => {
  it('uses a compact expandable terminal notice rather than a wrapped prose card', () => {
    expect(source).not.toContain('WHAT CHANGED');
    expect(source).not.toContain("presentation.applied ? 'done'");
    expect(source).toContain('numberOfLines={1}');
    expect(source).toContain('expanded ?');
    expect(source).toContain('borderLeftWidth: 2');
    expect(source).toContain('presentation.fixes.map');
    expect(source).toContain('Application.nativeApplicationVersion');
  });

  it('presents update actions as compact buttons with full touch targets', () => {
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('styles.actionButton');
    expect(source).toContain('styles.dismissButton');
    expect(source).toContain('hitSlop={11}');
    expect(source).toContain("borderWidth: StyleSheet.hairlineWidth");
    expect(source).toContain('pressed && styles.actionPressed');
  });
});
