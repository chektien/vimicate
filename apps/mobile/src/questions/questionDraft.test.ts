import { expect, it } from 'vitest';
import { emptyQuestionDraft, questionDraftAnswers, questionKey } from './questionDraft';
import { questionRecordFromPayload } from '../gateway/gatewayQuestions';
const record = questionRecordFromPayload({ id: 'qa', sessionKey: 'test', createdAtMs: 1, expiresAtMs: 9, status: 'pending', questions: [{ questionId: 'first', header: 'Pick', question: 'Choose', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }, { questionId: 'second', header: 'Text', question: 'Type', options: [], isOther: true }] })!;
it('moves multi-select cursor without selecting, toggles Space and requires all questions', () => {
  let draft = questionKey(record, emptyQuestionDraft(), 'j')!.draft;
  expect(draft.selected).toEqual({}); draft = questionKey(record, draft, ' ')!.draft;
  expect(draft.selected).toEqual({ first: ['B'] }); expect(questionDraftAnswers(record, draft)).toBeNull();
  draft = questionKey(record, draft, 'tab')!.draft; expect(draft.active).toBe(1);
  draft = { ...draft, text: { second: 'Free text' } };
  expect(questionDraftAnswers(record, draft)).toEqual({ answers: { first: ['B'], second: ['Free text'] } });
  expect(questionKey(record, draft, 'escape')).toBeNull();
});
it('lets j/k reach the Other row, where Enter opens the text field instead of submitting', () => {
  const single = questionRecordFromPayload({ id: 'other', sessionKey: 'test', createdAtMs: 1, expiresAtMs: 9, status: 'pending', questions: [{ questionId: 'pick', header: 'Pick', question: 'Choose', isOther: true, options: [{ label: 'A' }, { label: 'B' }] }] })!;
  let draft = questionKey(single, emptyQuestionDraft(), 'j')!.draft;
  expect(draft).toMatchObject({ cursor: 1, selected: {} });
  draft = questionKey(single, draft, 'j')!.draft;
  expect(draft.cursor).toBe(2);
  expect(draft.selected).toEqual({});
  expect(questionKey(single, draft, 'j')!.draft).toMatchObject({ active: 1, cursor: 0 });
  expect(questionKey(single, draft, 'enter')?.action).toBe('other');
  draft = questionKey(single, draft, 'k')!.draft;
  expect(draft).toMatchObject({ cursor: 1, selected: {} });
  expect(questionKey(single, draft, 'enter')?.draft.selected.pick).toEqual(['B']);
  const closed = questionRecordFromPayload({ id: 'closed', sessionKey: 'test', createdAtMs: 1, expiresAtMs: 9, status: 'pending', questions: [{ questionId: 'pick', header: 'Pick', question: 'Choose', options: [{ label: 'A' }, { label: 'B' }] }] })!;
  expect(questionKey(closed, { ...emptyQuestionDraft(), cursor: 1 }, 'j')!.draft).toMatchObject({ active: 1, cursor: 0 });
});
