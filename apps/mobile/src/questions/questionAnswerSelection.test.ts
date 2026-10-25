import { expect, it } from 'vitest';
import { chooseQuestionOption, chooseQuestionOther, emptyQuestionDraft, questionDraftAnswers, questionKey, questionOtherSelected } from './questionDraft';
import type { QuestionRecord } from './questionTypes';
const record: QuestionRecord = { id: 'q', sessionKey: 's', status: 'pending', createdAtMs: 1, expiresAtMs: 9, questions: [
  { questionId: 'one', header: '', question: 'Publish?', options: [{ label: 'Publish' }, { label: 'Keep local' }], isOther: true },
] };
it('selects empty Other immediately, clears the old answer and never submits it as a fallback', () => {
  const previous = chooseQuestionOption(record, emptyQuestionDraft(), 0);
  const other = chooseQuestionOther(record, previous, 0);
  expect(questionOtherSelected(other, 'one')).toBe(true);
  expect(other.selected.one).toEqual([]);
  expect(questionDraftAnswers(record, other)).toBeNull();
  expect(questionDraftAnswers(record, { ...other, text: { one: '  Custom  ' } })).toEqual({ answers: { one: ['Custom'] } });
  const back = chooseQuestionOption(record, other, 1);
  expect(questionOtherSelected(back, 'one')).toBe(false);
  expect(questionDraftAnswers(record, back)).toEqual({ answers: { one: ['Keep local'] } });
});
it('Enter selects then focuses Submit and only the second Enter submits', () => {
  const next = questionKey(record, emptyQuestionDraft(), 'enter')!;
  expect(next.action).toBeUndefined();
  expect(next.draft).toMatchObject({ active: 1, cursor: 0, selected: { one: ['Publish'] } });
  expect(questionKey(record, next.draft, 'enter')?.action).toBe('submit');
  expect(questionKey(record, emptyQuestionDraft(), 'space')?.draft.active).toBe(0);
});
it('entering Other selects it before the editor focus event arrives', () => {
  const previous = { ...chooseQuestionOption(record, emptyQuestionDraft(), 0), cursor: 2 };
  const next = questionKey(record, previous, 'enter')!;
  expect(next.action).toBe('other');
  expect(questionOtherSelected(next.draft, 'one')).toBe(true);
  expect(next.draft.selected.one).toEqual([]);
});

it('Enter confirms an already selected checkbox instead of toggling it off', () => {
  const multi = { ...record, questions: [{ ...record.questions[0]!, multiSelect: true }] };
  const draft = chooseQuestionOption(multi, emptyQuestionDraft(), 0);
  const confirmed = questionKey(multi, draft, 'enter')!;
  expect(confirmed.draft).toMatchObject({ active: 1, cursor: 0, selected: { one: ['Publish'] } });
  expect(questionKey(multi, draft, 'space')?.draft.selected.one).toEqual([]);
});
