import * as Application from 'expo-application';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme/tokens';
import type { AppUpdateNoticeController } from './useAppUpdateNotice';

export function AppUpdateNotice({ notice }: { notice: AppUpdateNoticeController }) {
  const presentation = notice.presentation;
  const expanded = notice.expanded;
  if (!presentation.visible) return null;

  const version = Application.nativeApplicationVersion ?? '0.1.0';
  const tone = presentation.state === 'applied'
    ? colors.success
    : presentation.state === 'failed'
      ? colors.red
      : colors.blue;
  const hasNotes = Boolean(presentation.releaseTitle || presentation.fixes.length);

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.notice, { borderLeftColor: tone }]}
      testID="app-update-notice"
    >
      <View style={styles.summary}>
        <Text numberOfLines={1} style={styles.message}>
          <Text style={[styles.signal, { color: tone }]}>● {presentation.keyword} </Text>
          <Text style={styles.version}>{version}</Text>
          {presentation.releaseTitle ? <Text style={styles.title}>  {presentation.releaseTitle}</Text> : null}
          {!presentation.releaseTitle ? <Text style={styles.detail}>  {presentation.detail}</Text> : null}
        </Text>
        {hasNotes ? (
          <Pressable
            accessibilityLabel={expanded ? 'Collapse update notes' : 'Show update notes'}
            accessibilityRole="button"
            hitSlop={11}
            onPress={notice.toggleNotes}
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}
          >
            <Text style={[styles.actionLabel, { color: tone }]}>{expanded ? 'less' : 'notes'}</Text>
          </Pressable>
        ) : null}
        {!presentation.applied ? (
          <Pressable
            accessibilityLabel={presentation.restartEnabled ? 'Restart Vimicate to apply update' : presentation.state === 'blocked' ? presentation.restartLabel === 'attachments' ? 'Restart after sending or removing staged attachments' : 'Restart after the prompt finishes sending' : 'Restart in progress'}
            accessibilityRole="button"
            accessibilityState={{ disabled: !presentation.restartEnabled }}
            disabled={!presentation.restartEnabled}
            hitSlop={11}
            onPress={() => { void notice.restart(); }}
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}
          >
            <Text style={[styles.actionLabel, !presentation.restartEnabled && styles.disabled]}>{presentation.restartLabel}</Text>
          </Pressable>
        ) : null}
        {presentation.state !== 'failed' ? (
          <Pressable
            accessibilityLabel="Dismiss update notification"
            accessibilityRole="button"
            hitSlop={11}
            onPress={notice.dismiss}
            style={({ pressed }) => [styles.dismissButton, pressed && styles.actionPressed]}
          >
            <Text style={styles.dismissLabel}>×</Text>
          </Pressable>
        ) : null}
        {presentation.updateLabel ? <Text style={styles.hash}>{presentation.updateLabel.slice(0, 8)}</Text> : null}
      </View>
      {expanded ? (
        <View style={styles.notes} testID="app-update-release-notes">
          {presentation.fixes.map((fix, index) => (
            <Text key={`${index}:${fix}`} numberOfLines={1} style={styles.fix}>· {fix}</Text>
          ))}
          <Text numberOfLines={1} style={styles.meta}>{presentation.detail}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.surface,
    borderLeftWidth: 2,
    borderTopColor: colors.borderStrong,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.xs,
  },
  summary: { alignItems: 'center', flexDirection: 'row', height: 26 },
  message: { color: colors.inkMuted, flex: 1, fontFamily: type.mono, fontSize: type.sizeXs, minWidth: 0 },
  signal: { fontWeight: '700', letterSpacing: 0.35 },
  version: { color: colors.ink },
  title: { color: colors.inkMuted },
  detail: { color: colors.faint },
  actionButton: { alignItems: 'center', borderColor: colors.borderStrong, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, height: 20, justifyContent: 'center', marginHorizontal: 2, paddingHorizontal: space.xs },
  actionLabel: { color: colors.inkMuted, fontFamily: type.mono, fontSize: type.sizeXs },
  dismissButton: { alignItems: 'center', borderColor: colors.borderStrong, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, height: 20, justifyContent: 'center', marginHorizontal: 2, width: 20 },
  dismissLabel: { color: colors.faint, fontFamily: type.mono, fontSize: 16, lineHeight: 18 },
  hash: { color: colors.faint, fontFamily: type.mono, fontSize: 9, marginLeft: 2 },
  notes: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: 3, paddingLeft: space.xs },
  fix: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 10, lineHeight: 14 },
  meta: { color: colors.faint, fontFamily: type.mono, fontSize: 9, lineHeight: 13 },
  actionPressed: { backgroundColor: colors.raised, borderColor: colors.activeAccent },
  disabled: { color: colors.faint, opacity: 0.65 },
});
