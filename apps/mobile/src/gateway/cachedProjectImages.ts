import { markdownImageSources } from '../workspace/markdownImagePath';
import { qualifiedProjectFilePath } from '../projectFiles/qualifiedProjectFilePath';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** Repair the old workspace-prefix bug only with exact authored path evidence. */
export function repairedCachedProjectImages(message: WorkspaceMessage): WorkspaceMessage {
  if (!['assistant', 'narration'].includes(message.role) || !message.sessionKey || !message.attachments?.length) return message;
  const authored = markdownImageSources(message.text).filter(({ source }) => qualifiedProjectFilePath(source));
  if (!authored.length) return message;
  let changed = false;
  const attachments = message.attachments.map(attachment => {
    if (attachment.artifactId || !attachment.mimeType.startsWith('image/') || !attachment.uri) return attachment;
    if (qualifiedProjectFilePath(attachment.uri)) {
      if (attachment.projectImageSessionKey === message.sessionKey) return attachment;
      changed = true; return { ...attachment, projectImageSessionKey: message.sessionKey! };
    }
    let source: string;
    try {
      const url = new URL(attachment.uri, 'https://cached.invalid');
      if (!url.pathname.endsWith('/__openclaw__/assistant-media')) return attachment;
      source = url.searchParams.get('source') ?? '';
    } catch { return attachment; }
    const matches = new Set(authored.filter(({ source: decoded, rawSource }) => [decoded, rawSource].some(candidate =>
      source === candidate || (source.startsWith('/') || source.startsWith('~/')) && source.endsWith('/' + candidate)))
      .map(({ source }) => source));
    if (matches.size !== 1) return attachment;
    changed = true;
    const { headers: _headers, ...facts } = attachment;
    return { ...facts, uri: [...matches][0]!, projectImageSessionKey: message.sessionKey! };
  });
  return changed ? { ...message, attachments } : message;
}
