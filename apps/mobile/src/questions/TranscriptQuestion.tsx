import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme/tokens';
import { questionNeedsOtherSurface, type QuestionRecord } from './questionTypes';
import { useQuestionActions } from './QuestionContext';
import { useQuestionTarget } from './QuestionTargetScope';
import { questionOtherSelected } from './questionDraft';
import { QuestionOtherEditor } from './QuestionOtherEditor';
export function TranscriptQuestion({ record, focused, fontScale, onFocus, nonBlocking = false }: { nonBlocking?: boolean; record: QuestionRecord; focused: boolean; fontScale: number; onFocus: () => void }) {
  const actions = useQuestionActions(); const editing = actions?.editing; const otherFocus = actions?.otherFocus; const [otherIndex, setOtherIndex] = useState<number | null>(null); const [now, setNow] = useState(Date.now());
  const interacting = actions?.interaction === undefined || actions.interaction === record.id;
  const position = actions?.draft(record);
  const target = useQuestionTarget(focused && interacting && record.status === 'pending', JSON.stringify([record.id, position?.active, position?.cursor, fontScale, actions?.targetRevision]), actions?.returnRevision);
  const consumeOtherFocus = actions?.consumeOtherFocus;
  const interact = actions?.interact; const leave = actions?.leave;
  useEffect(() => { if (!focused && interacting) leave?.(record.id); }, [focused, interacting, leave, record.id]);
  useEffect(() => () => leave?.(record.id), [leave, record.id]);
  useEffect(() => {
    if (otherFocus?.id !== record.id) return;
    if (focused && interacting && record.status === 'pending') setOtherIndex(otherFocus.question);
    consumeOtherFocus?.(record, otherFocus.revision);
  }, [otherFocus, record.id, record.status, focused, interacting, consumeOtherFocus]);
  useEffect(() => { if (otherIndex === null) return; editing?.(record, true); return () => editing?.(record, false); }, [editing, record.id, record.status, otherIndex]);
  useEffect(() => { if (!focused || !interacting || record.status !== 'pending' || actions?.busy.includes(record.id) || !nonBlocking && now >= record.expiresAtMs) setOtherIndex(null); }, [focused, interacting, record.status, actions?.busy, record.id, nonBlocking, now, record.expiresAtMs]);
  useEffect(() => {
    if (record.status !== 'pending' || nonBlocking) return;
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [record.id, record.status, nonBlocking]);
  if (record.status !== 'pending') return null;
  if (questionNeedsOtherSurface(record)) return <Text accessibilityRole="alert" style={styles.notice}>This question needs private input. Answer it elsewhere in OpenClaw. Vimicate does not collect secrets.</Text>;
  if (!actions) return <Text style={styles.notice}>Question controls unavailable. Reconnect to OpenClaw.</Text>;
  const draft = actions.draft(record); const busy = actions.busy.includes(record.id); const expired = !nonBlocking && now >= record.expiresAtMs;
  const disabled = busy || expired;
  const size = (base: number) => ({ fontSize: base * fontScale, lineHeight: Math.round(base * 1.45 * fontScale) });
  const body = [styles.text, size(12)]; const meta = [styles.meta, size(12)];
  const blurOthers = () => { setOtherIndex(null); editing?.(record, false); };
  const openOther = (questionIndex: number) => {
    onFocus(); interact?.(record.id); actions.other?.(record, questionIndex);
    actions.activate?.(record, questionIndex, record.questions[questionIndex]!.options.length);
    editing?.(record, true); setOtherIndex(questionIndex);
  };
  const confirmOther = () => { blurOthers(); actions.activate?.(record, record.questions.length, 0); };
  const remaining = Math.max(0, Math.ceil((record.expiresAtMs - now) / 1000));
  const status = nonBlocking ? 'Optional · work can continue' : expired ? 'Expired' : `Waiting for input · expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  // Only list keys this prompt actually uses.
  const optionCount = Math.max(0, ...record.questions.map(question => question.options.length));
  const footerActive = focused && interacting && draft.active === record.questions.length;
  const hints = ['j/k move through · ↵ choose then submit', optionCount > 0 ? `1–${Math.min(optionCount, 9)} choose · space selects` : '',
    record.questions.length > 1 ? 'tab next section' : '',
    record.questions.some(question => question.isOther) ? 'o other' : ''].filter(Boolean)
    .map(hint => hint.replace(/ /g, '\u00a0')).join(' · ');
  return <View style={[styles.root, nonBlocking && styles.flush, focused && interacting && styles.rootFocused]} accessibilityLabel="Agent question prompt">
    <Text style={meta}>{status}</Text>
    {record.questions.map((question, questionIndex) => {
      const activeQuestion = focused && interacting && draft.active === questionIndex;
      return <View key={question.questionId} style={styles.question}>
        <Text style={body}>{question.header ? <Text style={styles.header}>{question.header}  </Text> : null}{question.question}</Text>
        {question.options.map((option, optionIndex) => {
          const selected = Boolean(draft.selected[question.questionId]?.includes(option.label) && !questionOtherSelected(draft, question.questionId));
          const cursor = activeQuestion && draft.cursor === optionIndex;
          const mark = question.multiSelect ? (selected ? '[x]' : '[ ]') : (selected ? '(•)' : '( )');
          return <Pressable {...(cursor ? target : {})} key={option.label} accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected, disabled }} accessibilityLabel={`${optionIndex + 1}. ${option.label}${option.description ? `. ${option.description}` : ''}`} disabled={disabled} hitSlop={{ top: 7, bottom: 7 }} onPress={() => { blurOthers(); onFocus(); actions.choose(record, questionIndex, optionIndex); }} style={[styles.option, cursor && styles.cursor]}>
            <Text style={[body, selected ? styles.marked : styles.mark]}>{mark}</Text>
            <Text style={[body, styles.number]}>{optionIndex + 1}</Text>
            <Text style={[body, styles.label]}>
              <Text style={selected ? styles.selectedLabel : undefined}>{option.label}</Text>
              {option.description ? <Text style={styles.description}>{'  '}{option.description}</Text> : null}
            </Text>
          </Pressable>;
        })}
        {question.isOther ? <View {...(activeQuestion && draft.cursor === question.options.length ? target : {})} style={[styles.option, activeQuestion && draft.cursor === question.options.length && styles.cursor]}>
          <Pressable accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'} accessibilityLabel={`${question.header || question.question} Other answer`} accessibilityState={{ checked: questionOtherSelected(draft, question.questionId), disabled }} disabled={disabled} onPress={() => openOther(questionIndex)}>
            <Text style={[body, questionOtherSelected(draft, question.questionId) ? styles.marked : styles.mark]}>{question.multiSelect ? (questionOtherSelected(draft, question.questionId) ? '[x]' : '[ ]') : (questionOtherSelected(draft, question.questionId) ? '(•)' : '( )')}</Text>
          </Pressable>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={[body, styles.number]}>o</Text>
          {otherIndex === questionIndex && focused && interacting && !disabled ? <QuestionOtherEditor key={JSON.stringify([record.sessionKey, record.id, question.questionId])} scope={JSON.stringify([record.sessionKey, record.id, question.questionId])} accessibilityLabel={`${question.header || question.question} other answer`} value={draft.text[question.questionId] ?? ''} fontScale={fontScale} maxLength={nonBlocking ? 4096 : 65536} onChange={text => actions.text(record, questionIndex, text)} onDone={confirmOther} onExit={blurOthers} /> :
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${question.header || question.question} other answer`} disabled={disabled} onPress={() => openOther(questionIndex)} style={styles.input}><Text style={body}>{draft.text[question.questionId] || 'Other answer'}</Text></Pressable>}
        </View> : null}
      </View>;
    })}
    {actions.errors[record.id] ? <Text accessibilityRole="alert" style={styles.notice}>{actions.errors[record.id]}</Text> : null}
    <View style={styles.footer}>
      {[
        { label: busy ? 'Submitting…' : 'Submit answers', accessibility: 'Submit question answers', run: () => actions.resolve(record) },
        { label: nonBlocking ? 'Collapse' : 'Cancel', accessibility: nonBlocking ? 'Collapse question' : 'Cancel question', run: () => actions.resolve(record, true) },
        ...(nonBlocking && actions.skip ? [{ label: 'Skip question', accessibility: 'Skip question', run: () => actions.skip?.(record) }] : []),
      ].map((action, index) => {
        const cursor = footerActive && draft.cursor === index;
        return <Pressable key={action.accessibility} {...(cursor ? target : {})} accessibilityRole="button" accessibilityLabel={action.accessibility} accessibilityState={{ disabled }} disabled={disabled} style={[styles.option, cursor && styles.cursor]} onPress={() => { blurOthers(); action.run(); }}>
          <Text style={[body, styles.mark]}>{cursor ? '›' : ' '}</Text>
          <Text style={[body, disabled ? styles.actionDisabled : index === 0 ? styles.submit : styles.secondary]}>{action.label}</Text>
        </Pressable>;
      })}
      <Text style={[meta, styles.hints]}>{otherIndex !== null ? 'esc normal · ↵ in normal confirms · esc again leaves' : interacting ? `${hints} · esc back to text` : 'j/k through answers · ↵ enter question'}</Text>
    </View>
  </View>;
}
// Gruvbox tokens only. The left rail marks "waiting for your input" and turns
// accent while the transcript cursor is on the prompt; rows carry no borders.
const styles = StyleSheet.create({
  root: { marginLeft: 30, marginRight: 8, marginVertical: 6, paddingLeft: 12, paddingVertical: 4, gap: 10, borderLeftWidth: 2, borderLeftColor: colors.borderStrong },
  rootFocused: { borderLeftColor: colors.activeAccent }, flush: { marginLeft: 0, marginRight: 0 },
  text: { color: colors.ink, fontFamily: type.mono }, meta: { color: colors.faint, fontFamily: type.mono },
  header: { color: colors.yellow, fontWeight: '700' }, question: { gap: 2 },
  option: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 30, paddingVertical: 4, paddingHorizontal: 6, gap: 8 },
  cursor: { backgroundColor: colors.raised },
  mark: { color: colors.faint }, marked: { color: colors.activeAccent }, number: { color: colors.inkMuted, minWidth: 10 },
  label: { flex: 1 }, selectedLabel: { color: colors.inkBright }, description: { color: colors.inkMuted },
  input: { flex: 1, paddingTop: 1, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  footer: { gap: space.xs, paddingTop: space.xs },
  submit: { color: colors.activeAccent, fontWeight: '700' }, secondary: { color: colors.inkMuted }, actionDisabled: { color: colors.faint },
  // Hints wrap below the same vertical action path on phones and tablets.
  hints: { paddingTop: space.xs },
  notice: { paddingVertical: 4, color: colors.orange, fontFamily: type.mono, fontSize: 12 },
});
