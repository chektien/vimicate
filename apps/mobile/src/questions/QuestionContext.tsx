import { createContext, useContext } from 'react';
import type { QuestionDraft } from './questionDraft';
import type { QuestionRecord } from './questionTypes';
export type QuestionActions = {
  interaction?: string | null; interact?: (id: string | null) => void; leave?: (id: string) => void; returnRevision?: number; targetRevision?: number;
  consumeOtherFocus?: (record: QuestionRecord, revision: number) => void;
  otherFocus?: { id: string; question: number; revision: number } | null; textEditing?: string | null; editing?: (record: QuestionRecord, active: boolean) => void;
  drafts: Record<string, QuestionDraft>; busy: string[]; errors: Record<string, string>;
  draft: (record: QuestionRecord) => QuestionDraft;
  choose: (record: QuestionRecord, question: number, option: number) => void;
  other?: (record: QuestionRecord, question: number) => void;
  text: (record: QuestionRecord, question: number, text: string) => void;
  /** Move the keyboard cursor to a question (and row) without changing answers. */
  activate?: (record: QuestionRecord, question: number, cursor?: number) => void;
  skip?: (record: QuestionRecord) => void;
  resolve: (record: QuestionRecord, cancel?: boolean) => unknown;
};
const Context = createContext<QuestionActions | null>(null);
export const QuestionProvider = Context.Provider;
export const useQuestionActions = () => useContext(Context);
