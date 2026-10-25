import { markdownImageSources } from '../workspace/markdownImagePath';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** Repair only a saved image whose source still equals its escaped Markdown
 * destination. Do not blindly decode raw paths or already-corrected URLs. */
export function repairedCachedMarkdownImages(message: WorkspaceMessage): WorkspaceMessage {
  if (message.role !== 'assistant' || !message.attachments?.length) return message;
  const replacements = new Map(markdownImageSources(message.text)
    .filter(({ rawSource, source }) => source !== rawSource && (rawSource.startsWith('/') || rawSource.startsWith('~/')))
    .map(({ rawSource, source }) => [rawSource, source]));
  if (!replacements.size) return message;
  let changed = false;
  const attachments = message.attachments.map(attachment => {
    if (!attachment.uri || attachment.artifactId || !attachment.mimeType.startsWith('image/')) return attachment;
    try {
      const url = new URL(attachment.uri, 'https://cached.invalid');
      if (!url.pathname.endsWith('/__openclaw__/assistant-media')) return attachment;
      const previousSource = url.searchParams.get('source') ?? '';
      // Another link may contain a literal percent escape. An already-correct
      // destination is ambiguous evidence, not permission to decode it again.
      if ([...replacements.values()].includes(previousSource)) return attachment;
      const source = replacements.get(previousSource);
      if (!source) return attachment;
      url.searchParams.set('source', source);
      // Any old signature belongs to the retired source; mint a fresh ticket.
      url.searchParams.delete('mediaTicket');
      changed = true;
      return { ...attachment, uri: attachment.uri.startsWith('/') ? `${url.pathname}${url.search}` : url.toString() };
    } catch { return attachment; }
  });
  return changed ? { ...message, attachments } : message;
}
