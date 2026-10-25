import type { WorkspaceAttachment } from '../workspace/workspaceTypes';

const SILENT_ASSISTANT_SENTINELS = ['NO_REPLY', 'HEARTBEAT_OK'] as const;
const GENERIC_STREAMING_STATUS = new Set(['working', 'wrapping up', 'waiting for response']);

export function assistantProtocolTextIsSilent(text: string) {
  const normalized = text.trim();
  return SILENT_ASSISTANT_SENTINELS.some((sentinel) => normalized === sentinel);
}

export type AssistantProtocolProjection = {
  text: string;
  attachments: WorkspaceAttachment[];
  deferred: boolean;
};

/**
 * Projects OpenClaw's assistant protocol tokens at the Gateway ingress edge.
 * Only exact terminal sentinels are silent. While cumulative content streams,
 * an exact prefix is held until it completes or becomes authored prose. Media
 * remains independent content even when its accompanying text is a sentinel.
 */
export function projectAssistantProtocolContent(
  text: string,
  attachments: WorkspaceAttachment[],
  terminal: boolean,
): AssistantProtocolProjection {
  const normalized = text.trim();
  const exactSentinel = assistantProtocolTextIsSilent(normalized);
  const incompleteSentinel = !terminal
    && Boolean(normalized)
    && SILENT_ASSISTANT_SENTINELS.some((sentinel) => sentinel.startsWith(normalized));
  const genericStreamingStatus = !terminal && GENERIC_STREAMING_STATUS.has(normalized.toLocaleLowerCase());
  const bareDeliveryIdentifier = terminal && /^\d{12,32}$/.test(normalized);

  if (exactSentinel || incompleteSentinel || genericStreamingStatus || bareDeliveryIdentifier) {
    return { text: '', attachments, deferred: (incompleteSentinel || genericStreamingStatus) && !attachments.length };
  }
  return { text, attachments, deferred: false };
}
