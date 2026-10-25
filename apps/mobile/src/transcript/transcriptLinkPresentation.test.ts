// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('transcript link presentation', () => {
  it('exposes a labeled link action and stops the row selection press from swallowing it', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/transcript/TranscriptMarkdownLine.tsx'), 'utf8');
    expect(source).toContain("accessibilityRole={chunk.glyph.link ? 'link' : undefined}");
    expect(source).toContain('transcriptLinkAccessibilityLabel(chunk.glyph.link)');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('linkOpener.openLink(chunk.glyph.link!)');
  });
});
