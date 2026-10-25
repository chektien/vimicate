import { messagesFromPayload } from '../workspace/historyMessageProjection';
const sessionKey = 'agent:main:direct:images';
const sessionId = '00000000-0000-4000-b000-000000000152';
const runId = 'image_generate:00000000-0000-4000-9000-000000000144:ok:agent-loop';
const names = ['scene---00000000-0000-4000-b000-000000000166.png', 'scene---00000000-0000-4000-b000-000000000142.png'];
export function generatedMediaPair() {
  return messagesFromPayload({ sessionKey, sessionId, messages: [
    { id: 'answer', role: 'assistant', timestamp: 1000, __openclaw: { runId }, content: `Two versions\n\n**Version 1**\n![Scene version 1](/host/.openclaw/media/tool-image-generation/${names[0]})\n\n**Version 2**\n![Scene version 2](/host/.openclaw/media/tool-image-generation/${names[1]})` },
    { id: 'delivery', role: 'assistant', timestamp: 1096, idempotencyKey: `${runId}:generated-media-transcript`, content: names.map((alt, i) => ({ type: 'image', alt, artifactId: `artifact_managed_image_${i}`, url: `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/${i}/full`, mimeType: 'image/png', width: 1915 + i * 3, height: 821 - i, sizeBytes: 1801087 + i })) },
  ] });
}
