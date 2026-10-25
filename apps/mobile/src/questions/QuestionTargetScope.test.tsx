// @vitest-environment jsdom
import React, { act, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { useGatewaySubmission } from '../gateway/useGatewaySubmission';
const geometry = vi.hoisted(() => ({ delayed: false, pending: [] as (() => void)[] }));
vi.mock('react-native', () => {
  const Host = forwardRef<unknown, { children?: React.ReactNode; accessibilityLabel?: string; onPress?: () => void }>((props, ref) => {
    useImperativeHandle(ref, () => ({ measureLayout: (_owner: unknown, done: (x: number, y: number, width: number, height: number) => void) => {
      const notes = React.Children.toArray(props.children).some(child => React.isValidElement<{ accessibilityLabel?: string }>(child) && child.props.accessibilityLabel === 'Edit Notes? other answer');
      const group = props.accessibilityLabel?.match(/^1\. Choice (\d+)/)?.[1];
      const y = group !== undefined ? 100 + Number(group) * 500 : props.accessibilityLabel === '2. Two' ? 900 : notes ? 1_300 : 100;
      const finish = () => done(0, y, 400, 40);
      if (geometry.delayed) geometry.pending.push(finish); else finish();
    }, focus() {}, blur() {} }));
    return <div aria-label={props.accessibilityLabel} onClick={props.onPress}>{props.children}</div>;
  });
  return { View: Host, Pressable: Host, TextInput: Host, Text: Host, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 } };
});
vi.mock('expo-crypto', () => ({ randomUUID: () => 'answer' }));
vi.mock('../storage/workspaceStore', () => ({ loadValue: vi.fn(async () => null), saveValue: vi.fn(async () => {}) }));
import { useAsyncGatewayQuestions } from '../gateway/useAsyncGatewayQuestions';
import { HistoryPublicationAuthority } from '../gateway/historyPublicationAuthority';
import { QuestionTargetScope } from './QuestionTargetScope';
import { TranscriptAsyncQuestion } from './TranscriptAsyncQuestion';
import { AsyncQuestionProvider } from './AsyncQuestionContext';

const message: WorkspaceMessage = { id: 'q', role: 'assistant', text: 'Decision after review', sessionKey: 'test', source: 'history',
  asyncQuestion: { itemId: 'q', questions: [{ title: 'Which?', options: ['One', 'Two'] }, { title: 'Notes?' }] } };
const event = (key: string) => ({ key, shift: false, control: false, command: false, option: false });
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); geometry.delayed = false; geometry.pending = []; vi.unstubAllGlobals(); });
async function setup(input = message) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div')); roots.push(root);
  let value!: ReturnType<typeof useAsyncGatewayQuestions>; let focused = true; let visible = true;
  const sender = vi.fn(); const reveal = vi.fn(); const cancel = vi.fn(); const saved = { y: -80, height: 400 }; const capture = vi.fn(() => saved);
  const authority = { current: new HistoryPublicationAuthority(true) };
  const submit = { current: sender as unknown as ReturnType<typeof useGatewaySubmission> }; const messages = [input];
  function Scene() {
    value = useAsyncGatewayQuestions({ messages, endpoint: '', status: 'connected', authority, submit });
    return <AsyncQuestionProvider value={value}><QuestionTargetScope capture={() => capture()} reveal={region => reveal(region)} cancel={() => cancel()}>
      {visible ? <TranscriptAsyncQuestion message={input} focused={focused} fontScale={1.8} onFocus={() => {}} /> : null}
    </QuestionTargetScope></AsyncQuestionProvider>;
  }
  const render = () => act(async () => root.render(<Scene />)); await render();
  return { value: () => value, root, sender, reveal, cancel, capture, saved, render, blur: () => { focused = false; }, dismiss: () => { visible = false; },
    press: (key: string) => act(async () => { value.handleKey(input, event(key)); }) };
}

it('mounted async owner reveals active targets and restores reading position only on Escape', async () => {
  const test = await setup(); expect(test.reveal).not.toHaveBeenCalled();
  await test.press('j'); expect(test.reveal).not.toHaveBeenCalled();
  await test.press('enter'); expect(test.reveal).toHaveBeenLastCalledWith({ y: 100, height: 40 });
  await test.press('j'); expect(test.reveal).toHaveBeenLastCalledWith({ y: 900, height: 40 });
  await test.press('k'); expect(test.reveal).toHaveBeenLastCalledWith({ y: 100, height: 40 });
  await test.press('tab'); expect(test.reveal).toHaveBeenLastCalledWith({ y: 1_300, height: 40 });
  expect(test.value().ui.draft(test.value().view(message)!.record).selected['0']).toEqual(['One']);
  await test.press('escape'); expect(test.reveal).toHaveBeenLastCalledWith(test.saved);
  expect(test.sender).not.toHaveBeenCalled();
  await test.press('enter'); test.reveal.mockClear(); await test.press('g');
  expect(test.reveal).not.toHaveBeenCalled();
  await test.press('enter'); test.reveal.mockClear(); test.blur(); await test.render();
  expect(test.reveal).not.toHaveBeenCalled();
});

it('cancels a question-child reveal when the enclosing transcript cell stays mounted', async () => {
  const test = await setup(); await test.press('enter'); test.cancel.mockClear(); test.reveal.mockClear();
  geometry.delayed = true; await test.press('j'); test.dismiss(); await test.render();
  expect(test.cancel).toHaveBeenCalled();
  await act(async () => geometry.pending.splice(0).forEach(done => done()));
  expect(test.reveal).not.toHaveBeenCalled();
});

it('retires measurements after another target, exit, pane blur or unmount', async () => {
  const test = await setup(); geometry.delayed = true;
  await test.press('enter'); await test.press('j');
  await act(async () => geometry.pending.splice(0).forEach(done => done()));
  expect(test.reveal).toHaveBeenCalledExactlyOnceWith({ y: 900, height: 40 });
  await test.press('k'); await test.press('escape'); test.reveal.mockClear();
  await act(async () => geometry.pending.splice(0).forEach(done => done())); expect(test.reveal).not.toHaveBeenCalled();
  await test.press('enter'); test.blur(); await test.render();
  await act(async () => geometry.pending.splice(0).forEach(done => done())); expect(test.reveal).not.toHaveBeenCalled();
  await act(async () => test.root.unmount()); roots.splice(roots.indexOf(test.root), 1);
  geometry.pending.splice(0).forEach(done => done()); expect(test.reveal).not.toHaveBeenCalled();
});

it('reveals all twelve wrapped question groups without changing their answers', async () => {
  const input = { ...message, asyncQuestion: { itemId: 'tall', questions: Array.from({ length: 12 }, (_, index) => ({
    title: `${index + 1}. ${'Synthetic review context '.repeat(100)}`, options: [`Choice ${index} ${'A'.repeat(200)}`],
  })) } };
  const test = await setup(input); await test.press('enter');
  for (let index = 0; index < 12; index++) {
    expect(test.reveal).toHaveBeenLastCalledWith({ y: 100 + index * 500, height: 40 });
    await test.press('tab');
  }
  await test.press('j'); await test.press('j'); test.reveal.mockClear(); await test.press('j');
  expect(test.reveal).not.toHaveBeenCalled(); // Crossing the final action returns to transcript navigation.
  expect(test.value().ui.interaction).toBeNull();
  await test.press('enter'); await test.press('escape'); expect(test.reveal).toHaveBeenLastCalledWith(test.saved);
  expect(test.sender).not.toHaveBeenCalled();
});


it('does not remeasure, recapture, cancel or reveal active controls on unrelated pane renders', async () => {
  const test = await setup(); await test.press('enter');
  expect(test.reveal).toHaveBeenCalledTimes(1); expect(test.capture).toHaveBeenCalledTimes(1);
  test.cancel.mockClear();
  for (let index = 0; index < 5; index++) await test.render();
  expect(test.reveal).toHaveBeenCalledTimes(1); expect(test.capture).toHaveBeenCalledTimes(1);
  expect(test.cancel).not.toHaveBeenCalled();
  await test.press('j'); expect(test.reveal).toHaveBeenCalledTimes(2);
  await test.press('escape'); expect(test.reveal).toHaveBeenLastCalledWith(test.saved);
});

vi.mock('./QuestionOtherEditor', () => ({ QuestionOtherEditor: () => null }));
