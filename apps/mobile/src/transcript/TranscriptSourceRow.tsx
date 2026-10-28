import { QuestionReadingFocus } from '../questions/QuestionReadingFocus';
import { TranscriptQueuedPrompt } from './TranscriptQueuedPrompt';
import { TranscriptAsyncQuestion } from '../questions/TranscriptAsyncQuestion'; import { TranscriptQuestion } from '../questions/TranscriptQuestion';
import { TranscriptDateDivider } from './TranscriptDateDivider';
import { transcriptRoleIsSearchable } from './transcriptSearch';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import type { ApprovalDecision } from '../workspace/workspaceTypes';
import { GatewayImage } from './GatewayImage';
import { transcriptGutterLabel } from './transcriptGutter';
import { TranscriptMarkdownLine } from './TranscriptMarkdownLine';
import type { TranscriptRenderRow } from './transcriptRenderRows';
import type { TranscriptVimState } from './transcriptVim';
import { workspaceFontMetrics } from '../ui/workspaceTypography';
import { transcriptSourceRowNavigationChanged } from './transcriptRowRenderPolicy';
import { transcriptAuthoredPromptChrome } from './transcriptAuthoredPromptChrome';
import { transcriptRowLifecycle, transcriptRowTimestamp } from './transcriptRowMetadata';
import { transcriptMessageMarker } from './transcriptPresentation';
import { transcriptGutterRailKind } from './transcriptGutterRail';
import { transcriptFocusMetrics } from './transcriptFocusMetrics';
import { attachmentOnlyPromptLabel, transcriptMediaPresentation } from './transcriptMediaPresentation';

type TranscriptSourceRowProps = {
  row: TranscriptRenderRow;
  followingDateLabel?: string | undefined;
  navigation: TranscriptVimState;
  focused: boolean;
  fontScale: number;
  gutterWidth: number;
  sourceNavigationIndex: number;
  cursorNavigationIndex: number;
  onPress: () => void;
  onToggleFold: () => void;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onOpenMedia: (attachmentID: string) => void;
  onRecoverMessage: () => void;
};

function TranscriptGutterNumber({ sourceRow, cursorRow, label, focused, fontScale, gutterWidth }: { sourceRow: number; cursorRow: number; label: string; focused: boolean; fontScale: number; gutterWidth: number }) {
  const current = sourceRow === cursorRow;
  return <Text allowFontScaling={false} numberOfLines={1} style={[styles.line, workspaceFontMetrics(11, fontScale, 20), { width: gutterWidth }, focused && current && styles.currentLine]}>{label}</Text>;
}

export const TranscriptSourceRow = memo(function TranscriptSourceRow(props: TranscriptSourceRowProps) {
  return props.row.message.question || props.row.message.asyncQuestion
    ? <QuestionReadingFocus message={props.row.message} focused={props.focused}>{textFocused => <TranscriptSourceRowContent {...props} textFocused={textFocused} />}</QuestionReadingFocus>
    : <TranscriptSourceRowContent {...props} textFocused={props.focused} />;
}, transcriptSourceRowPropsEqual);
function TranscriptSourceRowContent({ row, followingDateLabel, navigation, focused: paneFocused, textFocused: focused, fontScale, gutterWidth, sourceNavigationIndex, cursorNavigationIndex, onPress, onToggleFold, onApprovalDecision, onOpenMedia, onRecoverMessage }: TranscriptSourceRowProps & { textFocused: boolean }) {
  const { message, presentation } = row;
  const marker = transcriptMessageMarker(message);
  const attachmentLabel = row.firstInMessage ? attachmentOnlyPromptLabel(message) : null;
  const current = row.sourceRow === navigation.cursor.row;
  const authoredPrompt = transcriptAuthoredPromptChrome(message.role, row.firstInMessage, row.lastInMessage, current);
  const readSkills = row.firstInMessage ? row.readSkills : undefined;
  const messageFocused = navigation.cursor.row >= row.firstSourceRowInMessage && navigation.cursor.row <= row.lastSourceRowInMessage;
  const grouped = row.groupPosition !== 'standalone';
  const glyphWidth = (marker ? 23 : 7) * fontScale;
  const firstGap = row.firstInMessage ? presentation.user ? 4 : grouped ? row.groupPosition === 'first' ? 2 : 0 : 5 : 0;
  // Balance the authored band without changing its total message height.
  const lastGap = presentation.user && row.lastInMessage ? 4 : 0;
  const machine = !presentation.conversation;
  const lifecycle = row.firstInMessage ? transcriptRowLifecycle(message) : null;
  const timestamp = transcriptRowTimestamp(message, row.chronology, row.firstInMessage, focused, messageFocused, lifecycle);
  const gutterRail = transcriptGutterRailKind({ focused, current, authoredPrompt: authoredPrompt.band, grouped });
  const gutterLabel = transcriptGutterLabel(row.sourceRow, navigation.cursor.row, sourceNavigationIndex, cursorNavigationIndex);
  const focusMetrics = transcriptFocusMetrics(fontScale, focused);
  const rowAccessibilityLabel = `${message.role}, line ${row.sourceRow + 1}, gutter ${gutterLabel}, ${attachmentLabel ?? (row.compiled.source || 'blank')}${readSkills?.length ? `, skill read, ${readSkills.join(', ')}` : ''}${row.fold ? `, ${row.fold.expanded ? 'collapse' : 'expand'} details` : ''}`;
  return (
    <View>
      <Pressable accessible={false} onPress={onPress} style={[styles.root, { paddingTop: firstGap }, { paddingBottom: lastGap }, grouped && message.role !== 'tool' && styles.grouped, authoredPrompt.band && styles.authoredPrompt, focused && current && styles.current, focused && authoredPrompt.active && styles.authoredPromptActive]}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={rowAccessibilityLabel}
        accessibilityState={{ selected: focused && current, ...(row.fold ? { expanded: row.fold.expanded } : {}) }}
        onAccessibilityTap={onPress}
        pointerEvents="none"
        style={styles.accessibilityRow}
      />
      {gutterRail !== 'none' ? <View pointerEvents="none" style={[styles.gutterRail, gutterRail === 'active' ? styles.gutterRailActive : gutterRail === 'authored' ? styles.gutterRailAuthored : styles.gutterRailGrouped]} /> : null}
      {authoredPrompt.topEdge ? <View pointerEvents="none" style={[styles.authoredPromptEdge, styles.authoredPromptTopEdge]} /> : null}
      {authoredPrompt.bottomEdge ? <View pointerEvents="none" style={[styles.authoredPromptEdge, styles.authoredPromptBottomEdge]} /> : null}
      <View style={styles.gutterSpacer} />
      <View style={[styles.body, row.toolGroupDepth ? { paddingLeft: 12 * fontScale } : null]}>
        <View style={[styles.columns, { minHeight: (machine ? 18 : 20) * fontScale }, machine && styles.machineColumns]}>
          <TranscriptGutterNumber sourceRow={row.sourceRow} cursorRow={navigation.cursor.row} label={gutterLabel} focused={focused} fontScale={fontScale} gutterWidth={gutterWidth} />
          <Text allowFontScaling={false} style={[styles.marker, workspaceFontMetrics(11, fontScale, 20), { width: glyphWidth, color: presentation.tone }]}>{row.firstInMessage ? marker : ''}</Text>
          {attachmentLabel ? <Text style={[styles.attachmentLabel, workspaceFontMetrics(13, fontScale, 20)]}>{attachmentLabel}</Text> : <TranscriptMarkdownLine line={row.compiled} row={row.sourceRow} navigation={navigation} searchEnabled={transcriptRoleIsSearchable(message.role)} cursorVisible={focused} machine={machine} fontScale={fontScale} />}
          {row.fold && (row.firstInMessage || row.foldKey) ? <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.fold.expanded ? 'Collapse' : 'Expand'} ${message.toolGroup ? 'tool calls' : `${message.role} details`}`}
            accessibilityState={{ expanded: row.fold.expanded }}
            hitSlop={8}
            onPress={(event) => { event.stopPropagation(); onToggleFold(); }}
          ><Text style={[styles.foldToggle, workspaceFontMetrics(12, fontScale, 20)]}>{row.fold.expanded ? '⌄' : '▸'}</Text></Pressable> : null}
          {lifecycle ? <Text accessibilityLabel={lifecycle.label} style={[styles.lifecycle, workspaceFontMetrics(9, fontScale, 20), message.state === 'error' && styles.lifecycleError]}>{lifecycle.symbol}</Text> : timestamp ? <Text testID={`transcript-timestamp-${message.id}`} accessibilityLabel={`Sent at ${timestamp}`} numberOfLines={1} style={[styles.timestamp, workspaceFontMetrics(9, fontScale, 20), { width: focusMetrics.timestampWidth }, focused && messageFocused && styles.timestampFocused]}>{timestamp}</Text> : null}
        </View>
      </View>
      </Pressable>
      {row.lastInMessage && message.attachments?.length ? <Pressable accessible={false} onPress={onPress} style={[styles.mediaStrip, { marginLeft: gutterWidth + glyphWidth + 2 }]}>{message.attachments.map((attachment) => {
        const media = transcriptMediaPresentation(attachment);
        const mediaEnabled = Boolean(attachment.uri && media.image);
        return <Pressable accessible={false} disabled={!mediaEnabled} onPress={() => onOpenMedia(attachment.id)} key={attachment.id} style={styles.mediaCard}>
          <View accessible accessibilityRole="button" accessibilityLabel={`Open ${attachment.filename}`} accessibilityValue={media.image ? { text: media.caption ?? 'image dimensions pending' } : undefined} accessibilityState={{ disabled: !mediaEnabled }} onAccessibilityTap={mediaEnabled ? () => onOpenMedia(attachment.id) : undefined} pointerEvents="none" style={styles.mediaAccessibility} />
          {attachment.uri && media.image ? <GatewayImage attachment={attachment} style={styles.mediaImage} /> : <Text style={styles.mediaIcon}>▧</Text>}
          {media.caption ? <Text numberOfLines={1} style={media.image ? styles.mediaSize : styles.mediaName}>{media.caption}</Text> : null}
        </Pressable>;
      })}</Pressable> : null}
      {row.lastInMessage && message.recovery && message.recovery.state !== 'recovered' ? <Pressable
          accessibilityRole="button"
          accessibilityLabel={message.recovery.state === 'loading' ? 'Loading full response' : message.recovery.state === 'unavailable' ? 'Full response unavailable' : 'Load full response'}
          disabled={message.recovery.state === 'loading' || message.recovery.state === 'unavailable' || !message.recovery.sourceMessageId}
          onPress={onRecoverMessage}
          style={[styles.recovery, { marginLeft: gutterWidth + glyphWidth + 2 }]}
        ><Text style={styles.recoveryText}>{message.recovery.detail ?? (message.recovery.state === 'available' ? '↻ full response available · tap or Enter to load' : '↻ full response unavailable')}</Text></Pressable> : null}
      {row.lastInMessage && message.approval && !message.approval.resolved ? <View style={[styles.approvalActions, { marginLeft: gutterWidth + glyphWidth + 2 }]}>
          {message.approval.expiresAtMs ? <Text style={styles.approvalExpiry}>{approvalExpiry(message.approval.expiresAtMs)}</Text> : null}
          {message.approval.allowedDecisions.map((decision) => <Pressable key={decision} accessibilityRole="button" accessibilityLabel={`${decision} ${message.approval?.kind ?? ''} approval`} onPress={() => onApprovalDecision(decision)}><Text style={[styles.approvalButton, decision === 'deny' && styles.denyButton]}>{decision === 'allow-once' ? 'allow once' : decision === 'allow-always' ? 'always allow' : 'deny'}</Text></Pressable>)}
        </View> : null}
      {row.lastInMessage && message.question ? <TranscriptQuestion record={message.question} onFocus={onPress} focused={paneFocused && current} fontScale={fontScale} /> : null}
      {row.lastInMessage && message.asyncQuestion ? <TranscriptAsyncQuestion message={message} onFocus={onPress} focused={paneFocused && current} fontScale={fontScale} /> : null}
      {row.lastInMessage && message.role === 'user' ? <View style={{ marginLeft: gutterWidth + glyphWidth + 2 }}><TranscriptQueuedPrompt message={message} /></View> : null}
      <TranscriptDateDivider label={followingDateLabel} fontScale={fontScale} />
    </View>
  );
}

function transcriptSourceRowPropsEqual(previous: TranscriptSourceRowProps, next: TranscriptSourceRowProps) {
  if (previous.followingDateLabel !== next.followingDateLabel || previous.row !== next.row || previous.fontScale !== next.fontScale || previous.gutterWidth !== next.gutterWidth || previous.sourceNavigationIndex !== next.sourceNavigationIndex || previous.cursorNavigationIndex !== next.cursorNavigationIndex) return false;
  // Callback closures are recreated by FlashList's renderItem, but they name
  // the same stable row and dispatch through TranscriptPane's latest-action
  // refs. Refresh them whenever the row itself changes; navigation-only frames
  // can safely reuse the prior closures and skip the Markdown/glyph rebuild.
  return !transcriptSourceRowNavigationChanged(previous.row, previous.navigation, next.navigation, previous.focused, next.focused);
}

function approvalExpiry(expiresAtMs: number) { const seconds = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)); return seconds ? `expires ${seconds}s` : 'expired'; }

const styles = StyleSheet.create({
  root: { flexDirection: 'row', minHeight: 20 }, accessibilityRow: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, current: { backgroundColor: 'rgba(60,56,54,0.22)' }, grouped: { backgroundColor: 'rgba(60,56,54,0.14)' }, authoredPrompt: { backgroundColor: colors.authoredPromptSurface }, authoredPromptActive: { backgroundColor: colors.authoredPromptSurfaceActive }, gutterRail: { position: 'absolute', left: 0, top: 0, bottom: 0 }, gutterRailActive: { width: 2, backgroundColor: colors.activeAccent }, gutterRailAuthored: { width: 2, backgroundColor: colors.authoredPromptRail }, gutterRailGrouped: { width: 1, backgroundColor: colors.borderStrong }, gutterSpacer: { width: 2 }, authoredPromptEdge: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.authoredPromptBorder }, authoredPromptTopEdge: { top: 0 }, authoredPromptBottomEdge: { bottom: 0 },
  body: { flex: 1, minWidth: 0 }, columns: { minHeight: 20, flexDirection: 'row', alignItems: 'flex-start' }, machineColumns: { minHeight: 18 }, line: { flexShrink: 0, paddingRight: 6, color: 'rgba(168,153,132,0.42)', fontFamily: type.mono, fontVariant: ['tabular-nums'], fontSize: 11, lineHeight: 20, textAlign: 'right' }, currentLine: { color: 'rgba(176,189,42,0.70)' }, marker: { flexShrink: 0, fontFamily: type.mono, fontSize: 11, lineHeight: 20, fontWeight: '600', textAlign: 'center' }, lifecycle: { width: 20, color: colors.activeAccent, fontFamily: type.mono, fontSize: 9, lineHeight: 20, textAlign: 'center' }, lifecycleError: { color: colors.red },
  // Focus may change timestamp content and colour, but not the row's width.
  timestamp: { flexShrink: 0, paddingHorizontal: 7, color: colors.faint, fontFamily: type.mono, fontSize: 9, lineHeight: 20, textAlign: 'right' }, timestampFocused: { color: colors.inkMuted },
  approvalActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 4 }, approvalExpiry: { color: colors.faint, fontFamily: type.mono, fontSize: 9 }, approvalButton: { overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: colors.yellow, borderRadius: 5, color: colors.yellow, backgroundColor: colors.raised, fontFamily: type.mono, fontSize: 10, fontWeight: '700' }, denyButton: { color: colors.red, borderColor: colors.red },
  attachmentLabel: { flex: 1, paddingRight: 8, color: colors.inkMuted, fontFamily: type.mono, fontStyle: 'italic' },
  mediaStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6, marginBottom: 4 }, mediaCard: { width: 150, minHeight: 44, padding: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 5, backgroundColor: colors.raised }, mediaAccessibility: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, mediaImage: { width: 138, height: 86, marginBottom: 4, borderRadius: 3, backgroundColor: colors.canvas }, mediaIcon: { height: 25, color: colors.blue, fontFamily: type.mono, fontSize: 18 }, mediaName: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 9 }, mediaSize: { color: colors.faint, fontFamily: type.mono, fontSize: 8, textAlign: 'right' },
  foldToggle: { width: 24, color: colors.orange, fontFamily: type.mono, fontSize: 12, lineHeight: 20, textAlign: 'center' },
  recovery: { alignSelf: 'flex-start', marginTop: 5, marginBottom: 4, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: colors.orange, borderRadius: 4, backgroundColor: colors.raised }, recoveryText: { color: colors.orange, fontFamily: type.mono, fontSize: 9 },
});
