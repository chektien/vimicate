import { expect, it } from 'vitest';
import { emptyQuestionDraft, questionKey } from './questionDraft';
import type { QuestionRecord } from './questionTypes';
const record: QuestionRecord = { id: 'q', sessionKey: 's', status: 'pending', createdAtMs: 1, expiresAtMs: 9, questions: [
  { questionId: 'one', header: '', question: 'Publish?', options: [{ label: 'Publish' }, { label: 'Keep local' }], isOther: true },
  { questionId: 'two', header: '', question: 'Notes?', options: [{ label: 'Short' }], multiSelect: true },
] };
it('walks every question and action then leaves in both directions without altering answers', () => {
  let draft = emptyQuestionDraft();
  expect(questionKey(record, draft, 'k')?.action).toBe('before');
  const positions = [[0, 1], [0, 2], [1, 0], [2, 0], [2, 1]];
  for (const [active, cursor] of positions) {
    const next = questionKey(record, draft, 'j')!; draft = next.draft;
    expect([draft.active, draft.cursor]).toEqual([active, cursor]);
    expect(next.action).toBeUndefined(); expect(draft.selected).toEqual({});
  }
  expect(questionKey(record, draft, 'j')?.action).toBe('after');
  for (const [active, cursor] of [[2, 0], [1, 0], [0, 2], [0, 1], [0, 0]]) {
    draft = questionKey(record, draft, 'k')!.draft;
    expect([draft.active, draft.cursor]).toEqual([active, cursor]);
  }
});
it('Enter chooses the highlighted option, Other always edits, only Submit sends', () => {
  const draft = { ...emptyQuestionDraft(), cursor: 1, selected: { one: ['Publish'] } };
  const chosen = questionKey(record, draft, 'enter')!;
  expect(chosen.draft.selected.one).toEqual(['Keep local']); expect(chosen.action).toBeUndefined();
  expect(questionKey(record, { ...draft, cursor: 2, text: { one: 'Custom' } }, 'enter')?.action).toBe('other');
  expect(questionKey(record, { ...draft, active: 2, cursor: 0 }, 'enter')?.action).toBe('submit');
  expect(questionKey(record, { ...draft, active: 2, cursor: 1 }, 'enter')?.action).toBe('dismiss');
});
it('optional cards include a keyboard-reachable Skip and all advertised digit keys work', () => {
  const footer = { ...emptyQuestionDraft(), active: 2, cursor: 1 };
  expect(questionKey(record, footer, 'j', false, true)?.draft.cursor).toBe(2);
  expect(questionKey(record, { ...footer, cursor: 2 }, 'enter', false, true)?.action).toBe('skip');
  const many = { ...record, questions: [{ ...record.questions[0]!, options: Array.from({ length: 9 }, (_, i) => ({ label: String(i + 1) })) }] };
  expect(questionKey(many, emptyQuestionDraft(), '9')?.draft.selected.one).toEqual(['9']);
});
