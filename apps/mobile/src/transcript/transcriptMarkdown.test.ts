import { describe, expect, it } from 'vitest';
import { compileTranscriptMarkdown, machineDetailTranscriptLine, resetTranscriptMarkdownCache, safeTranscriptLink, tableColumnWeights, transcriptLinkTarget, transcriptMarkdownCacheSnapshot } from './transcriptMarkdown';

describe('transcript markdown compiler', () => {
  it.each(['.', ',', ';', ':', '!', '?', '...', '?!'])('leaves trailing %s outside a bare URL', (punctuation) => {
    const url = 'https://sandbox.example.test/why';
    const source = `The rewrite is live on sandbox at ${url}${punctuation} Production is unchanged.`;
    const [line] = compileTranscriptMarkdown(source);
    const linked = line!.glyphs.filter((glyph) => glyph.link);
    expect(linked.map((glyph) => glyph.char).join('')).toBe(url);
    expect(linked.every((glyph) => glyph.link?.kind === 'web' && glyph.link.url === url)).toBe(true);
    expect(line!.glyphs.map((glyph) => glyph.char).join('')).toBe(source);
    expect(line!.glyphs.map((glyph) => glyph.sourceIndex)).toEqual([...source].map((_, index) => index));
    const suffix = line!.glyphs.slice(source.indexOf(url) + url.length);
    expect(suffix.every((glyph) => !glyph.link && !glyph.marks.includes('link'))).toBe(true);
  });

  it('preserves internal URL punctuation and explicitly authored trailing punctuation', () => {
    const urls = ['https://example.com/v1.2/file.json?q=a,b!c:d;e#part.2', 'https://example.com/why%2E'];
    for (const url of urls) {
      expect(compileTranscriptMarkdown(`${url}.`)[0]!.glyphs[0]!.link).toEqual({ kind: 'web', url });
    }
    expect(compileTranscriptMarkdown('[literal](https://example.com/why.)')[0]!.glyphs[0]!.link)
      .toEqual({ kind: 'web', url: 'https://example.com/why.' });
  });

  it('renders prose break tags as source anchored visual newlines while preserving code', () => {
    const lines = compileTranscriptMarkdown('a<br>b\n<BR/>\n```html\n<br>\n```\n`<br />` and <br />');
    expect(lines.map((line) => [line.kind, line.glyphs.map((glyph) => glyph.char).join('')])).toEqual([
      ['paragraph', 'a\nb'], ['blank', '\n'], ['fence', 'html'], ['code', '<br>'], ['fence', ''], ['paragraph', '<br /> and \n'],
    ]);
    expect(lines[0]?.glyphs.map((glyph) => glyph.sourceIndex)).toEqual([0, 1, 5]);
  });
  it('does not retain successive oversized cumulative response bodies', () => {
    resetTranscriptMarkdownCache();
    // This checks retained cache bytes, not elapsed-time performance. Keep the
    // complete cumulative workload even on a contended contributor machine.
    for (let frame = 1; frame <= 200; frame += 1) compileTranscriptMarkdown(`${'x'.repeat(70_000)}${frame}`);
    expect(transcriptMarkdownCacheSnapshot()).toEqual({ entries: 0, sourceBytes: 0 });
    compileTranscriptMarkdown('small reusable row');
    expect(transcriptMarkdownCacheSnapshot()).toEqual({ entries: 1, sourceBytes: 36 });
    resetTranscriptMarkdownCache();
  }, 15_000);
  it('compiles native-supported block structure without exposing source markers', () => {
    const lines = compileTranscriptMarkdown('# Heading\n\n- **bold** and *italic*\n> quote\n```ts\nconst x = 1\n```\n| a | b |\n|---|---|');
    expect(lines.map((line) => line.kind)).toEqual(['heading', 'blank', 'bullet', 'quote', 'fence', 'code', 'fence', 'table', 'rule']);
    expect(lines[0]?.glyphs.map((glyph) => glyph.char).join('')).toBe('Heading');
    expect(lines[2]?.marker).toBe('•');
    expect(lines[2]?.glyphs.filter((glyph) => glyph.marks.includes('strong')).map((glyph) => glyph.char).join('')).toBe('bold');
    expect(lines[3]?.glyphs.map((glyph) => glyph.char).join('')).toBe('quote');
  });

  it('retains source coordinates while rendering links and inline code semantically', () => {
    const [line] = compileTranscriptMarkdown('See [docs](https://example.com/a) and `code`.');
    const linkGlyphs = line?.glyphs.filter((glyph) => glyph.link) ?? [];
    expect(linkGlyphs.map((glyph) => glyph.char).join('')).toBe('docs');
    expect(linkGlyphs[0]?.sourceIndex).toBe(5);
    expect(linkGlyphs[0]?.link).toEqual({ kind: 'web', url: 'https://example.com/a' });
    expect(line?.glyphs.filter((glyph) => glyph.marks.includes('code')).map((glyph) => glyph.char).join('')).toBe('code');
  });

  it('retains repository document targets, decoded paths, and source coordinates', () => {
    const source = 'Read [guide](docs/guide.md#L12), [plan](<./docs/my%20plan.md:8>), and ` [source](docs/source.ts) `.';
    const [line] = compileTranscriptMarkdown(source);
    const links = line!.glyphs.filter((glyph) => glyph.link?.kind === 'local-file');
    expect(links.find((glyph) => glyph.char === 'g')?.sourceIndex).toBe(source.indexOf('guide'));
    expect(links.find((glyph) => glyph.char === 'g')?.link).toEqual({ kind: 'local-file', path: 'docs/guide.md', rawTarget: 'docs/guide.md#L12', line: 12 });
    expect(links.find((glyph) => glyph.char === 'p')?.link).toEqual({ kind: 'local-file', path: './docs/my plan.md', rawTarget: './docs/my%20plan.md:8', line: 8 });
    expect(line!.glyphs.filter((glyph) => glyph.marks.includes('code')).some((glyph) => glyph.link)).toBe(false);
  });

  it('compiles repository links inside semantic table cells', () => {
    const compiled = compileTranscriptMarkdown('| File | Note |\n| --- | --- |\n| [guide](docs/guide.md) | read |');
    const cell = compiled[2]!.table!.cells[0]!;
    expect(cell.glyphs.filter((glyph) => glyph.link).map((glyph) => glyph.char).join('')).toBe('guide');
    expect(cell.glyphs.find((glyph) => glyph.link)?.link).toEqual({ kind: 'local-file', path: 'docs/guide.md' });
  });

  it('aligns table columns across header and data rows', () => {
    const compiled = compileTranscriptMarkdown('| A | Long value |\n| --- | --- |\n| Longer | x |\n| Final | another |');
    expect(compiled[0]?.glyphs.map((glyph) => glyph.char).join('')).toBe('A       Long value');
    expect(compiled[2]?.glyphs.map((glyph) => glyph.char).join('')).toBe('Longer  x');
    expect(compiled[3]?.kind).toBe('table');
    expect(compiled[3]?.glyphs.map((glyph) => glyph.char).join('')).toBe('Final   another');
  });

  it('compiles a table into stable semantic cells instead of relying on spaces to lay it out', () => {
    const compiled = compileTranscriptMarkdown('| Assessment | Finding |\n| --- | --- |\n| Test | A long explanation that must wrap inside only the finding column |');
    expect(compiled[0]?.table).toMatchObject({
      header: true,
      columnWeights: [10, 32],
    });
    expect(compiled[0]?.table?.cells.map((cell) => cell.source)).toEqual(['Assessment', 'Finding']);
    expect(compiled[2]?.table).toMatchObject({ header: false });
    expect(compiled[2]?.table?.cells.map((cell) => cell.source)).toEqual([
      'Test',
      'A long explanation that must wrap inside only the finding column',
    ]);
  });

  it('marks only the outer table rows for compact block spacing', () => {
    const compiled = compileTranscriptMarkdown('Before\n| A | B |\n| --- | --- |\n| one | two |\n| three | four |\nAfter');
    expect(compiled[1]?.table).toMatchObject({ first: true, last: false });
    expect(compiled[3]?.table).toMatchObject({ first: false, last: false });
    expect(compiled[4]?.table).toMatchObject({ first: false, last: true });
  });

  it('retains empty table cells so later columns cannot shift left', () => {
    const compiled = compileTranscriptMarkdown('| A | B | C |\n| --- | --- | --- |\n| one | | three |');
    expect(compiled[2]?.table?.cells.map((cell) => cell.source)).toEqual(['one', '', 'three']);
    expect(compiled[2]?.table?.cells).toHaveLength(3);
  });

  it('bounds column weights so a long cell wraps without starving its siblings', () => {
    expect(tableColumnWeights([0, 2, 12, 400])).toEqual([4, 4, 12, 32]);
  });

  it('fails closed for unsafe link schemes', () => {
    expect(safeTranscriptLink('javascript:alert(1)')).toBe('');
    expect(safeTranscriptLink('file:///private/a')).toBe('');
    expect(safeTranscriptLink('https://example.com')).toBe('https://example.com/');
    expect(transcriptLinkTarget('javascript:alert(1)')).toBeNull();
    expect(transcriptLinkTarget('docs/bad%2.md')).toBeNull();
    expect(transcriptLinkTarget('file://server/Users/fixture/repos/vimicate/README.md')).toBeNull();
    expect(transcriptLinkTarget('docs/guide.md')).toEqual({ kind: 'local-file', path: 'docs/guide.md' });
  });

  it('retains a Mac iCloud file citation as a typed iOS Files action', () => {
    const path = '/fixture/example-notes/example-project/Example completed draft.docx';
    const [line] = compileTranscriptMarkdown(`[Updated example form](<${path}>)`);
    const linked = line?.glyphs.filter((glyph) => glyph.link) ?? [];
    expect(linked.map((glyph) => glyph.char).join('')).toBe('Updated example form');
    expect(linked[0]?.link).toEqual({ kind: 'local-file', path });
    expect(transcriptLinkTarget(`file://${encodeURI(path)}`)).toEqual({ kind: 'local-file', path, rawTarget: `file://${encodeURI(path)}` });
  });

  it('renders a completed Codex output citation as a readable existing local-file action', () => {
    const path = '/Users/fixture/repos/example-research/amendments/consolidated/example-research-case-for-support-2026-from-original-submission-tracked.docx';
    const prefix = 'Output ready: ';
    const source = `${prefix}:codex-file-citation{path="${path}" purpose="output"}`;
    const [line] = compileTranscriptMarkdown(source);
    const rendered = line?.glyphs.map((glyph) => glyph.char).join('');
    const linked = line?.glyphs.filter((glyph) => glyph.link) ?? [];
    const filename = 'example-research-case-for-support-2026-from-original-submission-tracked.docx';

    expect(rendered).toBe(`${prefix}file · ${filename}`);
    expect(linked.map((glyph) => glyph.char).join('')).toBe(`file · ${filename}`);
    expect(linked[0]?.link).toEqual({ kind: 'local-file', path });
    expect(linked.at(-1)?.sourceIndex).toBe(source.indexOf(filename) + filename.length - 1);
    expect(rendered).not.toContain('codex-file-citation');
  });

  it('projects partial streaming text and a cold-cache restored final independently', () => {
    const final = ':codex-file-citation{purpose="output" path="/tmp/final report.pdf"}';
    const partial = final.slice(0, -2);
    resetTranscriptMarkdownCache();
    expect(compileTranscriptMarkdown(partial)[0]?.glyphs.map((glyph) => glyph.char).join('')).toBe(partial);
    const streamed = compileTranscriptMarkdown(final)[0];
    expect(streamed?.glyphs.map((glyph) => glyph.char).join('')).toBe('file · final report.pdf');
    resetTranscriptMarkdownCache();
    expect(compileTranscriptMarkdown(final)[0]).toEqual(streamed);
  });

  it('keeps partial, malformed, literal, and non-actionable Codex citations honest', () => {
    const partial = ':codex-file-citation{path="/tmp/report.docx" purpose="out';
    const malformed = ':codex-file-citation{path="/tmp/a.docx" path="/tmp/b.docx" purpose="output"}';
    const relative = ':codex-file-citation{path="reports/final.docx" purpose="output"}';
    const compiledRelative = compileTranscriptMarkdown(relative)[0];

    expect(compileTranscriptMarkdown(partial)[0]?.glyphs.map((glyph) => glyph.char).join('')).toBe(partial);
    expect(compileTranscriptMarkdown(malformed)[0]?.glyphs.map((glyph) => glyph.char).join('')).toBe(malformed);
    expect(compiledRelative?.glyphs.map((glyph) => glyph.char).join('')).toBe('file · final.docx');
    expect(compiledRelative?.glyphs.some((glyph) => glyph.link)).toBe(true);
    expect(compileTranscriptMarkdown(`\`${relative}\``)[0]?.glyphs.map((glyph) => glyph.char).join('')).toBe(relative);
    expect(compileTranscriptMarkdown('```text\n' + relative + '\n```')[1]?.glyphs.map((glyph) => glyph.char).join('')).toBe(relative);
    expect(machineDetailTranscriptLine(relative).glyphs.map((glyph) => glyph.char).join('')).toBe(relative);
  });

  it('bounds malformed Codex citation scanning without disturbing following Markdown', () => {
    const malformed = `:codex-file-citation{path="${'x'.repeat(70_000)}\n[docs](https://example.com)`;
    const [line, link] = compileTranscriptMarkdown(malformed);
    expect(line?.glyphs.map((glyph) => glyph.char).join('')).toContain(':codex-file-citation');
    expect(link?.glyphs.filter((glyph) => glyph.link).map((glyph) => glyph.char).join('')).toBe('docs');
  });

  it('leaves existing Markdown links and images unchanged around a file citation', () => {
    const source = '[docs](https://example.com) ![plot](/tmp/plot.png) ::codex-file-citation{path="/tmp/result.csv"}';
    const [line] = compileTranscriptMarkdown(source);
    expect(line?.glyphs.map((glyph) => glyph.char).join('')).toBe('docs ▣ plot file · result.csv');
    expect(line?.glyphs.filter((glyph) => glyph.link?.kind === 'web').map((glyph) => glyph.char).join('')).toBe('docs');
    expect(line?.glyphs.filter((glyph) => glyph.link?.kind === 'local-file').map((glyph) => glyph.char).join('')).toBe('file · result.csv');
    const nested = `[${source.slice(source.indexOf('::'))}](https://example.com/file)`;
    const nestedLine = compileTranscriptMarkdown(nested)[0];
    expect(nestedLine?.glyphs.map((glyph) => glyph.char).join('')).toContain('::codex-file-citation');
    expect(nestedLine?.glyphs.every((glyph) => glyph.link?.kind === 'web')).toBe(true);
  });
  it('keeps citation filename offsets after astral characters and inherited emphasis', () => {
    const path = '/tmp/📄report.pdf';
    const source = `**:codex-file-citation{path="${path}"}**`;
    const linked = compileTranscriptMarkdown(source)[0]!.glyphs.filter((glyph) => glyph.link);
    const letter = linked.find((glyph) => glyph.char === 'r');
    expect(letter?.sourceIndex).toBe(source.indexOf('report.pdf'));
    expect(linked.every((glyph) => glyph.marks.includes('strong'))).toBe(true);
  });

  it('keeps literal percent characters in citation paths without URL decoding them', () => {
    const path = '/Users/fixture/repos/vimicate/docs/100% complete.md';
    const linked = compileTranscriptMarkdown(`:codex-file-citation{path="${path}"}`)[0]!.glyphs.filter((glyph) => glyph.link);
    expect(linked[0]?.link).toEqual({ kind: 'local-file', path });
  });

});
