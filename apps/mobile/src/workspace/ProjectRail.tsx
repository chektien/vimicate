import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { colors, type } from '../theme/tokens';
import type { WorkspaceProject } from './workspaceTypes';
import { tintForWorkspaceGroup, workspaceGroupTintMap } from './workspaceGroupTint';
import { projectRunGlyph, projectRunLabel } from './runProjectPresentation';
import { projectRevealPosition, shouldRevealProjectIndex, type ProjectRailVisibleRange } from './projectRailViewport';
import { workspaceFontMetrics } from '../ui/workspaceTypography';
import { projectHierarchyMeta, projectParentLabel } from './projectHierarchyPresentation';
import { PROJECT_CARD_LEFT_INSET, PROJECT_RAIL_LIST_LEFT_INSET, projectCardRightInset } from '../layout/projectRailGeometry';
import { PROJECT_RAIL_HEADER_ICON_SIZES, projectSortIconColor } from './projectRailHeaderPresentation';
import { useActiveInterval } from '../lifecycle/useActiveInterval';

type ProjectRailProps = {
  projects: WorkspaceProject[];
  emptyLabel: string;
  activeKey: string;
  focusedKey: string;
  focused: boolean;
  fontScale: number;
  reflowSuppressed: boolean;
  sortMode: 'manual' | 'activity';
  collapsedRootKeys: ReadonlySet<string>;
  onToggleSort: () => void;
  onSelect: (key: string) => void;
  onToggleFold: (key: string) => void;
  onToggleStar: (key: string) => void;
  onRefresh: () => void;
  compactDrawer?: boolean;
  onClose?: (() => void) | undefined;
};

export function ProjectRail({ projects, emptyLabel, activeKey, focusedKey, focused, fontScale, reflowSuppressed, sortMode, collapsedRootKeys, onToggleSort, onSelect, onToggleFold, onToggleStar, onRefresh, compactDrawer = false, onClose }: ProjectRailProps) {
  const list = useRef<FlatList<WorkspaceProject>>(null);
  const visibleRange = useRef<ProjectRailVisibleRange>(null);
  const focusedIndex = projects.findIndex((project) => project.sessionKey === focusedKey);
  const activeRootKey = projects.find((project) => project.sessionKey === activeKey)?.rootSessionKey;
  const groupTints = useMemo(() => workspaceGroupTintMap(projects.map((project) => project.group || project.projectName || '').filter(Boolean)), [projects]);
  const [clock, setClock] = useState(Date.now());
  const starredRootKeys = useMemo(() => new Set(projects.filter((project) => project.kind !== 'thread' && project.starred).map((project) => project.sessionKey)), [projects]);
  const inStarredSection = useCallback((project: WorkspaceProject) => project.kind === 'thread' ? starredRootKeys.has(project.rootSessionKey || '') : starredRootKeys.has(project.sessionKey), [starredRootKeys]);
  const firstAllProjectIndex = sortMode === 'manual' ? projects.findIndex((project) => !inStarredSection(project)) : -1;
  const starredRootCount = projects.filter((project) => project.kind !== 'thread' && inStarredSection(project)).length;
  const allRootCount = projects.filter((project) => project.kind !== 'thread' && !inStarredSection(project)).length;

  useEffect(() => {
    if (focused && focusedIndex >= 0 && shouldRevealProjectIndex(focusedIndex, visibleRange.current)) list.current?.scrollToIndex({ index: focusedIndex, animated: false, viewPosition: projectRevealPosition(focusedIndex, visibleRange.current) });
  }, [focused, focusedIndex]);
  useActiveInterval(() => { if (!reflowSuppressed) setClock(Date.now()); }, 30_000, true, true);
  useEffect(() => { if (!reflowSuppressed) setClock(Date.now()); }, [reflowSuppressed]);

  return (
    <View accessibilityLabel={`Projects pane, ${focused ? 'focused' : 'not focused'}`} style={[styles.root, compactDrawer && styles.rootCompact, focused && styles.rootFocused]}>
      <View style={styles.header}>
        <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={[styles.heading, workspaceFontMetrics(12, fontScale)]}>projects</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Toggle project sort" accessibilityState={{ selected: sortMode === 'activity' }} hitSlop={8} onPress={onToggleSort} style={styles.headerAction}><Text style={[styles.headerActionGlyph, workspaceFontMetrics(PROJECT_RAIL_HEADER_ICON_SIZES.sort, fontScale), { color: projectSortIconColor(sortMode) }]}>◴</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh projects and check for app updates" hitSlop={8} onPress={onRefresh} style={styles.headerAction}><Text style={[styles.headerActionGlyph, workspaceFontMetrics(PROJECT_RAIL_HEADER_ICON_SIZES.refresh, fontScale)]}>↻</Text></Pressable>
        {compactDrawer && onClose ? <Pressable accessibilityRole="button" accessibilityLabel="Close project switcher" hitSlop={8} onPress={onClose} style={styles.headerAction}><Text style={[styles.headerActionGlyph, styles.close, workspaceFontMetrics(PROJECT_RAIL_HEADER_ICON_SIZES.close, fontScale)]}>×</Text></Pressable> : null}
      </View>
      <FlatList
        ref={list}
        style={styles.scrollViewport}
        data={projects}
        keyExtractor={(project) => project.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="always"
        onViewableItemsChanged={({ viewableItems }: { viewableItems: ViewToken<WorkspaceProject>[] }) => {
          const indices = viewableItems.flatMap((item) => item.index === null ? [] : [item.index]);
          visibleRange.current = indices.length ? { first: Math.min(...indices), last: Math.max(...indices) } : null;
        }}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          list.current?.scrollToOffset({ offset: Math.max(0, index * Math.max(34, averageItemLength)), animated: false });
          requestAnimationFrame(() => list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 }));
        }}
        ListHeaderComponent={sortMode === 'activity' ? <ActivityHeader count={projects.length} fontScale={fontScale} /> : <ManualHeader starredCount={starredRootCount} fontScale={fontScale} />}
        ListEmptyComponent={<Text accessibilityRole="text" style={[styles.emptyProjects, workspaceFontMetrics(9, fontScale, 14)]}>~ {emptyLabel}</Text>}
        ListFooterComponent={sortMode === 'manual' && firstAllProjectIndex < 0 ? <ManualAllHeader count={allRootCount} fontScale={fontScale} /> : null}
        renderItem={({ item: project, index }) => {
          const active = project.sessionKey === activeKey;
          const cursor = focused && project.sessionKey === focusedKey;
          const parentLabel = projectParentLabel(project, projects);
          const card = (
            <View style={[styles.row, sortMode === 'manual' && project.kind === 'thread' && styles.threadRow, active && styles.rowActive, cursor && styles.rowCursor]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${project.name}, ${parentLabel ? `thread in ${parentLabel}` : 'project'}, ${projectRunLabel(project.runPhase)}`}
                onPress={() => onSelect(project.sessionKey)}
                style={[styles.rowSelect, { paddingRight: projectCardRightInset(project.kind === 'thread') }, sortMode === 'manual' && project.kind === 'thread' && styles.threadRowSelect]}
              >
                <Text style={[styles.ordinal, workspaceFontMetrics(10, fontScale), cursor && styles.cursorText]}>{index + 1}</Text>
                {sortMode === 'manual' && project.kind !== 'thread' && project.threadCount > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={`${collapsedRootKeys.has(project.sessionKey) ? 'Expand' : 'Collapse'} ${project.name} threads`} hitSlop={8} onPress={(event) => { event.stopPropagation(); onToggleFold(project.sessionKey); }}><Text style={[styles.disclosure, workspaceFontMetrics(11, fontScale), cursor && styles.cursorMuted]}>{collapsedRootKeys.has(project.sessionKey) ? '›' : '⌄'}</Text></Pressable> : <Text style={[styles.disclosure, workspaceFontMetrics(11, fontScale), project.kind === 'thread' && styles.threadDisclosure, cursor && styles.cursorMuted]}>{project.kind === 'thread' ? sortMode === 'activity' ? '↳' : '└' : active || project.sessionKey === activeRootKey ? '⌄' : '›'}</Text>}
                <View style={[styles.rowBody, project.kind !== 'thread' && styles.rootRowBody]}>
                  <View style={styles.nameLine}>
                    <Text numberOfLines={1} style={[styles.name, workspaceFontMetrics(11, fontScale), project.kind === 'thread' && styles.threadName, cursor && styles.cursorText]}>{project.name.toLowerCase()}</Text>
                    <ProjectRunDot project={project} />
                  </View>
                  {project.path && !project.path.endsWith(project.name) && sortMode === 'manual' ? <Text numberOfLines={1} style={[styles.detail, workspaceFontMetrics(8, fontScale), cursor && styles.cursorMuted]}>{project.path}</Text> : null}
                  <View style={styles.metaLine}>
                    {sortMode === 'activity' || project.group ? <Text style={[styles.groupPill, workspaceFontMetrics(7.5, fontScale), groupPillStyle(project.group || project.projectName || project.name, groupTints), cursor && styles.groupPillCursor]}>{(project.group || project.projectName || project.name).toLowerCase()}</Text> : null}
                    <Text numberOfLines={1} style={[styles.meta, workspaceFontMetrics(8, fontScale), cursor && styles.cursorMuted]}>{parentLabel ? projectHierarchyMeta(project, projects) : sortMode === 'activity' ? 'root' : `${project.threadCount} thread${project.threadCount === 1 ? '' : 's'}`}</Text>
                    <View style={styles.metaSpacer} />
                    {sortMode === 'activity' && project.updatedAt ? <Text style={[styles.age, workspaceFontMetrics(8, fontScale), cursor && styles.cursorMuted]}>{relativeAge(project.updatedAt, clock)}</Text> : null}
                  </View>
                </View>
              </Pressable>
              {project.kind !== 'thread' ? <Pressable accessibilityRole="button" accessibilityLabel={`${project.starred ? 'Unstar' : 'Star'} ${project.name}`} hitSlop={5} style={styles.starButton} onPress={() => onToggleStar(project.sessionKey)}><Text style={[styles.star, workspaceFontMetrics(15, fontScale, 20), cursor && styles.cursorMuted]}>{project.starred ? '★' : '☆'}</Text></Pressable> : null}
            </View>
          );
          return sortMode === 'manual' && index === firstAllProjectIndex
            ? <View><ManualAllHeader count={allRootCount} fontScale={fontScale} />{card}</View>
            : card;
        }}
      />
      {!focused ? <View pointerEvents="none" style={styles.dim} /> : null}
    </View>
  );
}

function ActivityHeader({ count, fontScale }: { count: number; fontScale: number }) {
  return <View style={styles.activityHeader}><Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={[styles.activityTitle, workspaceFontMetrics(11, fontScale)]}>latest activity</Text><Text numberOfLines={1} style={[styles.sectionCount, workspaceFontMetrics(9, fontScale)]}>{count}</Text></View>;
}

function ManualHeader({ starredCount, fontScale }: { starredCount: number; fontScale: number }) {
  return <View><View style={styles.section}><Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={[styles.sectionTitle, workspaceFontMetrics(11, fontScale)]}>⌄ starred</Text><Text numberOfLines={1} style={[styles.sectionCount, workspaceFontMetrics(9, fontScale)]}>{starredCount}</Text></View>{starredCount ? null : <Text style={[styles.emptyStarred, workspaceFontMetrics(9, fontScale, 13)]}>☆  tap the star on a project to pin it here</Text>}</View>;
}

function ManualAllHeader({ count, fontScale }: { count: number; fontScale: number }) {
  return <View style={styles.section}><Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={[styles.sectionTitle, workspaceFontMetrics(11, fontScale)]}>⌄ all projects</Text><Text numberOfLines={1} style={[styles.sectionCount, workspaceFontMetrics(9, fontScale)]}>{count}</Text></View>;
}

function ProjectRunDot({ project }: { project: WorkspaceProject }) {
  const glyph = projectRunGlyph(project.runPhase);
  if (glyph) return <Text accessibilityLabel={`Run ${glyph.label}`} style={[styles.runGlyph, styles[glyph.tone]]}>{glyph.symbol}</Text>;
  if (project.unread) return <View accessibilityLabel="Unread output" style={[styles.dot, styles.unread]} />;
  return <View style={styles.dot} />;
}

function relativeAge(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function groupPillStyle(group: string, tints: ReadonlyMap<string, string>) {
  const tint = tintForWorkspaceGroup(group, tints);
  return { color: tint, borderColor: `${tint}73`, backgroundColor: `${tint}2e` };
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', minHeight: 0, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minWidth: 0 }, rootFocused: { borderWidth: 2, borderColor: colors.activeAccent },
  rootCompact: { width: '100%', height: '100%' },
  header: { minHeight: 42, paddingLeft: 6, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 3 },
  heading: { color: colors.ink, fontFamily: type.mono, fontSize: 12, fontWeight: '700', flex: 1 }, close: { color: colors.ink, fontWeight: '700' },
  headerAction: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerActionGlyph: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  scrollViewport: { flex: 1, minHeight: 0, overflow: 'hidden' }, list: { paddingLeft: PROJECT_RAIL_LIST_LEFT_INSET, paddingRight: 6, paddingBottom: 8 }, section: { height: 29, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2 }, activityHeader: { height: 31, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2 }, activityTitle: { flex: 1, color: colors.activeAccent, fontFamily: type.mono, fontSize: 11, fontWeight: '800' }, sectionTitle: { flex: 1, color: colors.faint, fontFamily: type.mono, fontSize: 11, fontWeight: '700' }, sectionCount: { color: colors.faint, fontFamily: type.mono, fontSize: 9, fontWeight: '700' }, emptyStarred: { color: colors.faint, fontFamily: type.mono, fontSize: 9, lineHeight: 13, paddingLeft: 3, paddingRight: 5, paddingBottom: 6 },
  row: { minHeight: 46, overflow: 'hidden', flexDirection: 'row', alignItems: 'stretch', marginBottom: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 5, backgroundColor: '#242525' }, rowActive: { borderColor: colors.yellow, backgroundColor: colors.canvas }, rowCursor: { borderWidth: 2, borderColor: colors.activeAccent, backgroundColor: colors.activeAccent },
  emptyProjects: { color: colors.faint, fontFamily: type.mono, fontSize: 9, lineHeight: 14, paddingHorizontal: 3, paddingTop: 5 },
  threadRow: { minHeight: 32, marginLeft: 12, backgroundColor: colors.canvas }, threadDisclosure: { color: colors.borderStrong }, threadName: { fontSize: 11, fontWeight: '600' },
  rowSelect: { flex: 1, minWidth: 0, overflow: 'hidden', flexDirection: 'row', alignItems: 'flex-start', paddingLeft: PROJECT_CARD_LEFT_INSET, paddingVertical: 7 }, threadRowSelect: { paddingVertical: 4 }, ordinal: { width: 18, paddingTop: 1, color: colors.faint, fontFamily: type.mono, fontSize: 10, fontWeight: '700', textAlign: 'right' }, disclosure: { width: 14, color: colors.faint, fontFamily: type.mono, fontSize: 11, textAlign: 'center' }, rowBody: { flex: 1, minWidth: 0, overflow: 'hidden' }, rootRowBody: { paddingRight: 30 },
  nameLine: { flexDirection: 'row', alignItems: 'center', minWidth: 0, overflow: 'hidden' }, name: { flex: 1, minWidth: 0, color: colors.ink, fontFamily: type.mono, fontSize: 11, fontWeight: '700' }, cursorText: { color: colors.canvas }, cursorMuted: { color: '#353733' }, starButton: { position: 'absolute', right: 1, top: 1, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, star: { color: colors.orange, fontFamily: type.mono, fontSize: 15, lineHeight: 20, textAlign: 'center' }, detail: { flexShrink: 1, minWidth: 0, color: colors.inkMuted, fontFamily: type.mono, fontSize: 8, marginTop: 2 }, metaLine: { minHeight: 13, minWidth: 0, overflow: 'hidden', marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 5 }, metaSpacer: { flex: 1, minWidth: 0 }, groupPill: { maxWidth: 74, flexShrink: 1, overflow: 'hidden', paddingHorizontal: 5, borderWidth: 1, borderRadius: 7, fontFamily: type.mono, fontSize: 7.5, fontWeight: '700' }, groupPillCursor: { color: colors.canvas, borderColor: colors.canvas, backgroundColor: colors.activeAccent }, meta: { flexShrink: 1, minWidth: 0, color: colors.yellow, fontFamily: type.mono, fontSize: 8, fontWeight: '700' }, age: { flexShrink: 0, color: colors.faint, fontFamily: type.mono, fontSize: 8, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'transparent', marginLeft: 5 }, unread: { backgroundColor: colors.blue }, runGlyph: { width: 10, marginLeft: 4, fontFamily: type.mono, fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' }, running: { color: colors.orange }, waiting: { color: colors.yellow }, uncertain: { color: colors.yellow }, failed: { color: colors.red }, dim: { position: 'absolute', inset: 0, backgroundColor: 'rgba(29,32,33,0.18)' },
});
