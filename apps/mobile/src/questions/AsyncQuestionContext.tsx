import { createContext, useContext } from 'react';
import type { useAsyncGatewayQuestions } from '../gateway/useAsyncGatewayQuestions';
const Context = createContext<ReturnType<typeof useAsyncGatewayQuestions> | null>(null);
export const AsyncQuestionProvider = Context.Provider;
export const useAsyncQuestionActions = () => useContext(Context);
