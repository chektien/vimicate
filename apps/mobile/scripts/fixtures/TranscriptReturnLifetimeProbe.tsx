// Offline native geometry replay. This is not a live Gateway or physical acceptance.
import { AsyncQuestionProvider } from '../../src/questions/AsyncQuestionContext';
import { useAsyncGatewayQuestions } from '../../src/gateway/useAsyncGatewayQuestions';
import { HistoryPublicationAuthority } from '../../src/gateway/historyPublicationAuthority';
import type { useGatewaySubmission } from '../../src/gateway/useGatewaySubmission';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, focusTranscriptMessage } from '../../src/transcript/transcriptVim';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
import { QuestionProvider, type QuestionActions } from '../../src/questions/QuestionContext';
import { chooseQuestionOption, chooseQuestionOther, emptyQuestionDraft, focusQuestionSubmit, type QuestionDraft } from '../../src/questions/questionDraft';
import type { QuestionRecord } from '../../src/questions/questionTypes';

const makeRows = (session: string, count: number): WorkspaceMessage[] => Array.from({ length: count }, (_, index) => ({
  id: `${session}-${index}`, role: 'assistant', state: 'complete',
  text: index % 39 === 0 ? `Review ${session} item ${index}\nMixed measured row\nThird source line` : `Review ${session} item ${index}`,
}));
const noop = () => undefined;
const tailReveal = { consumeIfAdvanced: () => false };

export function TranscriptReturnLifetimeProbe({ asyncQuestion = false }: { asyncQuestion?: boolean }) {
  const [grown, setGrown] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inset, setInset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const dimensions = useWindowDimensions();
  const returning = useRef(false);
  const insetOnReturn = useRef(false);
  const retiredGap = useRef<number | null>(null);
  const record = useMemo<QuestionRecord>(() => ({
    id: 'lifetime-question', sessionKey: 'A', status: 'pending', createdAtMs: 1, expiresAtMs: Number.MAX_SAFE_INTEGER,
    questions: [{ questionId: 'lifetime-answer', header: 'Lifetime review',
      question: 'Does the final offline question remain accessible after a delayed history publication?', isOther: true,
      options: Array.from({ length: 2 }, (_, index) => ({ label: `Review ${index + 1}`,
        description: grown ? Array.from({ length: 7 }, (_, line) => `Measured card line ${line + 1}.`).join('\n') : 'Provisional card.' })) }],
  }), [grown]);
  const originals = useMemo(() => {
    const a = makeRows('A', 4000);
    // Keep every saved source point resolvable while late native wrapping grows.
    // Removing final-message lines would accidentally test a tail fallback.
    if (asyncQuestion) a[3998] = { ...a[3998]!, text: grown ? 'Delayed measured history segment. '.repeat(150) : 'Provisional history' };
    a[3999] = asyncQuestion
      ? { ...a[3999]!, sessionKey: 'A', asyncMessage: true, text: Array.from({ length: 15 }, (_, line) => `Stable history line ${line + 1}`).join('\n'),
        asyncQuestion: { itemId: 'offline-optional-review', questions: [{ title: 'Does the non-blocking question retain its unsent draft on thread return?', options: ['Looks good', 'Needs changes'] }] } }
      : { ...a[3999]!, text: grown ? 'Final question source expanded' : 'Final question source provisional', sessionKey: 'A', question: record };
    return { A: a, B: makeRows('B', 37) };
  }, [record, asyncQuestion, grown]);
  const [session, setSession] = useState<'A' | 'B'>('A');
  const [focused, setFocused] = useState(true);
  const [draft, setDraft] = useState<QuestionDraft>(emptyQuestionDraft);
  const [interaction, setInteraction] = useState<string | null>(null);
  const [textEditing, setTextEditing] = useState<string | null>(null);
  const [otherFocus, setOtherFocus] = useState<NonNullable<QuestionActions['otherFocus']> | null>(null);
  const [capture, setCapture] = useState('No snapshot');
  const [notice, setNotice] = useState('Offline lifetime replay');
  const focusRevision = useRef(0);
  const messages = originals[session];
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const authority = useRef(new HistoryPublicationAuthority());
  const submit = useRef<ReturnType<typeof useGatewaySubmission>>(async () => false);
  // Empty endpoint and disconnected status disable persistence and delivery.
  const asyncActions = useAsyncGatewayQuestions({ messages, endpoint: '', status: 'disconnected', authority, submit });
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const owner = useSessionTranscriptNavigation({ sessionKey: session, buffer, navigationRef, setNavigation, viewportRef, tailReveal });
  useEffect(() => {
    if (session !== 'A' || !returning.current) return;
    returning.current = false;
    const insetTimer = insetOnReturn.current ? setTimeout(() => setInset(value => value ? 0 : 60), 500) : undefined;
    insetOnReturn.current = false;
    const growth = setTimeout(() => setGrown(true), 900);
    const settled = setTimeout(() => setHistoryLoading(false), 1200);
    return () => { clearTimeout(growth); clearTimeout(settled); clearTimeout(insetTimer); };
  }, [session]);
  const leave = useCallback((id: string) => setInteraction(current => current === id ? null : current), []);
  const editing = useCallback((question: QuestionRecord, active: boolean) => setTextEditing(current => active ? question.id : current === question.id ? null : current), []);
  const consumeOtherFocus = useCallback((_question: QuestionRecord, revision: number) => setOtherFocus(current => current?.revision === revision ? null : current), []);
  const choose = useCallback((question: QuestionRecord, section: number, option: number) => {
    setInteraction(question.id); setDraft(current => focusQuestionSubmit(question, chooseQuestionOption(question, current, option, section)));
  }, []);
  const other = useCallback((question: QuestionRecord, section: number) => {
    setInteraction(question.id); setDraft(current => chooseQuestionOther(question, current, section));
  }, []);
  const text = useCallback((question: QuestionRecord, section: number, value: string) => {
    const id = question.questions[section]?.questionId;
    if (id) setDraft(current => ({ ...current, text: { ...current.text, [id]: value } }));
  }, []);
  const activate = useCallback((_question: QuestionRecord, active: number, cursor = 0) => setDraft(current => ({ ...current, active, cursor })), []);
  const resolve = useCallback(() => { setNotice('Offline fixture only. Nothing submitted.'); }, []);
  const actions = useMemo<QuestionActions>(() => ({
    drafts: { [record.id]: draft }, busy: [], errors: {}, draft: () => draft,
    interaction, interact: setInteraction, leave, textEditing, editing, otherFocus, consumeOtherFocus,
    choose, other, text, activate, resolve,
  }), [record.id, draft, interaction, leave, textEditing, editing, otherFocus, consumeOtherFocus, choose, other, text, activate, resolve]);
  const snapshot = () => {
    const position = viewportRef.current?.captureReviewPosition();
    setCapture(position ? `${session} source ${position.sourceRow} local ${(position.rowOffset ?? NaN).toFixed(3)} pt` : `${session} latest or no measured review`);
  };
  const changeSession = (next: 'A' | 'B') => {
    if (next === session) return;
    snapshot(); setFocused(false);
    if (next === 'B') { setGrown(false); setHistoryLoading(false); }
    else { returning.current = true; setHistoryLoading(true); }
    setSession(next);
  };
  const park = (message: number, rowOffset?: number, position = 0) => {
    const first = buffer.firstRowByMessage[message] ?? 0;
    const row = message === 3999 ? buffer.lastRowByMessage[message] ?? first : first;
    // These are the production pane's source-point restoration API, not a
    // second scroller or estimated per-line native offset.
    setInteraction(null); setFocused(true);
    setNavigation(current => focusTranscriptMessage(buffer, current, message, row - first));
    viewportRef.current?.revealAfterRevision(row, position, rowOffset);
  };
  const openOther = () => {
    if (session !== 'A') return;
    setFocused(true);
    if (asyncQuestion) {
      const message = messages[3999]!;
      const key = { shift: false, control: false, option: false, command: false };
      asyncActions.handleKey(message, { ...key, key: 'enter' }, 'forward');
      asyncActions.handleKey(message, { ...key, key: 'o' });
    } else {
      other(record, 0);
      setOtherFocus({ id: record.id, question: 0, revision: ++focusRevision.current });
    }
    const first = buffer.firstRowByMessage[3999] ?? 0;
    const last = buffer.lastRowByMessage[3999] ?? first;
    setNavigation(current => focusTranscriptMessage(buffer, current, 3999, last - first));
    viewportRef.current?.revealAfterRevision(last, 1);
  };
  const controls: Array<[string, () => void, boolean?]> = [
    ['Session A', () => changeSession('A')], ['Session B', () => changeSession('B')],
    ['Park end review', () => park(3999, undefined, 1), session !== 'A'],
    ['Park mid review', () => park(2100, 10.5), session !== 'A'],
    ['Open Other editor', openOther, session !== 'A'],
    ['Toggle inset', () => setInset(value => value ? 0 : 60)],
    ['Return with inset', () => { insetOnReturn.current = true; changeSession('A'); }, session !== 'B'],
    ['Snapshot viewport', snapshot],
  ];
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#202323' }}>
    <Text accessibilityLabel="Lifetime review fixture identity" accessibilityValue={{ text: `qa-review-lifetime-v1 ${asyncQuestion ? 'async' : 'blocking'} session ${session}` }} style={{ color: 'white' }}>Landscape lifetime replay · session {session}</Text>
    <Text accessibilityLabel="Lifetime review snapshot" accessibilityValue={{ text: capture }} style={{ color: 'white' }}>{capture}</Text>
    <Text accessibilityLabel="Lifetime geometry" accessibilityValue={{ text: `${dimensions.width}x${dimensions.height} viewport ${viewportHeight} composer 290 inset ${inset} growth ${grown} owner ${asyncQuestion ? 'async' : 'blocking'} loading ${historyLoading} retiredGap ${retiredGap.current}` }} style={{ color: 'white' }}>{notice}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{controls.map(([label, action, disabled]) =>
      <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} accessibilityState={{ disabled: Boolean(disabled) }} onPress={action} style={{ padding: 10, opacity: disabled ? 0.4 : 1 }}>
        <Text style={{ color: 'white' }}>{label}</Text>
      </Pressable>)}</View>
    <View style={{ flex: 1, minHeight: 0 }} onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}><AsyncQuestionProvider value={asyncActions}><QuestionProvider value={actions}><TranscriptPane ref={viewportRef} sessionEntry={owner.entryFor(session, buffer)} onSessionRetire={(key, value) => { if (key === 'A') retiredGap.current = value?.kind === 'anchor' ? value.endGap : null; owner.onViewportRetire(key, value); }} historyLoading={historyLoading} datasetKey={session} messages={messages} buffer={buffer} navigation={navigation}
      focused={focused} fontScale={1} onFocus={() => setFocused(true)}
      onSelect={(messageIndex, line) => setNavigation(current => focusTranscriptMessage(buffer, current, messageIndex, line))}
      onNavigationProjection={(expected, projected) => setNavigation(current => current === expected ? projected : current)}
      onViewportReview={owner.onViewportReview} onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop}
      canLoadOlder={false} loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop} />
    </QuestionProvider></AsyncQuestionProvider></View>
    <View style={{ height: 290, borderTopWidth: 1, borderColor: '#778080', padding: 12 }}><Text style={{ color: 'white' }}>Composer height stays 290 pt. No network or submission.</Text></View>
    <View style={{ height: inset }} />
  </SafeAreaView>;
}
