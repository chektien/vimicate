import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

describe('transcript focus geometry architecture', () => {
  it('uses invariant geometry in both the pane border and timestamp column', () => {
    const pane = readFileSync(new URL('../transcript/TranscriptPane.tsx', import.meta.url), 'utf8');
    const row = readFileSync(new URL('../transcript/TranscriptSourceRow.tsx', import.meta.url), 'utf8');

    expect(pane).toContain('borderWidth: TRANSCRIPT_PANE_BORDER_WIDTH');
    expect(pane).toContain('focused: { borderColor: colors.activeAccent }');
    expect(row).toContain('const focusMetrics = transcriptFocusMetrics(fontScale, focused);');
    expect(row).toContain('{ width: focusMetrics.timestampWidth }');
  });
});
