import type { ReactNode } from 'react';
import { AsyncQuestionProvider } from '../questions/AsyncQuestionContext';
import { QuestionProvider } from '../questions/QuestionContext';
import { QueuedPromptProvider } from './QueuedPromptContext';
import type { useGatewayWorkspace } from '../gateway/useGatewayWorkspace';

export function TranscriptActionsProvider({ gateway, children }: {
  gateway: Pick<ReturnType<typeof useGatewayWorkspace>, 'questions' | 'asyncQuestions' | 'queuedPrompts'>; children: ReactNode;
}) {
  return <QueuedPromptProvider value={gateway.queuedPrompts ?? null}><AsyncQuestionProvider value={gateway.asyncQuestions}>
    <QuestionProvider value={gateway.questions}>{children}</QuestionProvider>
  </AsyncQuestionProvider></QueuedPromptProvider>;
}
