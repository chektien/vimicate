import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import { transcriptLineHighlight, transcriptSearchRanges, type TranscriptVimState } from './transcriptVim';
import type { CompiledMarkdownLine, MarkdownGlyph } from './transcriptMarkdown';
import { workspaceFontMetrics } from '../ui/workspaceTypography';
import { transcriptLinkAccessibilityLabel } from './openTranscriptLink';
import { transcriptMarkdownLineNavigationChanged } from './transcriptRowRenderPolicy';
import { useTranscriptLinkOpener, type TranscriptLinkOpener } from './TranscriptLinkOpener';
import { transcriptRenderedCursorIndex, transcriptRenderedCursorSourceIndex } from './transcriptRenderedCursor';

type GlyphChunk = { key: string; text: string; glyph: MarkdownGlyph; selected: boolean; searched: boolean; cursor: boolean };

type TranscriptMarkdownLineProps = { line: CompiledMarkdownLine; row: number; navigation: TranscriptVimState; cursorVisible?: boolean; searchEnabled?: boolean; machine?: boolean; fontScale: number };

export const TranscriptMarkdownLine = memo(function TranscriptMarkdownLine({ line, row, navigation, cursorVisible = true, searchEnabled = true, machine = false, fontScale }: TranscriptMarkdownLineProps) {
  const linkOpener = useTranscriptLinkOpener();
  const chunks = glyphChunks(line, row, navigation, cursorVisible, undefined, searchEnabled);
  const text = <Text selectable selectionColor={colors.purple} style={[styles.text, machine && styles.machine, line.kind === 'heading' && headingStyle(line.headingLevel), line.kind === 'code' && styles.codeText, line.kind === 'fence' && styles.fenceText, line.kind === 'quote' && styles.quoteText, markdownTextMetrics(line, machine, fontScale)]}>
    {chunks.length ? chunks.map((chunk) => renderChunk(chunk, linkOpener)) : <Text style={cursorVisible && navigation.cursor.row === row ? styles.blockCursor : undefined}> </Text>}
  </Text>;

  if (line.kind === 'rule') return <View style={styles.rule} />;
  if (line.kind === 'quote') return <View style={styles.quote}><View style={styles.quoteRail} />{text}</View>;
  if (line.kind === 'bullet' || line.kind === 'ordered' || line.kind === 'task') return <View style={[styles.list, { paddingLeft: Math.min(16, line.indent ?? 0) * 4 }]}><Text style={[styles.listMarker, workspaceFontMetrics(12, fontScale, 20), line.kind === 'task' && line.marker === '[x]' && styles.checked]}>{line.marker}</Text>{text}</View>;
  if (line.kind === 'code') return <View style={styles.codeLine}>{text}</View>;
  if (line.kind === 'fence') return <View style={styles.fenceLine}>{text}</View>;
  if (line.kind === 'table' && line.table) {
    const tableGlyphs = line.table.cells.flatMap((cell) => cell.glyphs);
    const cursorSourceIndex = cursorVisible && navigation.cursor.row === row
      ? transcriptRenderedCursorSourceIndex(tableGlyphs, navigation.cursor.column)
      : undefined;
    return <View style={[
      styles.tableRow,
      line.table.header && styles.tableHeaderRow,
      line.table.first && styles.tableFirstRow,
      line.table.last && styles.tableLastRow,
    ]}>
      {line.table.cells.map((cell, index) => {
        const cellLine = { ...line, glyphs: cell.glyphs };
        const cellChunks = glyphChunks(cellLine, row, navigation, cursorVisible, cursorSourceIndex, searchEnabled);
        const emptyCursor = cursorSourceIndex !== undefined && !cell.glyphs.length && navigation.cursor.column === sourceCellStart(line, index);
        return <View
          key={`${row}-cell-${index}`}
          style={[
            styles.tableCell,
            index > 0 && styles.tableCellDivider,
            { flexGrow: line.table?.columnWeights[index] ?? 4 },
          ]}
        >
          <Text
            selectable
            selectionColor={colors.purple}
            style={[
              styles.text,
              styles.tableText,
              line.table?.header && styles.tableHeaderText,
              markdownTextMetrics(line, machine, fontScale),
            ]}
          >
            {cellChunks.length ? cellChunks.map((chunk) => renderChunk(chunk, linkOpener)) : <Text style={emptyCursor ? styles.blockCursor : undefined}> </Text>}
          </Text>
        </View>;
      })}
    </View>;
  }
  if (line.kind === 'table') return <View style={styles.tableLine}>{text}</View>;
  if (line.kind === 'image') return <View style={styles.imageLine}>{text}</View>;
  return text;
}, transcriptMarkdownLinePropsEqual);

function transcriptMarkdownLinePropsEqual(previous: TranscriptMarkdownLineProps, next: TranscriptMarkdownLineProps) {
  if (previous.line !== next.line
    || previous.row !== next.row
    || previous.searchEnabled !== next.searchEnabled
    || previous.machine !== next.machine
    || previous.fontScale !== next.fontScale) return false;
  return !transcriptMarkdownLineNavigationChanged(
    previous.line.source,
    previous.row,
    previous.navigation,
    next.navigation,
    previous.cursorVisible ?? true,
    next.cursorVisible ?? true,
  );
}

export function transcriptRenderedText(line: CompiledMarkdownLine) { return line.glyphs.map((glyph) => glyph.char).join(''); }

function renderChunk(chunk: GlyphChunk, linkOpener: TranscriptLinkOpener) {
  return <Text
    key={chunk.key}
    suppressHighlighting
    accessible={Boolean(chunk.glyph.link)}
    accessibilityRole={chunk.glyph.link ? 'link' : undefined}
    accessibilityLabel={chunk.glyph.link ? transcriptLinkAccessibilityLabel(chunk.glyph.link) : undefined}
    accessibilityHint={chunk.glyph.link ? linkOpener.getAccessibilityHint(chunk.glyph.link) : undefined}
    onPress={chunk.glyph.link ? (event) => { event.stopPropagation(); void linkOpener.openLink(chunk.glyph.link!); } : undefined}
    style={[
      chunk.glyph.marks.includes('strong') && styles.strong,
      chunk.glyph.marks.includes('emphasis') && styles.emphasis,
      chunk.glyph.marks.includes('code') && styles.inlineCode,
      chunk.glyph.marks.includes('strike') && styles.strike,
      chunk.glyph.marks.includes('link') && styles.link,
      chunk.searched && styles.searchMatch,
      chunk.selected && styles.visualSelection,
      chunk.cursor && styles.blockCursor,
    ]}
  >{chunk.text}</Text>;
}

function glyphChunks(line: CompiledMarkdownLine, row: number, navigation: TranscriptVimState, cursorVisible: boolean, cursorSourceIndex?: number, searchEnabled = true): (GlyphChunk)[] {
  const highlight = transcriptLineHighlight(navigation, row, line.source.length);
  const searchRanges = searchEnabled ? transcriptSearchRanges(line.source, navigation.searchQuery, line) : [];
  const cursorIndex = cursorVisible
    ? cursorSourceIndex === undefined
      ? transcriptRenderedCursorIndex(line.glyphs, highlight.cursorColumn)
      : line.glyphs.findIndex((glyph) => glyph.sourceIndex === cursorSourceIndex)
    : -1;
  const chunks: (GlyphChunk)[] = [];
  line.glyphs.forEach((glyph, index) => {
    const selected = Boolean(highlight.lineSelected || (highlight.selection && glyph.sourceIndex >= highlight.selection.start && glyph.sourceIndex <= highlight.selection.end));
    const searched = searchRanges.some((range) => glyph.sourceIndex >= range.start && glyph.sourceIndex <= range.end);
    const cursor = cursorIndex === index;
    const prior = chunks.at(-1);
    const same = prior && prior.selected === selected && prior.searched === searched && prior.cursor === cursor && linkKey(prior.glyph) === linkKey(glyph) && prior.glyph.marks.join('|') === glyph.marks.join('|');
    if (same) prior.text += glyph.char;
    else chunks.push({ key: `${row}-${index}`, text: glyph.char, glyph, selected, searched, cursor });
  });
  return chunks;
}

function linkKey(glyph: MarkdownGlyph) {
  return glyph.link?.kind === 'web' ? `web:${glyph.link.url}` : glyph.link ? `local-file:${glyph.link.path}:${glyph.link.line ?? ''}:${glyph.link.rawTarget ?? ''}` : '';
}

function sourceCellStart(line: CompiledMarkdownLine, cellIndex: number) {
  const glyph = line.table?.cells[cellIndex]?.glyphs[0];
  if (glyph) return glyph.sourceIndex;
  const raw = line.source.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  const offset = line.source.indexOf(raw);
  let cursor = 0;
  for (let index = 0; index < cellIndex; index += 1) cursor += (raw.split('|')[index]?.length ?? 0) + 1;
  return Math.max(0, offset + cursor);
}

function headingStyle(level = 3) { return level === 1 ? styles.headingOne : level === 2 ? styles.headingTwo : styles.headingOther; }

function markdownTextMetrics(line: CompiledMarkdownLine, machine: boolean, scale: number) {
  if (line.kind === 'heading') {
    if (line.headingLevel === 1) return workspaceFontMetrics(15, scale, 22);
    if (line.headingLevel === 2) return workspaceFontMetrics(14, scale, 21);
  }
  if (line.kind === 'fence') return workspaceFontMetrics(9, scale, machine ? 18 : 20);
  if (line.kind === 'code') return workspaceFontMetrics(12, scale, machine ? 18 : 20);
  return workspaceFontMetrics(machine ? 11.5 : 13, scale, machine ? 18 : 20);
}

const styles = StyleSheet.create({
  text: { flex: 1, paddingRight: 8, color: colors.ink, fontFamily: type.mono, fontSize: 13, lineHeight: 20 }, machine: { color: colors.inkMuted, fontSize: 11.5, lineHeight: 18 },
  headingOne: { color: colors.inkBright, fontSize: 15, lineHeight: 22, fontWeight: '800' }, headingTwo: { color: colors.inkBright, fontSize: 14, lineHeight: 21, fontWeight: '800' }, headingOther: { color: colors.ink, fontWeight: '800' },
  strong: { color: colors.inkBright, fontWeight: '800' }, emphasis: { fontStyle: 'italic' }, strike: { textDecorationLine: 'line-through', color: colors.faint }, link: { color: colors.blue, textDecorationLine: 'underline' }, inlineCode: { color: colors.inkBright, backgroundColor: colors.raised },
  quote: { flex: 1, minWidth: 0, flexDirection: 'row', paddingLeft: 4 }, quoteRail: { width: 2, marginRight: 8, backgroundColor: colors.borderStrong }, quoteText: { color: colors.inkMuted, fontStyle: 'italic' },
  list: { flex: 1, minWidth: 0, flexDirection: 'row' }, listMarker: { width: 28, paddingRight: 7, color: colors.inkMuted, fontFamily: type.mono, fontSize: 12, lineHeight: 20, textAlign: 'right' }, checked: { color: colors.activeAccent },
  codeLine: { flex: 1, minWidth: 0, paddingHorizontal: 8 }, codeText: { color: colors.inkBright, fontSize: 12 }, fenceLine: { flex: 1, minWidth: 0, paddingHorizontal: 8 }, fenceText: { color: colors.faint, fontSize: 9 },
  tableLine: { flex: 1, minWidth: 0, paddingHorizontal: 8 },
  tableRow: { flex: 1, minWidth: 0, flexDirection: 'row', marginHorizontal: 8, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, backgroundColor: colors.canvas },
  tableFirstRow: { marginTop: 6 },
  tableLastRow: { marginBottom: 6 },
  tableHeaderRow: { backgroundColor: colors.raised, borderColor: colors.borderStrong },
  tableCell: { flexBasis: 0, minWidth: 0, paddingHorizontal: 7, paddingVertical: 4, justifyContent: 'flex-start' },
  tableCellDivider: { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth },
  tableText: { flex: 0, minWidth: 0, paddingRight: 0 }, tableHeaderText: { color: colors.inkBright, fontWeight: '800' },
  imageLine: { flex: 1, minWidth: 0 }, rule: { flex: 1, height: 1, marginVertical: 9, backgroundColor: colors.border },
  searchMatch: { backgroundColor: '#665c54', color: colors.inkBright }, visualSelection: { backgroundColor: colors.purple, color: colors.inkBright }, blockCursor: { backgroundColor: colors.yellow, color: colors.canvas },
});
