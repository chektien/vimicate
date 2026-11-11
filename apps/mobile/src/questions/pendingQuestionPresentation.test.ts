import { expect, it } from 'vitest';
import { brokerPendingQuestionCounts, combinedPendingQuestionCounts, projectsWithPendingQuestions, pendingQuestionLabel } from './pendingQuestionPresentation';
import type { QuestionRecord } from './questionTypes';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { presentWorkspaceProjects, visibleWorkspaceProjects } from '../workspace/workspacePresentation';

const project = (key: string, root?: string): WorkspaceProject => ({ id: key, sessionKey: key, name: key, path: '', branch: '', starred: false, threadCount: 1, state: 'idle', kind: root ? 'thread' : 'project', rootSessionKey: root ?? key });
const question = (sessionKey: string, id: string, status: QuestionRecord['status'] = 'pending'): QuestionRecord => ({ sessionKey, id, status, createdAtMs: 1, expiresAtMs: 9999999999999, questions: [{ questionId: 'pick', header: 'Pick', question: 'Which?', options: [{ label: 'A' }] }] });

it('counts distinct pending requests only, with no scope inferred from selection or prose', () => {
  const records = [question('a', 'one'), question('a', 'one'), question('a', 'two'), question('b', 'one'), question('a', 'done', 'answered'), question('a', 'cancel', 'cancelled'), question('b', 'expire', 'expired')];
  expect([...brokerPendingQuestionCounts(records)]).toEqual([['a', 2], ['b', 1]]);
});

it('rolls up child questions before folding without rolling up run or unread state', () => {
  const input = [project('root'), { ...project('a', 'root'), unread: true, runPhase: 'failed' as const }, project('b', 'root'), project('other')];
  const result = projectsWithPendingQuestions(input, new Map([['a', 2], ['b', 1], ['unregistered', 8]]));
  expect(result[0]?.pendingQuestions).toEqual({ own: 0, total: 3, threads: 2 });
  expect(pendingQuestionLabel(result[0]!)).toBe('Question pending in 2 threads');
  expect(pendingQuestionLabel(result[1]!)).toBe('2 questions pending');
  expect(result[0]?.unread).toBeUndefined(); expect(result[0]?.runPhase).toBeUndefined();
  expect(result[1]?.unread).toBe(true); expect(result[1]?.runPhase).toBe('failed');
  expect(result[3]).toBe(input[3]);
  const folded = visibleWorkspaceProjects(presentWorkspaceProjects(result, 'manual'), 'manual', new Set(['root']));
  expect(folded.some(row => row.kind === 'thread')).toBe(false);
  expect(folded.find(row => row.sessionKey === 'root')?.pendingQuestions?.total).toBe(3);
});

it('combines root and child counts, clears derived markers and does not double-count duplicate bindings', () => {
  const input = [project('root'), project('a', 'root'), project('a', 'root')];
  const result = projectsWithPendingQuestions(input, new Map([['root', 1], ['a', 2]]));
  expect(result[0]?.pendingQuestions).toEqual({ own: 1, total: 3, threads: 1 });
  expect(pendingQuestionLabel(result[0]!)).toBe('3 questions pending');
  expect(projectsWithPendingQuestions(result, new Map()).every(row => row.pendingQuestions === undefined)).toBe(true);
  const one = projectsWithPendingQuestions(input, new Map([['a', 1]]));
  expect(pendingQuestionLabel(one[0]!)).toBe('Question pending in 1 thread');
});

it('rolls up independent broker and async questions without replacing either source', () => {
  const broker = brokerPendingQuestionCounts([question('a', 'broker'), question('root', 'root-question')]);
  const counts = combinedPendingQuestionCounts(broker, new Map([['a', 1], ['b', 1]]));
  const result = projectsWithPendingQuestions([project('root'), project('a', 'root'), project('b', 'root')], counts);
  expect(result[0]?.pendingQuestions).toEqual({ own: 1, total: 4, threads: 2 });
  expect(result[1]?.pendingQuestions).toEqual({ own: 2, total: 2, threads: 0 });
  expect([...broker]).toEqual([['a', 1], ['root', 1]]);
});
