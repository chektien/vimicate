import { createContext, useContext } from 'react';
import type { useGatewayQueuedPrompts } from '../gateway/useGatewayQueuedPrompts';
const Context = createContext<ReturnType<typeof useGatewayQueuedPrompts> | null>(null);
export const QueuedPromptProvider = Context.Provider;
export const useQueuedPromptActions = () => useContext(Context);
