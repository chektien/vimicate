import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

function latestResponse(messages: readonly WorkspaceMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === 'assistant' || message.role === 'narration') {
      // Transport IDs, authorization and canonical hydration are not new prose.
      return JSON.stringify([message.runId ?? '', message.role, message.text,
        message.attachments?.map(item => [item.id, item.filename]) ?? []]);
    }
  }
  return '';
}

/** One bounded receipt for the selected session; pagination never supplies this tail. */
export function useTranscriptResponseNotice(sessionKey: string, messages: readonly WorkspaceMessage[], reviewing: boolean) {
  const response = latestResponse(messages);
  const previous = useRef({ sessionKey, response });
  const [notice, setNotice] = useState<string | null>(null);
  useLayoutEffect(() => {
    const sameSession = previous.current.sessionKey === sessionKey;
    if (!sameSession || !reviewing) setNotice(null);
    else if (response && response !== previous.current.response) setNotice(sessionKey);
    previous.current = { sessionKey, response };
  }, [sessionKey, response, reviewing]);
  const acknowledge = useCallback((loadedMessages: readonly WorkspaceMessage[]) => {
    // Explicit navigation or manual end arrival acknowledges only the committed live prose actually
    // reached. An old page or a retired callback cannot consume a newer receipt.
    if (previous.current.sessionKey !== sessionKey || previous.current.response !== response
      || !response || latestResponse(loadedMessages) !== response) return;
    setNotice(null);
  }, [sessionKey, response]);
  return { visible: reviewing && notice === sessionKey, acknowledge };
}
