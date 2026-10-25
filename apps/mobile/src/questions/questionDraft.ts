import type { QuestionAnswers, QuestionRecord } from './questionTypes';
export type QuestionDraft = { active: number; cursor: number; selected: Record<string, string[]>; text: Record<string, string>; other?: Record<string, boolean> };
export const emptyQuestionDraft = (): QuestionDraft => ({ active: 0, cursor: 0, selected: {}, text: {} });
export function chooseQuestionOption(record: QuestionRecord, draft: QuestionDraft, index: number, questionIndex = draft.active): QuestionDraft {
  const question = record.questions[questionIndex]; const option = question?.options[index]; if (!question || !option) return draft;
  const selected = draft.selected[question.questionId] ?? [];
  const values = question.multiSelect ? selected.includes(option.label) ? selected.filter(v => v !== option.label) : [...selected, option.label] : [option.label];
  return { ...draft, active: questionIndex, cursor: index, selected: { ...draft.selected, [question.questionId]: values }, other: { ...draft.other, [question.questionId]: false }, text: { ...draft.text, [question.questionId]: '' } };
}
export const questionOtherSelected = (draft: QuestionDraft, id: string) => draft.other?.[id] ?? Boolean(draft.text[id]?.trim());
export function chooseQuestionOther(record: QuestionRecord, draft: QuestionDraft, questionIndex = draft.active): QuestionDraft {
  const question = record.questions[questionIndex]; if (!question?.isOther) return draft;
  return { ...draft, active: questionIndex, cursor: question.options.length, selected: { ...draft.selected, [question.questionId]: [] }, other: { ...draft.other, [question.questionId]: true } };
}
export const focusQuestionSubmit = (record: QuestionRecord, draft: QuestionDraft): QuestionDraft => ({ ...draft, active: record.questions.length, cursor: 0 });
export function questionDraftAnswers(record: QuestionRecord, draft: QuestionDraft): QuestionAnswers | null {
  const answers: Record<string, string[]> = {};
  for (const question of record.questions) {
    const text = draft.text[question.questionId]?.trim(); const values = question.isOther && questionOtherSelected(draft, question.questionId) ? (text ? [text] : []) : draft.selected[question.questionId] ?? [];
    if (!values.length || !question.multiSelect && values.length > 1) return null;
    answers[question.questionId] = values;
  }
  return { answers };
}
/** Controls form one ordered path, with explicit actions after the answer rows. */
export type QuestionKeyAction = 'submit' | 'other' | 'dismiss' | 'skip' | 'before' | 'after';
export type QuestionKeyResult = boolean | 'before' | 'after';
export type QuestionEntry = 'forward' | 'backward';
export function questionEntryDraft(record: QuestionRecord, draft: QuestionDraft, entry: QuestionEntry, nonBlocking = false): QuestionDraft {
  return { ...draft, active: entry === 'backward' ? record.questions.length : 0, cursor: entry === 'backward' ? (nonBlocking ? 2 : 1) : 0 };
}
export function questionKey(record: QuestionRecord, draft: QuestionDraft, key: string, shift = false, nonBlocking = false): { draft: QuestionDraft; action?: QuestionKeyAction } | null {
  const footer = draft.active === record.questions.length;
  const question = record.questions[draft.active];
  if (!question && !footer) return null;
  const lastRow = (active: number) => active === record.questions.length ? (nonBlocking ? 2 : 1)
    : Math.max(0, record.questions[active]!.options.length - (record.questions[active]!.isOther ? 0 : 1));
  if (key === 'j' || key === 'k') {
    const direction = key === 'j' ? 1 : -1;
    let active = draft.active, cursor = draft.cursor + direction;
    if (cursor < 0) { active--; cursor = active >= 0 ? lastRow(active) : 0; }
    else if (cursor > lastRow(active)) { active++; cursor = 0; }
    if (active < 0 || active > record.questions.length) return { draft, action: active < 0 ? 'before' : 'after' };
    return { draft: { ...draft, active, cursor } };
  }
  if (key === 'tab') {
    const count = record.questions.length + 1;
    return { draft: { ...draft, active: (draft.active + (shift ? count - 1 : 1)) % count, cursor: 0 } };
  }
  if (key === 'enter' || key === ' ' || key === 'space') {
    if (footer) return { draft, action: draft.cursor === 0 ? 'submit' : draft.cursor === 1 ? 'dismiss' : 'skip' };
    if (question!.isOther && draft.cursor === question!.options.length) return { draft: chooseQuestionOther(record, draft), action: 'other' };
    const alreadySelected = !questionOtherSelected(draft, question!.questionId) && draft.selected[question!.questionId]?.includes(question!.options[draft.cursor]?.label ?? '');
    const chosen = key === 'enter' && alreadySelected ? draft : chooseQuestionOption(record, draft, draft.cursor);
    return { draft: key === 'enter' ? focusQuestionSubmit(record, chosen) : chosen };
  }
  if (/^[1-9]$/.test(key) && question) return { draft: chooseQuestionOption(record, draft, Number(key) - 1) };
  return null;
}
