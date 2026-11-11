// Explicit QA-only mounted probe. Payloads allocate only when the QA branch renders.
import { TranscriptReturnLifetimeProbe } from './TranscriptReturnLifetimeProbe';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, focusTranscriptMessage } from '../../src/transcript/transcriptVim';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
import { QuestionProvider, type QuestionActions } from '../../src/questions/QuestionContext';
import { chooseQuestionOption, chooseQuestionOther, emptyQuestionDraft, focusQuestionSubmit, type QuestionDraft } from '../../src/questions/questionDraft';
import type { QuestionRecord } from '../../src/questions/questionTypes';

const makeRows = (session: string): WorkspaceMessage[] => Array.from({ length: 200 }, (_, index) => ({
  id: `${session}-${index}`, role: 'assistant', state: 'complete',
  text: `Review ${session} item ${String(index).padStart(3, '0')}`,
}));
const noop = () => undefined;
const tailReveal = { consumeIfAdvanced: () => false };

function Probe() {
  const originals = useMemo(() => ({ A: makeRows('A'), B: makeRows('B') }), []);
  const older = useMemo<WorkspaceMessage[]>(() => Array.from({ length: 10 }, (_, index) => ({
    id: `older-${index}`, role: 'assistant', state: 'complete', text: `Older history item ${index}`,
  })), []);
  const [session, setSession] = useState<'A' | 'B'>('A');
  const [prepended, setPrepended] = useState(false);
  const [appended, setAppended] = useState(false);
  const leaveAfterRefresh = useRef(false);
  const messages = useMemo(() => session === 'B' ? originals.B : [
    ...(prepended ? older : []), ...originals.A,
    ...(appended ? [{ id: 'A-200', role: 'assistant' as const, state: 'complete' as const, text: 'Review A item 200' }] : []),
  ], [session, prepended, appended, originals, older]);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const owner = useSessionTranscriptNavigation({ sessionKey: session, buffer, navigationRef, setNavigation, viewportRef, tailReveal });
  useLayoutEffect(() => {
    if (!leaveAfterRefresh.current) return;
    leaveAfterRefresh.current = false;
    // Capture after the new topology commits, before deferred viewability can
    // publish its range. This is the refresh → immediate switch boundary.
    setSession('B');
  }, [buffer]);
  const changeSession = (next: 'A' | 'B') => { setSession(next); };
  const prepend = () => { setPrepended(true); };
  const tail = () => { setNavigation(createTranscriptVimState(buffer)); viewportRef.current?.reveal(buffer.lines.length - 1, true, 'tail'); };
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#202323' }}>
    <Text style={{ color: 'white' }}>Touch review native probe</Text>
    <Text style={{ color: 'white' }}>{`Probe session ${session} cursor ${navigation.cursor.row} rows ${buffer.lines.length}`}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {[['Session A', () => changeSession('A')], ['Session B', () => changeSession('B')], ['Prepend history', prepend], ['Latest row', tail],
        ['Refresh and leave', () => { leaveAfterRefresh.current = true; setAppended(true); }]].map(([label, action]) =>
        <Pressable key={label as string} accessibilityRole="button" accessibilityLabel={label as string} onPress={action as () => void} style={{ padding: 16 }}>
          <Text style={{ color: 'white' }}>{label as string}</Text>
        </Pressable>)}
    </View>
    <TranscriptPane ref={viewportRef} sessionEntry={owner.entryFor(session, buffer)} onSessionRetire={owner.onViewportRetire} datasetKey={session} messages={messages} buffer={buffer} navigation={navigation}
      focused fontScale={1} onFocus={noop} onSelect={(messageIndex, line) => setNavigation(current => focusTranscriptMessage(buffer, current, messageIndex, line))}
      onNavigationProjection={(expected, projected) => setNavigation(current => current === expected ? projected : current)}
      onViewportReview={owner.onViewportReview} onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop}
      canLoadOlder={false} loadingOlder={false} onLoadOlder={prepend} onRetryHistory={noop} />
  </SafeAreaView>;
}
/** The opt-in pixel fixture keeps every action local, including Submit. */
function PixelProbe() {
  const record = useMemo<QuestionRecord>(() => ({
    id: 'pixel-review-question', sessionKey: 'A', status: 'pending', createdAtMs: Date.now(), expiresAtMs: Date.now() + 3_600_000,
    questions: [{ questionId: 'pixel-answer', header: 'Pixel review', question: 'Which synthetic review position should this offline fixture remember?', isOther: true,
      options: Array.from({ length: 20 }, (_, index) => ({ label: `Position ${String(index + 1).padStart(2, '0')}`,
        description: 'Synthetic option for tall-card geometry. This text contains no real task, account or private information.' })) }],
  }), []);
  const originals = useMemo(() => {
    const a = makeRows('A');
    a[80] = { ...a[80]!, text: 'Pixel fixture tall question source', sessionKey: 'A', question: record };
    return { A: a, B: makeRows('B') };
  }, [record]);
  const [session, setSession] = useState<'A' | 'B'>('A');
  const [focused, setFocused] = useState(true);
  const [draft, setDraft] = useState<QuestionDraft>(emptyQuestionDraft);
  const [interaction, setInteraction] = useState<string | null>(null);
  const [textEditing, setTextEditing] = useState<string | null>(null);
  const [otherFocus, setOtherFocus] = useState<NonNullable<QuestionActions['otherFocus']> | null>(null);
  const [capture, setCapture] = useState('No snapshot');
  const [notice, setNotice] = useState('Offline pixel-return fixture');
  const focusRevision = useRef(0);
  const messages = originals[session];
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const owner = useSessionTranscriptNavigation({ sessionKey: session, buffer, navigationRef, setNavigation, viewportRef, tailReveal });
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
    snapshot(); setFocused(false); setSession(next);
  };
  const park = (row: number, rowOffset: number) => {
    // These are the production pane's source-point restoration API, not a
    // second scroller or estimated per-line native offset.
    setInteraction(null); setFocused(true);
    setNavigation(current => focusTranscriptMessage(buffer, current, row, 0));
    viewportRef.current?.revealAfterRevision(row, 0, rowOffset);
  };
  const openOther = () => {
    if (session !== 'A') return;
    setFocused(true); other(record, 0);
    setOtherFocus({ id: record.id, question: 0, revision: ++focusRevision.current });
    setNavigation(current => focusTranscriptMessage(buffer, current, 80, 0));
    viewportRef.current?.revealAfterRevision(80, 0, 650);
  };
  const controls: Array<[string, () => void, boolean?]> = [
    ['Session A', () => changeSession('A')], ['Session B', () => changeSession('B')],
    ['Park tall upper', () => park(80, 240.5), session !== 'A'],
    ['Park tall lower', () => park(80, 650.25), session !== 'A'],
    ['Park clipped ordinary row', () => park(120, 10.5)],
    ['Open Other editor', openOther, session !== 'A'],
    ['Blur transcript', () => setFocused(false)], ['Focus transcript', () => setFocused(true)],
    ['Snapshot viewport', snapshot],
  ];
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#202323' }}>
    <Text accessibilityLabel="Pixel review fixture identity" accessibilityValue={{ text: `qa-review-pixel-v1 session ${session}` }} style={{ color: 'white' }}>Pixel review fixture · session {session}</Text>
    <Text accessibilityLabel="Pixel review snapshot" accessibilityValue={{ text: capture }} style={{ color: 'white' }}>{capture}</Text>
    <Text style={{ color: 'white' }}>{notice}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{controls.map(([label, action, disabled]) =>
      <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} accessibilityState={{ disabled: Boolean(disabled) }} onPress={action} style={{ padding: 10, opacity: disabled ? 0.4 : 1 }}>
        <Text style={{ color: 'white' }}>{label}</Text>
      </Pressable>)}</View>
    <QuestionProvider value={actions}><TranscriptPane ref={viewportRef} sessionEntry={owner.entryFor(session, buffer)} onSessionRetire={owner.onViewportRetire} datasetKey={session} messages={messages} buffer={buffer} navigation={navigation}
      focused={focused} fontScale={1} onFocus={() => setFocused(true)}
      onSelect={(messageIndex, line) => setNavigation(current => focusTranscriptMessage(buffer, current, messageIndex, line))}
      onNavigationProjection={(expected, projected) => setNavigation(current => current === expected ? projected : current)}
      onViewportReview={owner.onViewportReview} onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop}
      canLoadOlder={false} loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop} />
    </QuestionProvider>
  </SafeAreaView>;
}
export default function TranscriptSessionReviewProbe() {
  const [lifetime, setLifetime] = useState(false);
  const [asyncQuestion, setAsyncQuestion] = useState(false);
  return <SafeAreaProvider><View style={{ flex: 1, backgroundColor: '#202323' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={lifetime ? 'Pixel replay' : 'Lifetime replay'} onPress={() => setLifetime(value => !value)} style={{ padding: 10 }}>
      <Text style={{ color: 'white' }}>{lifetime ? 'Pixel replay' : 'Lifetime replay'}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Async lifetime replay" onPress={() => { setLifetime(true); setAsyncQuestion(true); }} style={{ padding: 10 }}>
      <Text style={{ color: 'white' }}>Async lifetime replay</Text>
    </Pressable>
    {lifetime ? <TranscriptReturnLifetimeProbe key={asyncQuestion ? 'async' : 'blocking'} asyncQuestion={asyncQuestion} /> : process.env.EXPO_PUBLIC_VIMICATE_UI_FIXTURE === 'qa-review-pixel-v1' ? <PixelProbe /> : <Probe />}
  </View></SafeAreaProvider>;
}

export function isSimulatorReviewFixtureMode(mode: string | undefined) { return mode === 'qa-review-v1' || mode === 'qa-review-pixel-v1'; }
