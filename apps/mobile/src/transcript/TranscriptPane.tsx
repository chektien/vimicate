import { transcriptForwardReviewBoundary } from './transcriptForwardReviewBoundary';
import { QuestionTargetScope } from '../questions/QuestionTargetScope';
import { TranscriptHistoryEnd } from './TranscriptHistoryEnd';
import { TranscriptDateDivider } from './TranscriptDateDivider';
import { useTranscriptResponseNotice } from './useTranscriptResponseNotice';
import { TranscriptNewResponses } from './TranscriptNewResponses';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import type { ApprovalDecision, WorkspaceMessage } from '../workspace/workspaceTypes';
import type { TranscriptRenderRow } from './transcriptRenderRows';
import { TranscriptSourceRow } from './TranscriptSourceRow';
import { projectTranscriptVimState, type TranscriptBuffer, type TranscriptVimState } from './transcriptVim';
import { useTranscriptViewport } from './useTranscriptViewport';
import { buildVisibleTranscriptRenderRows, retainStableTranscriptRenderRows, transcriptNavigationSourceRows, transcriptRenderIndexForSourceRow } from './transcriptVisibleRows';
import { workspaceFontMetrics } from '../ui/workspaceTypography';
import { transcriptEntryIndex, transcriptVisibleContentAnchor } from './transcriptViewportPolicy';
import type { TranscriptRevealOwnership } from './transcriptTailFollowPolicy';
import { TRANSCRIPT_BOTTOM_INSET, TRANSCRIPT_HORIZONTAL_INSET, TRANSCRIPT_VERTICAL_INSET } from './transcriptPaneGeometry';
import { TRANSCRIPT_PANE_BORDER_WIDTH } from './transcriptFocusMetrics';
import { retainTranscriptRecyclerTopology } from './transcriptRecyclerTopology';
import { SessionTranscriptFoldCache } from './sessionTranscriptFoldCache';
import { useTranscriptLayoutDiagnostics } from './useTranscriptLayoutDiagnostics';
import { useOlderHistoryRequestPresentation } from './useOlderHistoryRequestPresentation';
import { transcriptLinkAtVisibleSourceCursor } from './transcriptRenderedCursor';
import type { CompiledMarkdownLine, TranscriptLinkTarget } from './transcriptMarkdown';

export type TranscriptPaneHandle = {
  reveal: (sourceRow: number, force?: boolean, ownership?: TranscriptRevealOwnership, previousSourceRow?: number) => void;
  revealAfterRevision: (sourceRow: number, viewPosition?: number) => void;
  viewPositionForSourceRow: (sourceRow: number) => number | null;
  captureReviewPosition: () => { sourceRow: number; viewPosition: number } | null;
  toggleFold: (messageId: string, revealSourceRow?: number) => void;
  setFoldExpanded: (messageId: string, expanded: boolean, revealSourceRow?: number) => void;
  foldAtSourceRow: (sourceRow: number) => { messageId: string; messageIndex: number; sourceRow: number; expanded: boolean } | null;
  recoveryAtSourceRow: (sourceRow: number) => { messageId: string; state: NonNullable<WorkspaceMessage['recovery']>['state'] } | null;
  linkAtSourceCursor: (sourceRow: number, sourceColumn: number) => TranscriptLinkTarget | null;
  renderedLineAtSourceRow: (sourceRow: number) => CompiledMarkdownLine | undefined;
  navigationSourceRows: () => readonly number[];
  requestOlderHistory: () => boolean;
  requestNewerHistory: () => boolean;
};

export const TranscriptPane = forwardRef<TranscriptPaneHandle, {
  questionNotice?: string;
  hasNewerHistory?: boolean;
  responseMessages?: WorkspaceMessage[];
  onJumpToLatest?: () => void;
  onLoadNewer?: ((expandedMessageIDs: ReadonlySet<string>, retainedBoundaryMessageID?: string) => unknown | Promise<unknown>) | undefined;
  datasetKey: string;
  messages: WorkspaceMessage[];
  buffer: TranscriptBuffer;
  navigation: TranscriptVimState;
  focused: boolean;
  fontScale: number;
  onFocus: () => void;
  onSelect: (messageIndex: number, lineInMessage: number) => void;
  onNavigationProjection: (expected: TranscriptVimState, projected: TranscriptVimState) => void;
  onViewportReview: (sessionKey: string) => void;
  onApprovalDecision: (message: WorkspaceMessage, decision: ApprovalDecision) => void;
  onRecoverMessage: (messageID: string) => void;
  onOpenMedia: (attachments: NonNullable<WorkspaceMessage['attachments']>, initialID: string) => void;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  historyProblem?: string;
  onLoadOlder: (expandedMessageIDs: ReadonlySet<string>) => unknown | Promise<unknown>;
  onRetryHistory: (expandedMessageIDs: ReadonlySet<string>) => void;
}>(function TranscriptPane({ questionNotice, hasNewerHistory = false, responseMessages, onJumpToLatest, onLoadNewer, datasetKey, messages, buffer, navigation, focused, fontScale, onFocus, onSelect, onNavigationProjection, onViewportReview, onApprovalDecision, onRecoverMessage, onOpenMedia, canLoadOlder, loadingOlder, historyProblem, onLoadOlder, onRetryHistory }, ref) {
  const newResponses = useTranscriptResponseNotice(datasetKey, responseMessages ?? messages, !navigation.followTail);
  const loadedMessages = useRef(messages);
  useLayoutEffect(() => { loadedMessages.current = messages; }, [messages]);
  const expandedMessageCache = useMemo(() => new SessionTranscriptFoldCache(), []);
  const [foldRevision, setFoldRevision] = useState(0);
  const expandedMessages = useMemo(() => expandedMessageCache.expanded(datasetKey), [datasetKey, expandedMessageCache, foldRevision]);
  const actions = useRef({ onFocus, onSelect, onNavigationProjection, onApprovalDecision, onRecoverMessage, onOpenMedia, onRetryHistory: () => onRetryHistory(expandedMessages) });
  useLayoutEffect(() => {
    actions.current = { onFocus, onSelect, onNavigationProjection, onApprovalDecision, onRecoverMessage, onOpenMedia, onRetryHistory: () => onRetryHistory(expandedMessages) };
  });
  const toggleMessageFold = useCallback((messageID: string, _revealSourceRow?: number) => {
    if (expandedMessageCache.toggle(datasetKey, messageID)) setFoldRevision((current) => current + 1);
  }, [datasetKey, expandedMessageCache]);
  const setMessageFoldExpanded = useCallback((messageID: string, expanded: boolean, _revealSourceRow?: number) => {
    if (expandedMessageCache.setExpanded(datasetKey, messageID, expanded)) setFoldRevision((current) => current + 1);
  }, [datasetKey, expandedMessageCache]);
  const rowsRef = useRef<TranscriptRenderRow[]>([]);
  const rows = useMemo(() => retainStableTranscriptRenderRows(rowsRef.current,
    buildVisibleTranscriptRenderRows(messages, expandedMessages)), [expandedMessages, messages]);
  // Imperative input and the visible recycler keep the committed snapshot if
  // React suspends or abandons a newer render. Rendering must not publish it.
  useLayoutEffect(() => { rowsRef.current = rows; }, [rows]);
  const olderHistory = useOlderHistoryRequestPresentation({
    datasetKey, messages, canLoadOlder, loadingOlder, historyProblem,
    onLoadOlder: () => { viewport.captureOlderHistoryAnchor(); return onLoadOlder(expandedMessages); },
  });
  const recyclerTopologyRef = useRef<TranscriptRenderRow[]>([]);
  const recyclerTopology = useMemo(() => {
    // FlashList owns ordered keys and native cell geometry. Current row
    // presentation travels through extraData instead, so a streaming text
    // revision cannot be mistaken for a recycler data-model mutation.
    const retained = retainTranscriptRecyclerTopology(recyclerTopologyRef.current, rows);
    return retained;
  }, [rows]);
  useLayoutEffect(() => { recyclerTopologyRef.current = recyclerTopology; }, [recyclerTopology]);
  const navigationRows = useMemo(() => transcriptNavigationSourceRows(rows), [rows]);
  const navigationIndexBySourceRow = useMemo(() => new Map(navigationRows.map((sourceRow, index) => [sourceRow, index])), [navigationRows]);
  const navigationRowsRef = useRef(navigationRows);
  useLayoutEffect(() => { navigationRowsRef.current = navigationRows; }, [navigationRows]);
  const projectedNavigation = useMemo(() => projectTranscriptVimState(navigation, buffer, navigationRows), [navigation, buffer, navigationRows]);
  const cursorNavigationIndex = navigationIndexBySourceRow.get(projectedNavigation.cursor.row) ?? 0;
  useEffect(() => {
    if (projectedNavigation.cursor.row !== navigation.cursor.row
      || (!!navigation.anchor && projectedNavigation.anchor?.row !== navigation.anchor.row)) {
      actions.current.onNavigationProjection(navigation, projectedNavigation);
    }
  }, [navigation, projectedNavigation]);
  // Viewport generation follows the recycler's ordered-key topology. Text-only
  // presentation revisions travel through extraData and must not invalidate
  // FlashList's mounted-cell proof while its native geometry is unchanged.
  const viewportRowKeys = useMemo(() => recyclerTopology.map(row => row.key), [recyclerTopology]);
  const acknowledgeUserReachedEnd = useCallback(() => newResponses.acknowledge(messages), [messages, newResponses.acknowledge]);
  const cursorRenderIndex = transcriptRenderIndexForSourceRow(rows, projectedNavigation.cursor.row);
  // The keyed recycler would otherwise paint its first frame at row 0 and
  // then scroll to the entry target, a blank flash on every thread switch.
  // Fixed once per dataset at its first render with rows: a dataset that
  // enters empty takes the index when history arrives, which FlashList
  // applies on its first non-empty layout. Render-phase state adjustment,
  // so an abandoned render cannot leak an index into the committed pane.
  const [entry, setEntry] = useState(() => ({ datasetKey, hasRows: rows.length > 0, index: transcriptEntryIndex(rows.length, navigation.followTail, cursorRenderIndex) }));
  let entryIndex = entry;
  if (entry.datasetKey !== datasetKey || !entry.hasRows && rows.length > 0) {
    entryIndex = { datasetKey, hasRows: rows.length > 0, index: transcriptEntryIndex(rows.length, navigation.followTail, cursorRenderIndex) };
    setEntry(entryIndex);
  }
  const viewport = useTranscriptViewport<TranscriptRenderRow>(datasetKey, recyclerTopology, rows.length, cursorRenderIndex, projectedNavigation.cursor.row, onViewportReview, viewportRowKeys, acknowledgeUserReachedEnd);
  useEffect(() => {
    if (!olderHistory.refreshing) viewport.retireUnchangedOlderHistoryAnchor();
  }, [olderHistory.refreshing, viewport.retireUnchangedOlderHistoryAnchor]);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const newerAttempt = useRef<object | null>(null);
  useLayoutEffect(() => { newerAttempt.current = null; setLoadingNewer(false); }, [datasetKey]);
  useEffect(() => () => { newerAttempt.current = null; }, []);
  const requestNewerHistory = useCallback(() => {
    if (!hasNewerHistory || !onLoadNewer || loadingOlder || newerAttempt.current) return false;
    const attempt = {}; newerAttempt.current = attempt; setLoadingNewer(true);
    const anchor = viewport.captureReviewAnchor('start');
    const retainedBoundaryMessageID = transcriptForwardReviewBoundary(messages,
      anchor ? rowsRef.current[anchor.row]?.messageIndex : undefined, expandedMessages);
    viewport.captureOlderHistoryAnchor();
    void Promise.resolve().then(() => onLoadNewer(expandedMessages, retainedBoundaryMessageID)).then(async result => {
      if (result && typeof result === 'object' && 'publication' in result) await result.publication;
    }).catch(() => undefined).finally(() => {
      if (newerAttempt.current !== attempt) return;
      newerAttempt.current = null; setLoadingNewer(false); viewport.retireUnchangedOlderHistoryAnchor();
    });
    return true;
  }, [messages, expandedMessages, hasNewerHistory, loadingOlder, onLoadNewer, viewport.captureReviewAnchor, viewport.captureOlderHistoryAnchor, viewport.retireUnchangedOlderHistoryAnchor]);
  const onCommitLayoutEffect = useTranscriptLayoutDiagnostics(datasetKey, recyclerTopology, rows, viewport.list);
  const onTranscriptLayoutCommit = useCallback(() => {
    viewport.onOlderHistoryLayoutCommit();
    onCommitLayoutEffect();
  }, [onCommitLayoutEffect, viewport.onOlderHistoryLayoutCommit]);
  const gutterWidth = Math.max(42 * fontScale, String(Math.max(1, buffer.lines.length)).length * 8 * fontScale + 12);
  const revealSourceRow = useCallback((sourceRow: number, force = false, ownership: TranscriptRevealOwnership = 'review', previousSourceRow?: number) => {
    const target = transcriptRenderIndexForSourceRow(rowsRef.current, sourceRow);
    if (ownership === 'review' && previousSourceRow !== undefined
      && sourceRow >= previousSourceRow && target === rowsRef.current.length - 1) {
      newResponses.acknowledge(loadedMessages.current);
    }
    viewport.reveal(
      target,
      force,
      ownership,
      previousSourceRow === undefined ? undefined : transcriptRenderIndexForSourceRow(rowsRef.current, previousSourceRow),
    );
  }, [viewport.reveal, newResponses.acknowledge]);
  const revealSourceRowAfterRevision = useCallback((sourceRow: number, viewPosition?: number) => {
    viewport.revealAfterRevision(transcriptRenderIndexForSourceRow(rowsRef.current, sourceRow), viewPosition);
  }, [viewport.revealAfterRevision]);
  const viewPositionForSourceRow = useCallback((sourceRow: number) => viewport.viewPositionForRow(transcriptRenderIndexForSourceRow(rowsRef.current, sourceRow)), [viewport.viewPositionForRow]);
  const listExtraData = useMemo(() => ({ navigation: projectedNavigation, focused, rowGeneration: rows, boundaryMessageIDs: olderHistory.boundaryMessageIDs }), [focused, projectedNavigation, rows, olderHistory.boundaryMessageIDs]);
  const keyExtractor = useCallback((item: TranscriptRenderRow) => item.key, []);
  const firstDateLabel = rows[0]?.chronology.dividerLabel;
  const historyHeader = useMemo(() => <><View style={styles.topSlot}>{loadingOlder
    ? null
    : historyProblem
      ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry transcript history: ${historyProblem}`} onPress={() => actions.current.onRetryHistory()}><Text numberOfLines={2} style={styles.historyError}>{`history unavailable · ${historyProblem} · tap to retry`}</Text></Pressable>
      : canLoadOlder
        ? <Pressable accessibilityRole="button" accessibilityLabel="Load older transcript history" onPress={olderHistory.request} style={styles.historyAction}><Text style={styles.historyActionText}>↑ Load older history</Text><Text style={styles.historyActionHint}>pull down · tap · k again at top</Text></Pressable>
        : null}</View><TranscriptDateDivider label={firstDateLabel} fontScale={fontScale} /></>, [canLoadOlder, historyProblem, loadingOlder, firstDateLabel, fontScale, olderHistory.request]);
  const historyFooter = useMemo(() => hasNewerHistory && onJumpToLatest
    ? <TranscriptHistoryEnd onPress={onJumpToLatest} onLoadNewer={onLoadNewer ? requestNewerHistory : undefined} loadingNewer={loadingNewer} problem={historyProblem} />
    : null, [hasNewerHistory, onJumpToLatest, onLoadNewer, requestNewerHistory, loadingNewer, historyProblem]);
  const emptyTranscript = useMemo(() => <View style={styles.empty}><Text style={[styles.emptyText, workspaceFontMetrics(12, fontScale, 20)]}>~ no transcript loaded</Text><Text style={[styles.emptyDetail, workspaceFontMetrics(10, fontScale, 17)]}>checking this workspace's session history…</Text></View>, [fontScale]);
  const renderRow = useCallback(({ index }: { item: TranscriptRenderRow; index: number }) => {
    const item = rows[index];
    if (!item) return null;
    const content = <TranscriptSourceRow
      row={item}
      followingDateLabel={rows[index + 1]?.firstInMessage ? rows[index + 1]?.chronology.dividerLabel : undefined}
      navigation={projectedNavigation}
      focused={focused}
      fontScale={fontScale}
      gutterWidth={gutterWidth}
      sourceNavigationIndex={index}
      cursorNavigationIndex={cursorNavigationIndex}
      onPress={() => { viewport.holdReviewAnchor(item.fold ? 'fold' : 'navigation'); actions.current.onFocus(); actions.current.onSelect(item.messageIndex, item.lineInMessage); if (item.fold) toggleMessageFold(item.foldKey ?? item.message.id, item.sourceRow); }}
      onToggleFold={() => { actions.current.onSelect(item.messageIndex, item.lineInMessage); viewport.holdReviewAnchor(); toggleMessageFold(item.foldKey ?? item.message.id, item.sourceRow); }}
      onApprovalDecision={(decision) => actions.current.onApprovalDecision(item.message, decision)}
      onRecoverMessage={() => actions.current.onRecoverMessage(item.message.id)}
      onOpenMedia={(initialID) => { if (item.message.attachments) actions.current.onOpenMedia(item.message.attachments, initialID); }}
    />;
    const source = item.lastInMessage && (item.message.question || item.message.asyncQuestion)
      ? <QuestionTargetScope key={`${datasetKey}:${item.key}`} cancel={viewport.cancelRegionReveal} capture={() => viewport.captureRegionPosition(index)} reveal={region => viewport.revealRegion(index, region)}>{content}</QuestionTargetScope>
      : content;
    // Like day separators, the load boundary trails the preceding cell so
    // inserting it never moves the retained message's text within its cell.
    const following = rows[index + 1];
    const boundary = following?.firstInMessage && olderHistory.boundaryMessageIDs.includes(following.message.id);
    return <View style={index === rows.length - 1 && !hasNewerHistory ? styles.tailCell : undefined}>{boundary
      ? <>{source}<TranscriptDateDivider label="Previously loaded" accessibilityLabel="Older history boundary" fontScale={fontScale} /></>
      : source}</View>;
  }, [datasetKey, hasNewerHistory, cursorNavigationIndex, focused, fontScale, gutterWidth, olderHistory.boundaryMessageIDs, projectedNavigation, rows, toggleMessageFold, viewport.holdReviewAnchor, viewport.cancelRegionReveal, viewport.captureRegionPosition, viewport.revealRegion]);
  useImperativeHandle(ref, () => ({
    reveal: revealSourceRow,
    revealAfterRevision: revealSourceRowAfterRevision,
    viewPositionForSourceRow,
    captureReviewPosition: () => {
      const anchor = viewport.captureReviewAnchor();
      if (!anchor) return null;
      const row = rowsRef.current[anchor.row];
      return row ? { sourceRow: row.sourceRow, viewPosition: anchor.viewPosition } : null;
    },
    toggleFold: (messageId, sourceRow) => { viewport.holdReviewAnchor(); toggleMessageFold(messageId, sourceRow); },
    setFoldExpanded: (messageId, expanded, sourceRow) => { viewport.holdReviewAnchor(); setMessageFoldExpanded(messageId, expanded, sourceRow); },
    foldAtSourceRow: (sourceRow) => {
      const row = rowsRef.current[transcriptRenderIndexForSourceRow(rowsRef.current, sourceRow)];
      return row?.fold ? { messageId: row.foldKey ?? row.message.id, messageIndex: row.messageIndex, sourceRow: row.sourceRow, expanded: row.fold.expanded } : null;
    },
    recoveryAtSourceRow: (sourceRow) => {
      const row = rowsRef.current[transcriptRenderIndexForSourceRow(rowsRef.current, sourceRow)];
      return row?.message.recovery ? { messageId: row.message.id, state: row.message.recovery.state } : null;
    },
    renderedLineAtSourceRow: (sourceRow) => rowsRef.current.find((row) => row.sourceRow === sourceRow)?.compiled,
    linkAtSourceCursor: (sourceRow, sourceColumn) => transcriptLinkAtVisibleSourceCursor(rowsRef.current, sourceRow, sourceColumn),
    navigationSourceRows: () => navigationRowsRef.current,
    requestOlderHistory: olderHistory.request,
    requestNewerHistory,
  }), [olderHistory.request, requestNewerHistory, revealSourceRow, revealSourceRowAfterRevision, setMessageFoldExpanded, toggleMessageFold, viewPositionForSourceRow, viewport.holdReviewAnchor, viewport.captureReviewAnchor]);
  return (
    <Pressable accessible={false} onPress={onFocus} style={[styles.root, focused && styles.focused]}>
      <FlashList
        // Native recycler geometry is dataset-owned too. Reusing one
        // FlashList instance across project sessions lets the previous
        // session's retained content offset win after the JS navigation cache
        // has restored the correct source row. A session-keyed instance starts
        // with no foreign native offset; useSessionTranscriptNavigation then
        // performs the one explicit row/position restoration for this dataset.
        key={datasetKey}
        initialScrollIndex={entryIndex.index}
        ref={viewport.list}
        data={recyclerTopology}
        extraData={listExtraData}
        keyExtractor={keyExtractor}
        drawDistance={1_200}
        maintainVisibleContentPosition={transcriptVisibleContentAnchor}
        onLayout={viewport.onLayout}
        onScroll={viewport.onScroll}
        onScrollBeginDrag={viewport.onScrollBeginDrag}
        onScrollEndDrag={viewport.onScrollEndDrag}
        onMomentumScrollBegin={viewport.onMomentumScrollBegin}
        onMomentumScrollEnd={viewport.onMomentumScrollEnd}
        onViewableItemsChanged={viewport.onViewableItemsChanged}
        scrollEventThrottle={32}
        onContentSizeChange={viewport.onContentSizeChange}
        onCommitLayoutEffect={onTranscriptLayoutCommit}
        onRefresh={canLoadOlder || (loadingOlder && !loadingNewer) ? olderHistory.request : undefined}
        refreshing={olderHistory.refreshing && !loadingNewer}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<>{questionNotice ? <Text accessibilityRole="alert" style={styles.emptyDetail}>{questionNotice}</Text> : null}{historyHeader}</>}
        ListFooterComponent={historyFooter}
        renderItem={renderRow}
        ListEmptyComponent={emptyTranscript}
      />
      {olderHistory.status ? <View accessible accessibilityLiveRegion="polite" accessibilityLabel={`Older history status: ${olderHistory.status}`} pointerEvents="none" style={styles.historyFeedback}><Text style={styles.historyFeedbackText}>{olderHistory.status}</Text></View> : null}
      {!focused ? <View pointerEvents="none" style={styles.dim} /> : null}
      {(hasNewerHistory || newResponses.visible) && onJumpToLatest ? <TranscriptNewResponses onPress={onJumpToLatest} history={!newResponses.visible} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // Focus changes colour only. A border-width change alters the FlashList
  // content width, rewraps long rows, and can move its retained anchor.
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas, borderWidth: TRANSCRIPT_PANE_BORDER_WIDTH, borderColor: colors.border }, focused: { borderColor: colors.activeAccent }, content: { paddingHorizontal: TRANSCRIPT_HORIZONTAL_INSET }, topSlot: { minHeight: 34, paddingVertical: TRANSCRIPT_VERTICAL_INSET, justifyContent: 'center' }, tailCell: { paddingBottom: TRANSCRIPT_BOTTOM_INSET }, historyAction: { alignSelf: 'center', minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.inset }, historyActionText: { color: colors.yellow, fontFamily: type.mono, fontSize: 9, fontWeight: '700' }, historyActionHint: { color: colors.faint, fontFamily: type.mono, fontSize: 8 }, historyError: { color: colors.red, fontFamily: type.mono, fontSize: 9, textAlign: 'center' }, historyFeedback: { position: 'absolute', top: 0, left: 0, right: 0, minHeight: 34, alignItems: 'center', justifyContent: 'center', zIndex: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.canvas, paddingHorizontal: 8, paddingVertical: 4 }, historyFeedbackText: { color: colors.yellow, fontFamily: type.mono, fontSize: 9, fontWeight: '700' }, empty: { paddingHorizontal: TRANSCRIPT_HORIZONTAL_INSET, paddingVertical: TRANSCRIPT_VERTICAL_INSET }, emptyText: { color: colors.faint, fontFamily: type.mono, fontSize: 12 }, emptyDetail: { marginTop: 3, color: colors.inkMuted, fontFamily: type.mono, fontSize: 10 }, dim: { position: 'absolute', inset: 0, backgroundColor: 'rgba(29,32,33,0.18)' },
});
