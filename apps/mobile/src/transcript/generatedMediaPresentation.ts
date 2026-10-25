import type { WorkspaceAttachment, WorkspaceMessage } from '../workspace/workspaceTypes';

const DELIVERY_SUFFIX = ':generated-media-transcript';
const GENERATED_NAME = /---[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpe?g|webp)$/i;

/**
 * ImageGen publishes prose and a generated-media-transcript delivery separately.
 * Their shared run is explicit, but their media URLs differ (host source versus
 * managed artifact). Only the generator's unique filename, in that same run,
 * bridges those representations. This is display-only: pagination, persistence
 * and canonical identities retain both records, including a standalone delivery
 * when its prose is outside the loaded window. No visual/text/time deduplication.
 */
export function projectGeneratedMediaDeliveries(messages: WorkspaceMessage[]) {
  const answers = new Map<string, WorkspaceMessage[]>();
  const deliveries = new Map<string, WorkspaceMessage[]>();
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.sessionKey || !message.attachments?.length) continue;
    const deliveryRun = !message.text.trim() && message.idempotencyKey?.endsWith(DELIVERY_SUFFIX)
      ? message.idempotencyKey.slice(0, -DELIVERY_SUFFIX.length) : '';
    if (deliveryRun.startsWith('image_generate:')) append(deliveries, scope(message, deliveryRun), message);
    else if (message.text.trim() && message.runId?.startsWith('image_generate:')) append(answers, scope(message, message.runId), message);
  }
  const replacements = new Map<WorkspaceMessage, WorkspaceMessage | null>();
  for (const [key, deliveryRows] of deliveries) {
    const candidates = answers.get(key);
    // Multiple publications/deliveries in one run are not a proven pairing.
    if (deliveryRows.length !== 1 || candidates?.length !== 1) continue;
    const delivery = deliveryRows[0]!; const answer = candidates[0]!;
    const sourceNames = answer.attachments!.map(generatedSourceName);
    const managedNames = delivery.attachments!.map(a => managedGeneratedName(a, delivery.sessionKey!));
    const consumed = new Set<number>();
    const attachments = answer.attachments!.map((attachment, index) => {
      const name = sourceNames[index];
      if (!name || sourceNames.filter(n => n === name).length !== 1 || managedNames.filter(n => n === name).length !== 1) return attachment;
      const managedIndex = managedNames.indexOf(name); consumed.add(managedIndex);
      return { ...delivery.attachments![managedIndex]!, filename: attachment.filename };
    });
    if (!consumed.size) continue;
    replacements.set(answer, { ...answer, attachments });
    const remaining = delivery.attachments!.filter((_, index) => !consumed.has(index));
    replacements.set(delivery, remaining.length ? { ...delivery, attachments: remaining } : null);
  }
  return replacements.size ? messages.flatMap(message => {
    const replacement = replacements.get(message);
    return replacement === null ? [] : [replacement ?? message];
  }) : messages;
}

function scope(message: WorkspaceMessage, run: string) {
  return JSON.stringify([message.sessionKey, message.transcriptSessionId ?? '', run]);
}
function append(map: Map<string, WorkspaceMessage[]>, key: string, message: WorkspaceMessage) {
  const rows = map.get(key); if (rows) rows.push(message); else map.set(key, [message]);
}
function generatedSourceName(attachment: WorkspaceAttachment) {
  if (!attachment.mimeType.startsWith('image/') || !attachment.uri) return '';
  try {
    const url = new URL(attachment.uri, 'https://gateway.invalid');
    if (url.pathname !== '/__openclaw__/assistant-media') return '';
    const source = url.searchParams.get('source') ?? '';
    if (!source.startsWith('/') && !source.startsWith('~/')) return '';
    const name = source.match(/\/media\/tool-image-generation\/([^/]+)$/)?.[1] ?? '';
    return GENERATED_NAME.test(name) ? name : '';
  } catch { return ''; }
}
function managedGeneratedName(attachment: WorkspaceAttachment, sessionKey: string) {
  if (!attachment.mimeType.startsWith('image/') || !attachment.artifactId?.startsWith('artifact_managed_image_') || !attachment.uri || !GENERATED_NAME.test(attachment.filename)) return '';
  try {
    const url = new URL(attachment.uri, 'https://gateway.invalid');
    const route = url.pathname.match(/^\/api\/chat\/media\/outgoing\/([^/]+)\/[^/]+\/full$/);
    return route && decodeURIComponent(route[1]!) === sessionKey ? attachment.filename : '';
  } catch { return ''; }
}
