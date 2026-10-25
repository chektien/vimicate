import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides these test-only modules.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides these test-only modules.
import { resolve } from 'node:path';

import { createTranscriptBuffer } from '../transcript/transcriptBuffer';
import { compileTranscriptMarkdown } from '../transcript/transcriptMarkdown';
import { nextTranscriptSearchCursor } from '../transcript/transcriptMessageSearch';
import { resolvedTranscriptSkillInvocation, transcriptRowSkillInvocation } from '../transcript/transcriptSkillInvocation';
import { buildVisibleTranscriptRenderRows, transcriptNavigationSourceRows } from '../transcript/transcriptVisibleRows';
import {
  SIMULATOR_TRANSCRIPT_ACTIONABLE_FILE,
  SIMULATOR_TRANSCRIPT_FIXTURE_MODE,
  SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT,
  SIMULATOR_TRANSCRIPT_HISTORY_PAGE_SIZE,
  SIMULATOR_TRANSCRIPT_MARKERS,
  SIMULATOR_TRANSCRIPT_ROOT_MARKER,
  SIMULATOR_TRANSCRIPT_UNAVAILABLE_FILE,
  simulatorTranscriptFixtureMessages,
  simulatorTranscriptGeometryMessages,
} from './simulatorTranscriptFixtures';

function rendered(source: string) {
  return compileTranscriptMarkdown(source)
    .map((line) => line.glyphs.map((glyph) => glyph.char).join(''))
    .join('\n');
}

describe('isolated simulator transcript regression fixture', () => {
  it('offers a stable reviewed key across page-sized mixed-height native prepends', () => {
    const initial = simulatorTranscriptGeometryMessages();
    const first = simulatorTranscriptGeometryMessages(1);
    const second = simulatorTranscriptGeometryMessages(2);
    expect(first.slice(-initial.length).map(message => message.id)).toEqual(initial.map(message => message.id));
    expect(second.slice(-first.length).map(message => message.id)).toEqual(first.map(message => message.id));
    expect(first.length - initial.length).toBe(24);
    expect(first.some(message => message.role === 'tool')).toBe(true);
    expect(initial.some(message => message.text.includes('SIMTRANS-GEOMETRY-ANCHOR'))).toBe(true);
    const rows = buildVisibleTranscriptRenderRows(first, new Set());
    expect(rows.some(row => row.fold)).toBe(true);
  });
  it('prepends one stable synthetic older page per explicit request without exposing the cascade page early', () => {
    const initial = simulatorTranscriptFixtureMessages();
    const pageOne = simulatorTranscriptFixtureMessages(1);
    const pageTwo = simulatorTranscriptFixtureMessages(2);
    const exhausted = simulatorTranscriptFixtureMessages(SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT + 1);
    const ids = (messages: ReturnType<typeof simulatorTranscriptFixtureMessages>) => messages.map((message) => message.id);

    expect(pageOne).toHaveLength(initial.length + SIMULATOR_TRANSCRIPT_HISTORY_PAGE_SIZE);
    expect(pageTwo).toHaveLength(pageOne.length + SIMULATOR_TRANSCRIPT_HISTORY_PAGE_SIZE);
    expect(ids(pageOne).slice(SIMULATOR_TRANSCRIPT_HISTORY_PAGE_SIZE)).toEqual(ids(initial));
    expect(ids(pageTwo).slice(SIMULATOR_TRANSCRIPT_HISTORY_PAGE_SIZE)).toEqual(ids(pageOne));
    expect(pageOne.some((message) => message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.historyPageOneOldest))).toBe(true);
    expect(pageOne.some((message) => message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.historyPageTwoOldest))).toBe(false);
    expect(pageTwo.some((message) => message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.historyPageTwoOldest))).toBe(true);
    expect(pageTwo.some((message) => message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.historyPageThree))).toBe(false);
    expect(exhausted.filter((message) => message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.historyPageThree))).toHaveLength(1);
  });

  it('derives skill labels from production prose/tool evidence and rejects ambiguous prose', () => {
    const messages = simulatorTranscriptFixtureMessages();
    const rows = buildVisibleTranscriptRenderRows(messages, new Set());
    const resolved = (marker: string) => {
      const row = rows.find((candidate) => candidate.compiled.source.includes(marker));
      expect(row).toBeDefined();
      const explicit = transcriptRowSkillInvocation(row!.message.role, row!.compiled.source);
      return resolvedTranscriptSkillInvocation(row!.compiled.source, explicit, row!.inferredSkillInvocation ?? null)?.invocation.label ?? null;
    };

    expect(resolved(SIMULATOR_TRANSCRIPT_MARKERS.skillPositive)).toBe('browser-automation');
    expect(resolved(SIMULATOR_TRANSCRIPT_MARKERS.skillNegative)).toBeNull();
    expect(resolved(SIMULATOR_TRANSCRIPT_MARKERS.skillInferred)).toBe('sit-authentication');
  });

  it('uses the production Markdown compiler for absolute, relative and literal citation boundaries', () => {
    const citation = simulatorTranscriptFixtureMessages().find((message) => message.id.endsWith('-citations'))!;
    const lines = compileTranscriptMarkdown(citation.text);
    const actionable = lines[0]!;
    const unavailable = lines[1]!;
    const inlineCode = lines[2]!;
    expect(actionable.glyphs.map((glyph) => glyph.char).join('')).toContain(`file · ${SIMULATOR_TRANSCRIPT_ACTIONABLE_FILE}`);
    expect(actionable.glyphs.find((glyph) => glyph.link)?.link).toEqual({
      kind: 'local-file',
      path: `/Users/fixture/Documents/${SIMULATOR_TRANSCRIPT_ACTIONABLE_FILE}`,
    });
    expect(unavailable.glyphs.map((glyph) => glyph.char).join('')).toContain(`file · ${SIMULATOR_TRANSCRIPT_UNAVAILABLE_FILE}`);
    // Relative citations are now actionable; availability is resolved by the project Files owner.
    expect(unavailable.glyphs.find((glyph) => glyph.link)?.link).toEqual({ kind: 'local-file', path: `relative/${SIMULATOR_TRANSCRIPT_UNAVAILABLE_FILE}` });
    expect(inlineCode.glyphs.map((glyph) => glyph.char).join('')).toContain(':codex-file-citation{');
    expect(inlineCode.glyphs.some((glyph) => glyph.marks.includes('code'))).toBe(true);

    const fenced = simulatorTranscriptFixtureMessages().find((message) => message.id.endsWith('-citation-fence'))!;
    expect(rendered(fenced.text)).toContain(':codex-file-citation{path="/Users/fixture/Documents/fenced-control.txt"}');
    expect(compileTranscriptMarkdown(fenced.text)[2]?.kind).toBe('code');
  });

  it('keeps raw tools and recovered embedded protocol folded behind readable summaries', () => {
    const messages = simulatorTranscriptFixtureMessages();
    const collapsed = buildVisibleTranscriptRenderRows(messages, new Set());
    const tool = collapsed.find((row) => row.message.id.endsWith('-folded-tool'))!;
    const protocolAnswer = collapsed.find((row) => row.compiled.source.includes(SIMULATOR_TRANSCRIPT_MARKERS.protocolAnswer));
    const protocolTool = collapsed.find((row) => row.message.role === 'tool' && row.message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.protocolSecret));
    expect(tool.fold).toEqual({ expanded: false, hiddenLineCount: 3 });
    expect(tool.compiled.source).toContain('exec · inspect synthetic transcript fixture');
    expect(tool.compiled.source).not.toContain(SIMULATOR_TRANSCRIPT_MARKERS.toolSecret);
    expect(protocolAnswer?.message.role).toBe('assistant');
    expect(protocolAnswer?.compiled.source).not.toMatch(/functionresults|SIMTRANS-PROTOCOL-DETAIL-SECRET/);
    expect(protocolTool?.fold?.expanded).toBe(false);
    expect(protocolTool?.compiled.source).not.toContain(SIMULATOR_TRANSCRIPT_MARKERS.protocolSecret);
  });

  it('keeps search, folded navigation stops and absolute source coordinates coupled', () => {
    const messages = simulatorTranscriptFixtureMessages();
    const buffer = createTranscriptBuffer(messages);
    const rows = buildVisibleTranscriptRenderRows(messages, new Set());
    const navigationRows = transcriptNavigationSourceRows(rows);
    const target = nextTranscriptSearchCursor(
      buffer,
      SIMULATOR_TRANSCRIPT_MARKERS.searchTarget,
      { row: 0, column: 0 },
      1,
      navigationRows,
    );
    expect(target).not.toBeNull();
    expect(buffer.lines[target!.row]?.text).toContain(SIMULATOR_TRANSCRIPT_MARKERS.searchTarget);
    expect(navigationRows).toContain(target!.row);
    expect(navigationRows.every((row, index) => index === 0 || row > navigationRows[index - 1]!)).toBe(true);
  });

  it('mounts the shared simulator transcript integration hook', () => {
    const app = readFileSync(resolve(process.cwd(), 'App.tsx'), 'utf8');
    expect(app).toContain('fixtureMode === SIMULATOR_TRANSCRIPT_FIXTURE_MODE ? <SimulatorTranscriptFixtureApp />');
  });

});
