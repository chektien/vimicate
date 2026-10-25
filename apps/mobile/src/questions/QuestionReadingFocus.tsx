import type { ReactNode } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { useQuestionActions } from './QuestionContext';
import { useAsyncQuestionActions } from './AsyncQuestionContext';
/** Only question rows subscribe. Ordinary transcript rows stay memoized. */
export function QuestionReadingFocus({ message, focused, children }: { message: WorkspaceMessage; focused: boolean; children: (textFocused: boolean) => ReactNode }) {
  const questions = useQuestionActions();
  const asyncQuestions = useAsyncQuestionActions();
  const view = message.asyncQuestion && asyncQuestions?.view(message);
  const engaged = message.question?.status === 'pending' && questions?.interaction === message.question.id
    || view && view.state === 'pending' && !view.collapsed && asyncQuestions?.ui.interaction === view.record.id;
  return children(focused && !engaged);
}
