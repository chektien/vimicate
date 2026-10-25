import { AsyncQuestionOwner } from './asyncQuestionOwner';
import { AsyncQuestionProvider } from './AsyncQuestionContext';
import { TranscriptAsyncQuestion } from './TranscriptAsyncQuestion';
import { buildVisibleTranscriptRenderRows } from '../transcript/transcriptVisibleRows';
// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ StyleSheet: { create: (value: unknown) => value }, Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>, View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityRole, accessibilityState }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel: string; accessibilityRole: string; accessibilityState?: { checked?: boolean } }) => <button aria-label={accessibilityLabel} role={accessibilityRole} aria-checked={accessibilityState?.checked} disabled={disabled} onClick={onPress}>{children}</button>, TextInput: ({ accessibilityLabel, value, editable, onFocus, onChangeText, onSubmitEditing }: { accessibilityLabel: string; value: string; editable: boolean; onFocus: () => void; onChangeText: (value: string) => void; onSubmitEditing: () => void }) => <input aria-label={accessibilityLabel} value={value} disabled={!editable} onFocus={onFocus} onChange={event => onChangeText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') onSubmitEditing(); }} /> }));
import { TranscriptQuestion } from './TranscriptQuestion';
import { QuestionReadingFocus } from './QuestionReadingFocus';
import { QuestionProvider, type QuestionActions } from './QuestionContext';
import { emptyQuestionDraft } from './questionDraft';
import type { QuestionRecord } from './questionTypes';
const record: QuestionRecord = { id: 'qa', sessionKey: 'qa', status: 'pending', createdAtMs: 1, expiresAtMs: Date.now() + 60000, questions: [{ questionId: 'pick', header: 'Pick', question: 'Choose tools', multiSelect: true, isOther: true, options: [{ label: 'One', description: 'First tool' }, { label: 'Two' }] }] };
const container = document.createElement('div'); const root = createRoot(container);
afterEach(async () => { await act(async () => root.render(null)); vi.unstubAllGlobals(); });
it('renders accessible touch options, descriptions, other input and complete resolution controls', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  const choose = vi.fn(), resolve = vi.fn(), focus = vi.fn(); const draft = { ...emptyQuestionDraft(), selected: { pick: ['One'] } };
  const actions: QuestionActions = { drafts: {}, busy: [], errors: {}, draft: () => draft, choose, resolve, text: vi.fn() };
  await act(async () => root.render(<QuestionProvider value={actions}><TranscriptQuestion record={record} focused fontScale={1} onFocus={focus} /></QuestionProvider>));
  expect(container.textContent).toContain('First tool');
  expect(container.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="2. Two"]')!.click());
  expect(choose).toHaveBeenCalledWith(record, 0, 1); expect(focus).toHaveBeenCalledOnce();
  expect(container.querySelector('[aria-label="Edit Pick other answer"]')).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Submit question answers"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Cancel question"]')!.click());
  expect(resolve.mock.calls).toEqual([[record], [record, true]]);
  await act(async () => root.render(<QuestionProvider value={actions}><TranscriptQuestion record={{ ...record, expiresAtMs: 2 }} focused fontScale={1} onFocus={focus} /></QuestionProvider>));
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Submit question answers"]')!.disabled).toBe(true);
  await act(async () => root.render(<QuestionProvider value={actions}><TranscriptQuestion record={{ ...record, questions: [{ ...record.questions[0]!, isSecret: true }] }} focused fontScale={1} onFocus={focus} /></QuestionProvider>));
  expect(container.textContent).toContain('Answer it elsewhere'); expect(container.querySelector('input, button')).toBeNull();
});

it('reuses touch question controls without focusing on arrival, and exposes honest async queue/history actions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  const message: import('../workspace/workspaceTypes').WorkspaceMessage = { id: 'origin', role: 'assistant' as const, text: 'Which?\n\n- One\n- Two', source: 'history', sessionKey: 'session', runId: 'origin-run', asyncQuestion: { itemId: 'async', questions: [{ title: 'Which?', options: ['One', 'Two'] }] } };
  const owner = new AsyncQuestionOwner(); owner.observe([message]); const resolve = vi.fn((record: QuestionRecord) => { owner.admit(message, 'one-outbox-id'); }); const focus = vi.fn();
  const action = vi.fn((id: string, kind: 'reopen' | 'expand' | 'collapse' | 'skip' | 'discard' | 'retry') => { if (kind === 'retry') owner.retry(id); else owner[kind](id); });
  const ui = { drafts: {}, busy: [], errors: {}, draft: (record: QuestionRecord) => owner.draft(record), choose: (record: QuestionRecord, q: number, option: number) => owner.choose(record, q, option), activate: () => {}, other: () => {}, consumeOtherFocus: () => {}, text: (record: QuestionRecord, q: number, value: string) => owner.text(record, q, value), resolve, skip: (record: QuestionRecord) => action(record.id, 'skip'), editing: vi.fn(), textEditing: null, otherFocus: null, interaction: null, interact: vi.fn(), leave: vi.fn(), returnRevision: 0, targetRevision: 0 };
  const actions = { ui, action, view: (message: import('../workspace/workspaceTypes').WorkspaceMessage) => owner.view(message), handleKey: vi.fn(), clear: vi.fn(), loaded: true, storageError: undefined };
  const render = () => act(async () => root.render(<AsyncQuestionProvider value={actions}>{buildVisibleTranscriptRenderRows([message], new Set()).map(row => <div key={row.key}>{row.compiled.source}{row.lastInMessage ? <TranscriptAsyncQuestion message={message} focused fontScale={1} onFocus={focus} /> : null}</div>)}</AsyncQuestionProvider>));
  await render(); expect(container.textContent).toContain('Optional · work can continue'); expect(focus).not.toHaveBeenCalled(); expect(container.textContent).not.toContain('expires');
  expect(container.textContent?.match(/Which\?/g)).toHaveLength(1);
  expect(container.textContent?.match(/One/g)).toHaveLength(1);
  actions.loaded = false; await render();
  expect(container.textContent).toContain('Loading saved answer draft');
  expect(container.textContent?.match(/Which\?/g)).toHaveLength(1);
  expect(container.textContent).toContain('- Two');
  actions.loaded = true; await render();
  const activeRecord = owner.view(message)!.record;
  owner.update(activeRecord, { ...owner.draft(activeRecord), active: activeRecord.questions.length });
  owner.collapse(activeRecord.id); await render();
  expect(container.textContent?.match(/Which\?/g)).toHaveLength(1);
  expect(container.textContent).toContain('1 unanswered question');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Answer"]')!.click()); await render();
  expect(container.textContent?.match(/Which\?/g)).toHaveLength(1);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="2. Two"]')!.click()); expect(resolve).not.toHaveBeenCalled();
  await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Submit question answers"]')!.click()); await render();
  expect(container.textContent).toContain('Answer queued'); owner.delivery(owner.view(message)!.record.id, 'failed'); await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Retry answer"]')!.click()); expect(owner.view(message)?.delivery?.id).toBe('one-outbox-id');
  owner.delivery(owner.view(message)!.record.id, 'failed'); await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Discard answer"]')!.click()); await render();
  expect(container.textContent).toContain('Optional'); expect(owner.draft(owner.view(message)!.record).selected['0']).toEqual(['Two']);
  const untouched = { ...message, asyncQuestion: { ...message.asyncQuestion!, itemId: 'history' } }; owner.observe([untouched, { id: 'end', role: 'assistant' as const, text: 'Done', runId: 'origin-run', asyncQuestionRunOutcome: 'successful' as const }, { id: 'user', role: 'user' as const, text: 'Continue', runId: 'later' }, { id: 'end-later', role: 'assistant' as const, text: 'Done', runId: 'later', asyncQuestionRunOutcome: 'successful' as const }].map(row => ({ sessionKey: 'session', ...row })));
  await act(async () => root.render(<AsyncQuestionProvider value={actions}><TranscriptAsyncQuestion message={untouched} focused fontScale={1} onFocus={focus} /></AsyncQuestionProvider>)); expect(container.textContent).toContain('No longer pending'); expect(container.querySelector('[aria-label="Answer"]')).not.toBeNull();
  expect(container.textContent?.match(/Which\?/g)).toHaveLength(1);
  expect(container.textContent).toContain('- Two');
  await act(async () => root.render(<TranscriptAsyncQuestion message={message} focused fontScale={1} onFocus={focus} />));
  expect(container.textContent).toContain('controls unavailable');
  expect(container.textContent?.match(/Which\?/g)).toHaveLength(1);
  expect(container.textContent).toContain('- Two');
});

it('shows one cursor owner and restores text focus when question interaction ends', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const actions: QuestionActions = { drafts: {}, busy: [], errors: {}, draft: emptyQuestionDraft, choose: vi.fn(), resolve: vi.fn(), text: vi.fn() };
  const message: import('../workspace/workspaceTypes').WorkspaceMessage = { id: 'q', role: 'assistant', text: 'Choose tools', question: record };
  const render = (interaction: string | null, focused = true) => act(async () => root.render(
    <QuestionProvider value={{ ...actions, interaction }}><QuestionReadingFocus message={message} focused={focused}>{textFocused => <span data-text-cursor={String(textFocused)} />}</QuestionReadingFocus></QuestionProvider>));
  await render(null); expect(container.querySelector('[data-text-cursor="true"]')).not.toBeNull();
  await render(record.id); expect(container.querySelector('[data-text-cursor="true"]')).toBeNull();
  await render(null); expect(container.querySelector('[data-text-cursor="true"]')).not.toBeNull();
  await render(null, false); expect(container.querySelector('[data-text-cursor="true"]')).toBeNull();
});

vi.mock('./QuestionOtherEditor', () => ({ QuestionOtherEditor: () => null }));
