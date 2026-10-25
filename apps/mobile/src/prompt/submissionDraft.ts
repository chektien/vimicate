import { createPromptState, type PromptState } from './vimPromptCore';

export function clearedForSubmission(state: PromptState): PromptState {
  return { ...createPromptState(''), authority: state.authority + 1, mode: state.mode, register: state.register, registerKind: state.registerKind, registerRevision: state.registerRevision };
}

export function restoredAfterRejectedSubmission(current: PromptState, rejectedText: string): PromptState {
  const laterText = current.text;
  const separator = rejectedText && laterText && !rejectedText.endsWith('\n') ? '\n' : '';
  return { ...createPromptState(`${rejectedText}${separator}${laterText}`), authority: current.authority + 1, mode: 'insert', register: current.register, registerKind: current.registerKind, registerRevision: current.registerRevision };
}

export function mergedRejectedDraft(rejectedText: string, laterText: string) {
  if (!rejectedText) return laterText;
  if (!laterText) return rejectedText;
  return `${rejectedText}${rejectedText.endsWith('\n') ? '' : '\n'}${laterText}`;
}

export function submissionResultOwnsSelectedPrompt(submissionSessionKey: string, selectedSessionKey: string, hydratedSessionKey: string) {
  return Boolean(submissionSessionKey && submissionSessionKey === selectedSessionKey && submissionSessionKey === hydratedSessionKey);
}
