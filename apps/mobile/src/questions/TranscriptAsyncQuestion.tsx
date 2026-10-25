import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { colors, type } from '../theme/tokens';
import { useAsyncQuestionActions } from './AsyncQuestionContext';
import { QuestionProvider } from './QuestionContext';
import { TranscriptQuestion } from './TranscriptQuestion';
import { privateQuestionText } from './asyncQuestionContract';
import { questionNeedsOtherSurface } from './questionTypes';
import { isAsyncQuestionFallback } from './asyncQuestionPresentation';
export function TranscriptAsyncQuestion({ message, focused, fontScale, onFocus }: { message: WorkspaceMessage; focused: boolean; fontScale: number; onFocus: () => void }) {
  const actions = useAsyncQuestionActions(); const view = actions?.view(message);
  const fallback = isAsyncQuestionFallback(message) ? <Text style={[styles.text, { fontSize: 12 * fontScale, lineHeight: 17 * fontScale }]}>{message.text}</Text> : null;
  if (!view || !actions) return <View style={styles.root}>{fallback}<Text style={styles.text}>Async question controls unavailable. Reopen this conversation.</Text></View>;
  if (questionNeedsOtherSurface(view.record)) return <Text accessibilityRole="alert" style={styles.text}>Private input · Answer elsewhere in OpenClaw. Vimicate does not collect secrets.</Text>;
  const { state, record, delivery } = view;
  const summaryQuestion = record.questions[Math.min(actions.ui.draft(record).active, record.questions.length - 1)]?.question;
  const button = (label: string, kind: Parameters<typeof actions.action>[1]) => <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.button} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} onPress={() => { onFocus(); actions.action(record.id, kind); }}><Text style={styles.action}>{label}</Text></Pressable>;
  if (state !== 'pending') return <View style={styles.root} accessibilityLabel="Async question outcome">
    {fallback}
    <Text accessibilityLiveRegion="polite" style={styles.text}>{state === 'history' ? 'No longer pending' : state === 'skipped' ? 'Skipped · work continues' : state === 'queued' ? 'Answer queued' : state === 'sending' ? 'Sending answer…' : state === 'failed' ? 'Answer not sent' : state === 'unconfirmed' ? 'Awaiting delivery confirmation' : 'Answer confirmed in saved history'}</Text>
    {view.confirmedText || delivery?.text ? <Text style={styles.text}>{privateQuestionText(view.confirmedText ?? delivery!.text)}</Text> : null}
    <View style={styles.buttons}>{state === 'history' || state === 'skipped' ? button('Answer', 'reopen') : state === 'failed' || state === 'unconfirmed' ? button('Retry answer', 'retry') : null}{delivery && state !== 'confirmed' && state !== 'sending' ? button('Discard answer', 'discard') : null}</View>
  </View>;
  return <View style={styles.root} accessibilityLabel="Optional async agent question">
    {actions.storageError ? <Text accessibilityRole="alert" style={styles.text}>{actions.storageError}</Text> : null}
    {!actions.loaded ? <View>{fallback}<Text style={styles.text}>Loading saved answer draft…</Text></View> : view.collapsed ? <View><Text style={styles.text}>{record.questions.length} unanswered {record.questions.length === 1 ? 'question' : 'questions'} · {summaryQuestion}</Text>{button('Answer', 'expand')}</View> : <QuestionProvider value={actions.ui}><TranscriptQuestion nonBlocking record={record} focused={focused} fontScale={fontScale} onFocus={onFocus} /></QuestionProvider>}
    {actions.loaded && view.collapsed ? <View style={styles.buttons}>{button('Skip question', 'skip')}</View> : null}
  </View>;
}
// Same rail and text actions as TranscriptQuestion; the inner prompt brings its own rail.
const styles = StyleSheet.create({ root: { marginLeft: 30, marginRight: 8, gap: 6, paddingVertical: 4 }, text: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 12, lineHeight: 17 }, buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 }, button: { minHeight: 28, justifyContent: 'center' }, action: { color: colors.activeAccent, fontFamily: type.mono, fontSize: 12, lineHeight: 17 } });
