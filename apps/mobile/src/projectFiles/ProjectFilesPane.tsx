import { ProjectFileShareFallback } from './ProjectFileShareFallback';
import { ProjectFileSortMenu } from './ProjectFileSortMenu';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import { colors, space, type } from '../theme/tokens';
import { TranscriptMarkdownLine } from '../transcript/TranscriptMarkdownLine';
import { workspaceFontMetrics } from '../ui/workspaceTypography';
import { ProjectFilesDivider } from './ProjectFilesDivider';
import { projectFilesDirectoryRowHeight } from './projectFilesSplit';
import { compiledProjectFilePreview } from './projectFilePreview';
import { boundedProjectFilePreviewSource, type ProjectFilesController } from './useProjectFilesController';
import { useProjectFilesSplit } from './useProjectFilesSplit';
import { ProjectDocumentPreview } from './ProjectDocumentPreview';
import { PaneFontPinchSurface } from '../ui/PaneFontPinchSurface';
import { ProjectFileContents } from './ProjectFileContents';

type FileFontStep = (region: 'list' | 'preview', direction: 1 | -1) => void;

export function ProjectFilesPane({ controller, rootLabel = 'Project', rootPath = '', presentation, width, focused, onRequestFocus, onOpenMedia, onFontStep, listFontScale = 1, previewFontScale = 0.88 }: {
  controller: ProjectFilesController;
  rootLabel?: string;
  rootPath?: string;
  presentation: 'sidebar' | 'overlay';
  width: number;
  focused: boolean;
  onRequestFocus: () => void;
  onOpenMedia: (attachments: WorkspaceAttachment[], initialID: string) => void;
  listFontScale?: number;
  previewFontScale?: number;
  onFontStep?: FileFontStep;
}) {
  const split = useProjectFilesSplit(controller.open);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [controller.open, controller.content?.projectId, controller.content?.path]);
  const showingExpanded = expanded && controller.content?.kind === 'text' && controller.content.mimeType === 'text/html' && controller.previewPhase !== 'error';
  if (!controller.open) return null;
  const directoryPath = rootPath ? `${rootPath.replace(/\/+$/, '')}${controller.path ? `/${controller.path}` : ''}` || '/'
    : rootLabel === 'Project' ? `./${controller.path}` : `${rootLabel}/${controller.path}`;
  const pane = <Pane expanded={showingExpanded} onToggleExpanded={() => setExpanded(value => !value)} controller={controller} rootLabel={rootLabel} directoryPath={directoryPath} focused={focused} listFontScale={listFontScale} previewFontScale={previewFontScale} split={split} onFontStep={onFontStep} onRequestFocus={onRequestFocus} onOpenMedia={onOpenMedia} />;
  return <View accessibilityViewIsModal={showingExpanded || presentation === 'overlay'} style={showingExpanded || presentation === 'overlay' ? styles.overlaySafe : [styles.sidebar, { width }]}>{pane}</View>;
}

function Pane({ expanded, onToggleExpanded, controller, rootLabel, directoryPath, focused, listFontScale, previewFontScale, split, onRequestFocus, onOpenMedia, onFontStep }: {
  controller: ProjectFilesController;
  expanded: boolean;
  onToggleExpanded: () => void;
  rootLabel: string;
  directoryPath: string;
  focused: boolean;
  listFontScale: number;
  previewFontScale: number;
  split: ReturnType<typeof useProjectFilesSplit>;
  onFontStep: FileFontStep | undefined;
  onRequestFocus: () => void;
  onOpenMedia: (attachments: WorkspaceAttachment[], initialID: string) => void;
}) {
  const list = useRef<FlatList>(null);
  const rowHeight = projectFilesDirectoryRowHeight(listFontScale);
  const focusName = rootLabel === 'Project' ? 'project' : rootLabel;
  const directoryEntries = useMemo(() => controller.phase === 'ready' ? controller.entries : [], [controller.phase, controller.entries]);
  useEffect(() => {
    if (controller.selectedIndex >= 0 && controller.selectedIndex < directoryEntries.length) list.current?.scrollToIndex({ index: controller.selectedIndex, animated: false, viewPosition: 0.5 });
  }, [controller.selectedIndex, directoryEntries, rowHeight]);
  return <View accessibilityLabel={`${rootLabel} files`} style={[styles.pane, focused && styles.focusedPane]}>
    <View style={styles.header}>
      <View style={styles.headerControls}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Focus ${focusName} files`} onPress={onRequestFocus} style={styles.headerIdentity}>
        <Text style={[styles.headerGlyph, workspaceFontMetrics(11, listFontScale)]}>▰</Text><Text numberOfLines={1} style={[styles.headerTitle, workspaceFontMetrics(11, listFontScale)]}>FILES</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Parent directory" onPress={controller.parent} style={styles.headerButton}><Text style={[styles.headerButtonText, workspaceFontMetrics(14, listFontScale)]}>↑</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${rootLabel} files help`} onPress={() => controller.setHelpVisible(!controller.helpVisible)} style={styles.headerButton}><Text style={[styles.headerButtonText, workspaceFontMetrics(14, listFontScale)]}>?</Text></Pressable>
      </View>
      <Text numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={`${rootLabel} path ${directoryPath}`} style={[styles.path, workspaceFontMetrics(type.sizeSm, listFontScale)]}>{directoryPath}</Text>
    </View>
    <ProjectFileSortMenu sorting={controller.sorting} fontScale={listFontScale} onFocus={() => { onRequestFocus(); controller.setRegion('list'); }} />
    {controller.helpVisible ? <FileHelp fontScale={listFontScale} /> : null}
    <View style={styles.body} onLayout={(event) => split.onLayoutHeight(event.nativeEvent.layout.height)}>
      <PaneFontPinchSurface style={{ flex: 0, height: split.listHeight, ...(expanded ? { display: 'none' } : {}) }} onStep={(direction) => { onRequestFocus(); controller.setRegion('list'); onFontStep?.('list', direction); }}>
      <FlatList ref={list} accessibilityLabel="Project file list" style={styles.list}
        data={directoryEntries}
        keyExtractor={(entry) => entry.path} extraData={`${controller.selectedIndex}:${focused ? 1 : 0}:${controller.region}:${rowHeight}`}
        getItemLayout={(_data, index) => ({ index, length: rowHeight, offset: rowHeight * index })}
        initialNumToRender={16} maxToRenderPerBatch={24}
        ListEmptyComponent={<Notice fontScale={listFontScale} tone={controller.phase === 'error' ? 'error' : 'muted'} text={controller.phase === 'loading' ? 'reading directory…' : controller.phase === 'error' ? controller.problem : 'empty directory'} />}
        renderItem={({ item: entry, index }) => <Pressable
          accessibilityRole="button" accessibilityLabel={`${entry.kind} ${entry.name}`}
          accessibilityState={{ selected: index === controller.selectedIndex }}
          onPress={() => { onRequestFocus(); controller.openEntry(index); }}
          style={[styles.entry, { height: rowHeight }, index === controller.selectedIndex && styles.selectedEntry, focused && controller.region === 'list' && index === controller.selectedIndex && styles.activeEntry]}
        >
          <Text style={[styles.entryIcon, workspaceFontMetrics(11, listFontScale), { width: 19 * listFontScale }, entry.kind === 'directory' && styles.directoryIcon]}>{icon(entry.kind)}</Text>
          <Text numberOfLines={1} style={[styles.entryName, workspaceFontMetrics(11, listFontScale)]}>{entry.name}{entry.kind === 'directory' ? '/' : ''}</Text>
          <Text style={[styles.entryMeta, workspaceFontMetrics(8, listFontScale)]}>{entry.kind === 'directory' ? 'dir' : byteSize(entry.size)}</Text>
        </Pressable>}
      />
      </PaneFontPinchSurface>
      <View style={expanded ? { display: 'none' } : undefined}><ProjectFilesDivider dividerHeight={split.dividerHeight} listHeight={split.listHeight} panHandlers={split.dividerPanHandlers} onResize={split.resize} onRequestFocus={onRequestFocus} /></View>
      <FilePreview expanded={expanded} onToggleExpanded={onToggleExpanded} controller={controller} onFontStep={onFontStep} focused={focused} fontScale={previewFontScale} onRequestFocus={onRequestFocus} onOpenMedia={onOpenMedia} />
    </View>
    <View style={styles.footer}>
      <Text style={[styles.footerMode, workspaceFontMetrics(8, listFontScale)]}>{controller.region === 'preview' ? 'PREVIEW' : 'NORMAL'}</Text>
      <Text numberOfLines={1} style={[styles.footerHint, workspaceFontMetrics(7, listFontScale)]}>{controller.searchQuery !== null ? `${controller.searchDirection === 1 ? '/' : '?'}${controller.searchQuery}▏` : controller.region === 'preview' && focused && controller.content?.kind === 'text' ? 'j/k scroll · Tab list · Esc close' : `${controller.showHidden ? 'hidden:on' : 'hidden:off'} · Enter open · - parent · / ? search`}</Text>
    </View>
  </View>;
}

function FilePreview({ expanded, onToggleExpanded, controller, focused, fontScale, onRequestFocus, onOpenMedia, onFontStep }: { expanded: boolean; onToggleExpanded: () => void; onFontStep: FileFontStep | undefined; controller: ProjectFilesController; focused: boolean; fontScale: number; onRequestFocus: () => void; onOpenMedia: (attachments: WorkspaceAttachment[], initialID: string) => void }) {
  const scroll = useRef<FlatList<ReturnType<typeof compiledProjectFilePreview>[number]>>(null);
  const retryFrame = useRef<number | null>(null);
  const retries = useRef(0);
  const revealPosition = useRef(0.1);
  const [previewWidth, setPreviewWidth] = useState(0);
  const visibleRow = useRef<number | null>(null);
  const previousReveal = useRef<{ file: string; row: number; width: number; font: number } | null>(null);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find(item => item.isViewable && item.index !== null);
    if (first) visibleRow.current = first.index;
  }).current;
  const content = controller.content;
  const fileIdentity = content ? `${content.projectId}:${content.path}:${content.mtimeMs}:${content.size}` : '';
  useLayoutEffect(() => {
    if (retryFrame.current !== null) cancelAnimationFrame(retryFrame.current);
    retryFrame.current = null; retries.current = 0;
    const row = controller.previewNavigation.cursor.row;
    const previous = previousReveal.current;
    const sameSelection = previous?.file === fileIdentity && previous.row === row;
    const reflow = previous && (previous.width !== previewWidth || previous.font !== fontScale);
    const restoreReadingRow = sameSelection && reflow && previous.width > 0 && visibleRow.current !== null;
    const target = restoreReadingRow ? visibleRow.current! : row;
    revealPosition.current = restoreReadingRow ? 0 : 0.1;
    previousReveal.current = { file: fileIdentity, row, width: previewWidth, font: fontScale };
    if (!sameSelection) visibleRow.current = null;
    if (content?.kind === 'text' && (controller.region === 'preview' || reflow)) {
      scroll.current?.scrollToIndex({ index: target, animated: false, viewPosition: revealPosition.current });
    }
    return () => { if (retryFrame.current !== null) cancelAnimationFrame(retryFrame.current); retryFrame.current = null; };
  }, [fileIdentity, controller.previewNavigation.cursor.row, fontScale, previewWidth]);
  const bounded = content?.kind === 'text' ? boundedProjectFilePreviewSource(content.text) : null;
  const lines = useMemo(() => bounded && content?.kind === 'text' ? compiledProjectFilePreview(bounded.source, content.mimeType, content.path) : [], [bounded?.source, content?.mimeType, content?.path]);
  const focusPreview = () => { onRequestFocus(); controller.setRegion('preview'); };
  if (!controller.selectedEntry) return <View style={styles.preview}><Notice fontScale={fontScale} text={controller.problem || 'select a file to preview'} /></View>;
  if (controller.selectedEntry.kind === 'directory') return <View style={styles.preview}><Notice fontScale={fontScale} text="Enter opens this directory" /></View>;
  const shareFallback = (message: string) => <ProjectFileShareFallback key={`${controller.projectId}:${controller.scopeKey}:${controller.selectedEntry!.path}:${controller.selectedEntry!.size}:${controller.selectedEntry!.mtimeMs}`} entry={controller.selectedEntry!} projectId={controller.projectId} readFileForSharing={controller.readFileForSharing} fontScale={fontScale} onFocus={focusPreview} message={message} />;
  if (controller.selectedEntry.kind === 'unsupported') return shareFallback(`${controller.selectedEntry.name} · Preview not supported for this file type. Its folder is open in Files.`);
  if (controller.previewPhase === 'loading' && !content) return <View style={styles.preview}><Notice fontScale={fontScale} text="loading preview…" /></View>;
  if (controller.previewPhase === 'error') return shareFallback(controller.previewProblem);
  if (!content) return shareFallback('preview unavailable');
  const frame = (children: React.ReactNode) => <ProjectFileContents expanded={expanded} onToggleExpanded={onToggleExpanded} key={`${content.projectId}:${content.path}:${content.mtimeMs}:${content.size}`} content={content} onNativePreviewActive={controller.setNativePreviewActive} checking={controller.previewPhase !== 'ready'} fontScale={fontScale} onFocus={focusPreview}>{children}</ProjectFileContents>;
  if (content.kind === 'document') return frame(<ProjectDocumentPreview key={`${content.projectId}:${content.path}:${content.mtimeMs}:${content.size}`} content={content} onFocus={focusPreview} />);
  if (content.kind === 'image') return frame(<ImagePreview key={content.path} path={content.path} uri={`data:${content.mimeType};base64,${content.dataBase64}`} fontScale={fontScale} onFocus={() => { onRequestFocus(); controller.setRegion('preview'); }} onOpen={() => { const id = `files:${content.projectId}:${content.path}`; onOpenMedia([{ id, filename: content.path.split('/').pop() ?? content.path, mimeType: content.mimeType, byteCount: content.size, uri: `data:${content.mimeType};base64,${content.dataBase64}` }], id); }} />);
  // Discard only VirtualizedList's stale offscreen metrics when row geometry changes.
  return frame(<PaneFontPinchSurface onStep={(direction) => { onRequestFocus(); controller.setRegion('preview'); onFontStep?.('preview', direction); }}><FlatList key={`${previewWidth}:${fontScale}`} ref={scroll} accessibilityLabel={`Rendered preview ${content.path}`} style={styles.preview} contentContainerStyle={styles.previewContent}
    data={lines}
    onLayout={event => setPreviewWidth(event.nativeEvent.layout.width)}
    onViewableItemsChanged={onViewableItemsChanged}
    onScrollBeginDrag={() => { if (retryFrame.current !== null) cancelAnimationFrame(retryFrame.current); retryFrame.current = null; }}
    keyExtractor={(_line, index) => `${content.path}:${index}`} extraData={{ navigation: controller.previewNavigation, focused, region: controller.region, fontScale }}
    initialNumToRender={16} maxToRenderPerBatch={24} windowSize={7}
    onScrollToIndexFailed={({ index, averageItemLength }) => {
      const attemptedList = scroll.current;
      const viewPosition = revealPosition.current;
      attemptedList?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false });
      if (retryFrame.current !== null) cancelAnimationFrame(retryFrame.current);
      retryFrame.current = null;
      // A cold reflow may need to measure several of the bounded 600 rows.
      if (retries.current++ < 32) {
        const frame = requestAnimationFrame(() => {
          if (retryFrame.current !== frame || scroll.current !== attemptedList) return;
          retryFrame.current = null;
          attemptedList?.scrollToIndex({ index, animated: false, viewPosition });
        });
        retryFrame.current = frame;
      }
    }}
    renderItem={({ item: line, index }) => <Pressable onPress={() => { onRequestFocus(); controller.selectPreviewLine(index); }} style={styles.markdownLine}>
      <TranscriptMarkdownLine line={line} row={index} navigation={controller.previewNavigation} cursorVisible={focused && controller.region === 'preview'} fontScale={fontScale} />
    </Pressable>}
    ListFooterComponent={bounded?.truncated ? <Notice fontScale={fontScale} text="preview bounded · edit handoff still uses the complete source" /> : null}
  /></PaneFontPinchSurface>);
}

function ImagePreview({ path, uri, fontScale, onFocus, onOpen }: { path: string; uri: string; fontScale: number; onFocus: () => void; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Preview ${path}`} accessibilityHint="Opens the image in the full-screen viewer" onPress={() => { onFocus(); onOpen(); }} style={styles.preview}>
    {failed ? <Notice fontScale={fontScale} tone="error" text="This image could not be displayed." /> : <Image source={{ uri }} onError={() => setFailed(true)} resizeMode="contain" style={styles.image} />}
  </Pressable>;
}

function FileHelp({ fontScale }: { fontScale: number }) { return <View accessibilityLabel="Project files keyboard help" style={styles.help}>
  <Text style={[styles.helpTitle, workspaceFontMetrics(9, fontScale)]}>OIL KEYS</Text>
  <Text style={[styles.helpText, workspaceFontMetrics(9, fontScale, 14)]}>Ctrl/Cmd +/- font size · pinch list or text preview to resize separately</Text>
  <Text style={[styles.helpText, workspaceFontMetrics(9, fontScale, 14)]}>j/k move · gg/G first/last · Enter/l open · - parent · _ root</Text>
  <Text style={[styles.helpText, workspaceFontMetrics(9, fontScale, 14)]}>gs sort · g. hidden · / ? search · n/N repeat/reverse · Ctrl-r refresh · q/Esc close</Text>
  <Text style={[styles.helpText, workspaceFontMetrics(9, fontScale, 14)]}>preview: h/j/k/l · w/b/e, W/B/E · gg/G · 0/$ · v/V/y source yank</Text>
  <Text style={[styles.helpText, workspaceFontMetrics(9, fontScale, 14)]}>Esc cancels search/selection before closing · i/I/a/A/o/O prompt handoff</Text>
</View>; }
function Notice({ text, fontScale, tone = 'muted' }: { text: string; fontScale: number; tone?: 'muted' | 'error' }) { return <Text style={[styles.notice, workspaceFontMetrics(9, fontScale, 14), tone === 'error' && styles.error]}>{text}</Text>; }
function icon(kind: string) { return kind === 'directory' ? '▸' : kind === 'text' ? '·' : '▧'; }
function byteSize(size: number) { return size < 1024 ? `${size}b` : size < 1024 * 1024 ? `${Math.round(size / 1024)}k` : `${(size / 1024 / 1024).toFixed(1)}m`; }

const styles = StyleSheet.create({
  overlaySafe: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 30, backgroundColor: colors.canvas },
  sidebar: { minWidth: 0, minHeight: 0, borderLeftWidth: 1, borderLeftColor: colors.borderStrong, backgroundColor: colors.canvas },
  pane: { flex: 1, minHeight: 0, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.canvas }, focusedPane: { borderColor: colors.activeAccent },
  header: { paddingHorizontal: space.sm, paddingTop: space.xs, paddingBottom: space.sm, gap: space.xs, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, backgroundColor: colors.surface },
  headerControls: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  headerIdentity: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.xs }, headerGlyph: { color: colors.yellow, fontFamily: type.mono, fontSize: 11 }, headerTitle: { flexShrink: 1, color: colors.inkBright, fontFamily: type.mono, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  path: { minWidth: 0, color: colors.inkMuted, fontFamily: type.mono, fontSize: type.sizeSm }, headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: space.xs, backgroundColor: colors.raised }, headerButtonText: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 14, fontWeight: '800' },
  help: { paddingHorizontal: 10, paddingVertical: 8, gap: 3, borderBottomWidth: 1, borderBottomColor: colors.yellow, backgroundColor: colors.raised }, helpTitle: { color: colors.yellow, fontFamily: type.mono, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, helpText: { color: colors.ink, fontFamily: type.mono, fontSize: 9, lineHeight: 14 },
  body: { flex: 1, minHeight: 0 }, list: { flex: 1, minHeight: 0 },
  entry: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, borderLeftWidth: 2, borderLeftColor: 'transparent' }, selectedEntry: { backgroundColor: colors.raised }, activeEntry: { borderLeftColor: colors.activeAccent }, entryIcon: { width: 19, color: colors.blue, fontFamily: type.mono, fontSize: 11 }, directoryIcon: { color: colors.yellow }, entryName: { flex: 1, color: colors.ink, fontFamily: type.mono, fontSize: 11 }, entryMeta: { marginLeft: 6, color: colors.faint, fontFamily: type.mono, fontSize: 8 },
  preview: { flex: 1, minHeight: 0, backgroundColor: colors.inset }, previewContent: { paddingBottom: space.lg }, previewLabel: { minHeight: 38, paddingHorizontal: 9, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, previewFilename: { color: colors.blue, fontFamily: type.mono, fontSize: 10, fontWeight: '800' }, previewInstruction: { marginTop: 2, color: colors.faint, fontFamily: type.mono, fontSize: 7 }, markdownLine: { minHeight: 18, paddingLeft: 8 }, image: { flex: 1, margin: 10, backgroundColor: colors.inset },
  notice: { paddingHorizontal: 10, paddingVertical: 9, color: colors.faint, fontFamily: type.mono, fontSize: 9, lineHeight: 14 }, error: { color: colors.red },
  footer: { height: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 8, borderTopWidth: 1, borderTopColor: colors.borderStrong, backgroundColor: colors.surface }, footerMode: { color: colors.canvas, backgroundColor: colors.activeAccent, fontFamily: type.mono, fontSize: 8, fontWeight: '900', paddingHorizontal: 5, paddingVertical: 2 }, footerHint: { flex: 1, color: colors.faint, fontFamily: type.mono, fontSize: 7, textAlign: 'right' },
});
