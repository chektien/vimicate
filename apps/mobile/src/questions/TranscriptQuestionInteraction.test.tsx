// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { QuestionRecord } from './questionTypes';
import type { QuestionDraft } from './questionDraft';
import { chooseQuestionOption, chooseQuestionOther, emptyQuestionDraft, focusQuestionSubmit, questionDraftAnswers, questionKey } from './questionDraft';
import { QuestionProvider, type QuestionActions } from './QuestionContext';
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityRole, accessibilityState }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string; accessibilityRole?: string; accessibilityState?: { checked?: boolean } }) => <button aria-label={accessibilityLabel} role={accessibilityRole} aria-checked={accessibilityState?.checked} disabled={disabled} onClick={onPress}>{children}</button>,
}));
// The native editor has separate bridge/key tests. Here we exercise card ownership.
vi.mock('./QuestionOtherEditor', () => ({ QuestionOtherEditor: ({ value, accessibilityLabel, onChange, onDone, onExit }: { value: string; accessibilityLabel: string; onChange: (s: string) => void; onDone: () => void; onExit: () => void }) => <div><input autoFocus aria-label={accessibilityLabel} value={value} onChange={e => onChange(e.currentTarget.value)} /><button onClick={onDone}>Done</button><button onClick={onExit}>Leave editor</button></div> }));
import { TranscriptQuestion } from './TranscriptQuestion';
const record: QuestionRecord = { id: 'q', sessionKey: 's', status: 'pending', createdAtMs: 1, expiresAtMs: Date.now() + 600000, questions: [
  { questionId: 'channel', header: 'Channel', question: 'Where?', isOther: true, options: [{ label: 'TestFlight' }, { label: 'Production' }] },
  { questionId: 'notes', header: 'Notes', question: 'Which notes?', multiSelect: true, isOther: true, options: [{ label: 'Accuracy' }, { label: 'Fonts' }] },
] };
const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
let state: QuestionDraft; let otherFocus: NonNullable<QuestionActions['otherFocus']> | null; let focused: boolean;
const resolve = vi.fn(), editing = vi.fn();
function actions(): QuestionActions {
  return { drafts: {}, busy: [], errors: {}, otherFocus, editing, draft: () => state, resolve,
    consumeOtherFocus: (_, revision) => { if (otherFocus?.revision === revision) { otherFocus = null; paint(); } },
    choose: (_, question, option) => { state = focusQuestionSubmit(record, chooseQuestionOption(record, state, option, question)); paint(); },
    other: (_, question) => { state = chooseQuestionOther(record, state, question); paint(); },
    text: (_, index, text) => { state = { ...chooseQuestionOther(record, state, index), text: { ...state.text, [record.questions[index]!.questionId]: text } }; paint(); },
    activate: (_, active, cursor = 0) => { state = { ...state, active, cursor }; paint(); },
  };
}
function paint() { root.render(<QuestionProvider value={actions()}><TranscriptQuestion record={record} focused={focused} fontScale={1} onFocus={() => {}} /></QuestionProvider>); }
const render = () => act(async () => paint());
async function press(key: string) {
  const next = questionKey(record, state, key); if (!next) return; state = next.draft;
  if (next.action === 'other') otherFocus = { id: record.id, question: state.active, revision: (otherFocus?.revision ?? 0) + 1 };
  if (next.action === 'submit') resolve(record);
  await render();
}
const click = (label: string) => act(async () => { container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); });
const clickText = (text: string) => act(async () => { [...container.querySelectorAll('button')].find(b => b.textContent === text)!.click(); });
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); state = { ...emptyQuestionDraft(), selected: { channel: ['TestFlight'] } }; otherFocus = null; focused = true; resolve.mockClear(); editing.mockClear(); await render(); });
afterEach(async () => { await act(async () => root.render(null)); vi.unstubAllGlobals(); });
it('tap into blank Other immediately transfers the checkmark and clears the default', async () => {
  await click('Edit Channel other answer');
  expect(container.querySelector('[aria-label="1. TestFlight"]')?.getAttribute('aria-checked')).toBe('false');
  expect(container.querySelector('[aria-label="Channel Other answer"]')?.getAttribute('aria-checked')).toBe('true');
  expect(state.selected.channel).toEqual([]); expect(questionDraftAnswers(record, state)).toBeNull();
  expect(editing).toHaveBeenLastCalledWith(record, true); expect(resolve).not.toHaveBeenCalled();
});
it('Enter selects an option and the next Enter submits, without requiring j/k to the footer', async () => {
  await press('j'); await press('enter');
  expect(state).toMatchObject({ active: 2, cursor: 0, selected: { channel: ['Production'] } });
  expect(resolve).not.toHaveBeenCalled(); await press('enter'); expect(resolve).toHaveBeenCalledOnce();
});
it('tapping an option leaves the editor and focuses Submit without sending', async () => {
  await click('Edit Channel other answer'); await click('2. Production');
  expect(container.querySelector('input')).toBeNull(); expect(editing).toHaveBeenLastCalledWith(record, false);
  expect(state).toMatchObject({ active: 2, cursor: 0, selected: { channel: ['Production'] }, other: { channel: false } });
  expect(resolve).not.toHaveBeenCalled(); await click('Submit question answers'); expect(resolve).toHaveBeenCalledOnce();
});
it('Other completion focuses Submit, even before later unanswered questions', async () => {
  await press('j'); await press('j'); await press('enter');
  expect(container.querySelector('input')).not.toBeNull();
  await clickText('Done'); expect(state).toMatchObject({ active: 2, cursor: 0 });
  expect(container.querySelector('input')).toBeNull(); expect(resolve).not.toHaveBeenCalled();
});
it('Space toggles multiple selections in place while Enter finishes the choice', async () => {
  state = { ...state, active: 1 }; await render(); await press('space'); await press('j'); await press('space');
  expect(state).toMatchObject({ active: 1, selected: { notes: ['Accuracy', 'Fonts'] } });
  await press('enter'); expect(state.active).toBe(2); expect(resolve).not.toHaveBeenCalled();
});
it('focus loss and leaving the editor release ownership without discarding Other', async () => {
  await click('Edit Channel other answer'); await clickText('Leave editor');
  expect(state.other?.channel).toBe(true); expect(editing).toHaveBeenLastCalledWith(record, false);
  await click('Edit Channel other answer'); focused = false; await render();
  expect(container.querySelector('input')).toBeNull(); expect(editing).toHaveBeenLastCalledWith(record, false);
});

it('consumes keyboard Other focus so recycling the card cannot reopen a finished editor', async () => {
  await press('j'); await press('j'); await press('enter');
  expect(container.querySelector('input')).not.toBeNull(); expect(otherFocus).toBeNull();
  await clickText('Leave editor');
  await act(async () => root.render(null)); await render();
  expect(container.querySelector('input')).toBeNull();
  await click('Edit Channel other answer'); await click('2. Production');
  await act(async () => root.render(null)); await render();
  expect(container.querySelector('input')).toBeNull();
  expect(state.selected.channel).toEqual(['Production']);
});
