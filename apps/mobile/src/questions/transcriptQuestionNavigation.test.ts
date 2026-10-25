import { expect, it, vi } from 'vitest';
import { createTranscriptBuffer, createTranscriptVimState, handleTranscriptKey } from '../transcript/transcriptVim';
import { routeTranscriptQuestionKey } from './transcriptQuestionNavigation';
import { emptyQuestionDraft, questionEntryDraft, questionKey, type QuestionEntry, type QuestionKeyResult } from './questionDraft';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { QuestionRecord } from './questionTypes';
const record: QuestionRecord = { id: 'q', sessionKey: 's', status: 'pending', createdAtMs: 1, expiresAtMs: 99, questions: [{ questionId: 'q', header: '', question: 'Publish?', options: [{ label: 'Yes' }, { label: 'No' }], isOther: true }] };
const messages: WorkspaceMessage[] = [{ id: 'before', role: 'assistant', text: 'Review' }, { id: 'q', role: 'assistant', text: 'Publish?\nYes\nNo', question: record }, { id: 'after', role: 'assistant', text: 'Continuing' }];
function setup() {
  const buffer = createTranscriptBuffer(messages); let navigation = { ...createTranscriptVimState(buffer), cursor: { row: 1, column: 0 }, followTail: false };
  let draft = emptyQuestionDraft(), engaged = false; const reveal = vi.fn(); const submit = vi.fn();
  const handle = vi.fn((_message: WorkspaceMessage, event: HardwareKeyEvent, entry?: QuestionEntry): QuestionKeyResult => {
    if (entry || !engaged) { if (!entry && event.key !== 'enter') return false; engaged = true; draft = questionEntryDraft(record, draft, entry ?? 'forward'); return true; }
    const next = questionKey(record, draft, event.key); if (!next) { engaged = false; return false; }
    draft = next.draft;
    if (next.action === 'before' || next.action === 'after') { engaged = false; return next.action; }
    if (next.action === 'submit') submit(); return true;
  });
  const press = (key: string, control = false) => {
    const event = { key, control, command: false, option: false, shift: false };
    const consumed = routeTranscriptQuestionKey({ buffer, navigation, sourceRows: [0, 1, 2, 3, 4], messages, event, handle, reveal, select: next => { navigation = next; } });
    if (!consumed) navigation = handleTranscriptKey(buffer, navigation, event).state;
    return consumed;
  };
  return { press, reveal, handle, submit, state: () => ({ navigation, draft, engaged }), set: (patch: Partial<typeof navigation>) => { navigation = { ...navigation, ...patch }; } };
}
it('reads text, enters with j, traverses controls and leaves with j, reversing with k', () => {
  const test = setup(); test.press('j'); test.press('j');
  expect(test.state().navigation.cursor.row).toBe(3); expect(test.state().engaged).toBe(false);
  test.press('j'); expect(test.state().draft).toMatchObject({ active: 0, cursor: 0 });
  test.press('j'); test.press('enter'); expect(test.state().draft.selected.q).toEqual(['No']); expect(test.submit).not.toHaveBeenCalled();
  expect(test.state().draft).toMatchObject({ active: 1, cursor: 0 });
  test.press('j'); test.press('j'); expect(test.state().navigation.cursor.row).toBe(4); expect(test.state().engaged).toBe(false);
  test.press('k'); expect(test.state().draft).toMatchObject({ active: 1, cursor: 1 }); expect(test.state().navigation.cursor.row).toBe(3);
  for (let i = 0; i < 5; i++) test.press('k');
  expect(test.state().engaged).toBe(false); expect(test.state().navigation.cursor.row).toBe(3);
  expect(test.reveal).toHaveBeenCalledExactlyOnceWith(3);
  test.press('k'); expect(test.state().navigation.cursor.row).toBe(2);
  expect(test.submit).not.toHaveBeenCalled();
});
it('never captures counted motions, pending operators, visual selections or pane modifiers', () => {
  for (const patch of [{ count: '2' }, { pending: 'y' as const }, { visualMode: 'line' as const }]) {
    const test = setup(); test.set({ cursor: { row: 3, column: 0 }, ...patch }); test.press('j'); expect(test.handle).not.toHaveBeenCalled();
  }
  const test = setup(); test.set({ cursor: { row: 3, column: 0 } }); test.press('j', true); expect(test.handle).not.toHaveBeenCalled();
});
