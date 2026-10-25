// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('transcript native touch selection contract', () => {
  it('leaves long press to selectable native text rather than row navigation', () => {
    const markdown = readFileSync(new URL('./TranscriptMarkdownLine.tsx', import.meta.url), 'utf8');
    const row = readFileSync(new URL('./TranscriptSourceRow.tsx', import.meta.url), 'utf8');

    expect(markdown).toMatch(/const text = <Text\s+selectable\b/);
    expect(row).not.toContain('onLongPress=');
  });
});
