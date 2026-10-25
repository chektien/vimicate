import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** Explicit simulator fixture; the loopback server contains no real Gateway data. */
export function imageStreamFixture(): WorkspaceMessage[] {
  return ['declared', 'chunked', 'valid'].map((kind, index) => ({
    id: `image-stream-${kind}`, role: 'assistant', state: 'complete',
    text: kind === 'valid' ? 'Valid image after rejected downloads' : `Reject oversized ${kind} image`,
    timestamp: `2026-08-31T03:00:0${index}+08:00`,
    attachments: [{ id: kind, filename: `${kind}.png`, mimeType: 'image/png',
      uri: `http://127.0.0.1:18768/__openclaw__/assistant-media?source=${kind}&mediaTicket=fixture` }],
  }));
}
