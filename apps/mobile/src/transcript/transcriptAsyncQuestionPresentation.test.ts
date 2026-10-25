import { expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { createTranscriptBuffer, selectedTranscriptText, createTranscriptVimState } from './transcriptVim';
import { buildVisibleTranscriptRenderRows, transcriptNavigationSourceRows, transcriptRenderIndexForSourceRow } from './transcriptVisibleRows';

const question: WorkspaceMessage = {
  id: 'question', role: 'assistant', sessionKey: 'synthetic', source: 'history', runId: 'run',
  text: 'Which destination?\n\n- Keep the larger copy\n- Move after making space',
  asyncQuestion: { itemId: 'q', questions: [{ title: 'Which destination?', options: ['Keep the larger copy', 'Move after making space'] }] },
};
const context: WorkspaceMessage = { id: 'context', role: 'assistant', text: 'Nothing has moved. The destination has less free space than the source needs.' };
const rows = (input = question) => buildVisibleTranscriptRenderRows([context, input, { id: 'tail', role: 'assistant', text: 'Work can continue.' }], new Set());
it('gives the question one stable cell without removing source or surrounding context', () => {
  const visible = rows();
  expect(visible.filter(row => row.message.id === question.id)).toHaveLength(1);
  expect(visible.map(row => row.compiled.source)).toEqual([context.text, 'Question', 'Work can continue.']);
  expect(transcriptNavigationSourceRows(visible)).toEqual([0, 1, 5]);
  expect(transcriptRenderIndexForSourceRow(visible, 3)).toBe(1);
  const buffer = createTranscriptBuffer([context, question]);
  expect(selectedTranscriptText(buffer, { ...createTranscriptVimState(buffer), visualMode: 'line', cursor: { row: 4, column: 0 }, anchor: { row: 1, column: 0 } })).toBe(question.text);
});
it.each([
  { ...question, text: `Additional decision context.\n\n${question.text}` },
  { ...question, text: `${question.text}\n\nOne more important limitation.` },
  { ...question, text: question.text.replace('Keep the larger copy', 'Different option') },
  { id: question.id, role: 'assistant' as const, text: question.text },
  { ...question, asyncQuestion: { itemId: 'private', questions: [{ title: question.text, isSecret: true }] } },
])('never removes non-identical fallback, ordinary prose or private-input notices', input => {
  expect(rows(input).filter(row => row.message.id === question.id).map(row => row.compiled.source).join('\n')).toContain('Which destination?');
});
it('handles multi-question and free-text fallbacks in the same cell', () => {
  const input: WorkspaceMessage = { ...question, text: `${question.text}\n\nAny notes?`, asyncQuestion: { ...question.asyncQuestion!, questions: [...question.asyncQuestion!.questions, { title: 'Any notes?' }] } };
  const visible = rows(input).filter(row => row.message.id === question.id);
  expect(visible).toHaveLength(1);
  expect(visible[0]!.message.text).toContain('Any notes?');
});
