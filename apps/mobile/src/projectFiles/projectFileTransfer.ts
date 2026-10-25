import { fromByteArray } from 'base64-js';
import type { ProjectFileContent } from '../gateway/projectFiles';

/** Complete validated RPC payload, never the bounded source-row preview. */
export function projectFileTransfer(content: ProjectFileContent) {
  return { filename: content.path.split('/').pop() ?? content.path, mimeType: content.mimeType,
    dataBase64: content.kind === 'text' ? fromByteArray(new TextEncoder().encode(content.text)) : content.dataBase64 };
}
export function isHTMLFile(content: ProjectFileContent) { return content.kind === 'text' && content.mimeType === 'text/html'; }
