// @vitest-environment jsdom
// Mounted question/key-routing boundary only. Native measurement and recycler
// painting are not modeled, so this cannot close a physical blank-frame report.
import React, { act, startTransition, Suspense, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { useGatewaySubmission } from '../gateway/useGatewaySubmission';
import { HistoryPublicationAuthority } from '../gateway/historyPublicationAuthority';
import { useAsyncGatewayQuestions } from '../gateway/useAsyncGatewayQuestions';
import { createTranscriptBuffer, createTranscriptVimState, handleTranscriptKey } from '../transcript/transcriptVim';
import { buildVisibleTranscriptRenderRows, transcriptNavigationSourceRows } from '../transcript/transcriptVisibleRows';
import { useSynchronousState } from '../app/useSynchronousState';
import { routeTranscriptQuestionKey } from './transcriptQuestionNavigation';
import { AsyncQuestionProvider } from './AsyncQuestionContext';
import { TranscriptAsyncQuestion } from './TranscriptAsyncQuestion';

vi.mock('react-native', () => {
  const Host = ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => <div aria-label={accessibilityLabel}>{children}</div>;
  return { View: Host, Pressable: Host, Text: Host, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
});
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unused' }));
vi.mock('../storage/workspaceStore', () => ({ loadValue: vi.fn(async () => null), saveValue: vi.fn(async () => {}) }));
vi.mock('./QuestionOtherEditor', () => ({ QuestionOtherEditor: () => null }));

const title = 'Where are you seeing the Enter-to-transcript delay?';
const options = ['iPad app', 'iPhone app', 'Mac or browser'];
const event = (key: string) => ({ key, shift: false, control: false, command: false, option: false });
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it.each([
  { suspended: false, cardOnly: false }, { suspended: true, cardOnly: false },
  { suspended: false, cardOnly: true }, { suspended: true, cardOnly: true },
])('keeps question controls committed through j/k handover $suspended / card-only $cardOnly', async ({ suspended, cardOnly }) => {
  const question: WorkspaceMessage = { id: 'question', role: 'assistant', sessionKey: 'test', source: 'history',
    text: cardOnly ? [title, ...options.map(option => `- ${option}`)].join('\n') : 'Choose after review',
    asyncQuestion: { itemId: 'question', questions: [{ title, options }] } };
  const original: WorkspaceMessage[] = [{ id: 'review', role: 'assistant', text: 'Review content', sessionKey: 'test' }, question,
    { id: 'continuation', role: 'assistant', text: 'Work continues', sessionKey: 'test' }];
  const afterRow = createTranscriptBuffer(original).lastRowByMessage[2]!;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); const root = createRoot(container); roots.push(root);
  const submit = { current: vi.fn() as unknown as ReturnType<typeof useGatewaySubmission> };
  const authority = { current: new HistoryPublicationAuthority(true) };
  let send!: (key: string) => void;
  let replace!: React.Dispatch<React.SetStateAction<WorkspaceMessage[]>>;
  let state!: { row: number; interacting: boolean; cursor: number; active: number };
  const reveal = vi.fn();
  const commits: string[] = [];
  const never = new Promise<never>(() => {});
  function Pause({ pause }: { pause: boolean }) { if (pause) throw never; return null; }
  function Owner() {
    const [messages, setMessages] = useState(original); replace = setMessages;
    const buffer = createTranscriptBuffer(messages);
    const sourceRows = transcriptNavigationSourceRows(buildVisibleTranscriptRenderRows(messages, new Set()));
    const [navigation, setNavigation, navigationRef] = useSynchronousState(() => ({ ...createTranscriptVimState(buffer), cursor: { row: 0, column: 0 }, followTail: false }));
    const questions = useAsyncGatewayQuestions({ messages, endpoint: '', status: 'connected', authority, submit });
    useLayoutEffect(() => {
      send = key => {
        const input = event(key);
        if (!routeTranscriptQuestionKey({ buffer, navigation: navigationRef.current, sourceRows, messages, event: input,
          handle: questions.handleKey, select: setNavigation, reveal })) {
          setNavigation(handleTranscriptKey(buffer, navigationRef.current, input, sourceRows).state);
        }
      };
      const view = questions.view(question);
      const draft = view && questions.ui.draft(view.record);
      state = { row: navigation.cursor.row, interacting: Boolean(questions.ui.interaction), cursor: draft?.cursor ?? -1, active: draft?.active ?? -1 };
      commits.push(container.textContent ?? '');
    });
    return <><AsyncQuestionProvider value={questions}>
      <span>Review content</span><TranscriptAsyncQuestion message={question} focused={navigation.cursor.row === 1} fontScale={1} onFocus={() => {}} /><span>Work continues</span>
    </AsyncQuestionProvider><Pause pause={messages !== original} /></>;
  }
  await act(async () => root.render(<Suspense fallback={<span>Waiting</span>}><Owner /></Suspense>));
  commits.length = 0;
  if (suspended) await act(async () => startTransition(() => replace([...original, { id: 'later', role: 'assistant', text: 'Pending publication' }])));
  // First step reads the message text. Next step engages its first control.
  await act(async () => send('j')); expect(state).toMatchObject({ row: 1, interacting: false });
  await act(async () => send('j')); expect(state).toMatchObject({ row: 1, interacting: true, cursor: 0 });
  for (let index = 0; index < 20; index++) {
    await act(async () => { send('j'); send('k'); });
    expect(state).toMatchObject({ row: 1, interacting: true, cursor: 0 });
  }
  // Reverse entry into reading text must not require a second recovery key.
  await act(async () => send('k')); expect(state).toMatchObject({ row: 1, interacting: false });
  expect(reveal).toHaveBeenLastCalledWith(1);
  await act(async () => send('k')); expect(state).toMatchObject({ row: 0, interacting: false });
  await act(async () => { send('j'); send('j'); });
  for (let count = 0; count < 10 && state.row !== afterRow; count++) await act(async () => send('j'));
  expect(state).toMatchObject({ row: afterRow, interacting: false });
  await act(async () => send('k')); expect(state).toMatchObject({ row: 1, interacting: true, active: 1 });
  // Direct Enter entry must keep the cursor on the same visible card too.
  await act(async () => send('escape')); expect(state).toMatchObject({ row: 1, interacting: false });
  await act(async () => send('enter')); expect(state).toMatchObject({ row: 1, interacting: true, active: 0, cursor: 0 });
  expect(commits.length).toBeGreaterThan(20);
  for (const text of commits) {
    expect(text).toContain('Review content'); expect(text).toContain(title); for (const option of options) expect(text).toContain(option); expect(text).toContain('Work continues'); expect(text).not.toContain('Waiting');
  }
  expect(submit.current).not.toHaveBeenCalled();
});
