import { isRecord } from './workspacePayloadFields';
import type { WorkspaceMessage } from './workspaceTypes';

// OpenClaw hands image attachments to Claude Code as `@<path>` references to a
// staged host copy. The imported Claude transcript keeps that rewritten prompt,
// while the Gateway's own user record carries the real attachment. The staged
// host path is not servable, so it is a transport detail, not authored text.
const STAGED_IMAGE_REFERENCE = /(^|\s)@\/\S*\/\.openclaw-cli-images\/[A-Za-z0-9._-]+\.(?:png|jpe?g|gif|webp|heic|heif)(?=\s|$)/gi;
const COUNTERPART_WINDOW_MS = 60_000;
export const STAGED_IMAGE_PLACEHOLDER = 'Image attached';

/**
 * Preserve the raw object when unchanged. Only an actually emptied imported
 * prompt receives synthesized-placeholder provenance, never authored wording.
 */
export function withoutClaudeStagedImageReferences(raw: Record<string, unknown>): { raw: Record<string, unknown>; placeholder?: true } {
  if (raw.role !== 'user' || !imported(raw)) return { raw };
  if (typeof raw.content === 'string') {
    const content = stripped(raw.content);
    if (content === raw.content) return { raw };
    return { raw: { ...raw, content: content || STAGED_IMAGE_PLACEHOLDER }, ...(!content ? { placeholder: true } : {}) };
  }
  if (!Array.isArray(raw.content)) return { raw };
  let changed = false;
  const content = raw.content.flatMap((part) => {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') return [part];
    const text = stripped(part.text);
    if (text === part.text) return [part];
    changed = true;
    return text ? [{ ...part, text }] : [];
  });
  if (!changed) return { raw };
  return { raw: { ...raw, content: content.length ? content : STAGED_IMAGE_PLACEHOLDER }, ...(!content.length ? { placeholder: true } : {}) };
}

function stripped(text: string) {
  let fence: { char: string; length: number } | null = null; let changed = false;
  const lines = text.split('\n').map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      // CommonMark: only the same character with at least the opening length closes a fence.
      if (!fence) fence = { char: marker[0]!, length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length && !line.trim().slice(marker.length)) fence = null;
      return line;
    }
    if (fence || line.includes('`')) return line;
    STAGED_IMAGE_REFERENCE.lastIndex = 0;
    if (!STAGED_IMAGE_REFERENCE.test(line)) return line;
    changed = true;
    return line.replace(STAGED_IMAGE_REFERENCE, '$1').trimEnd();
  });
  return changed ? lines.join('\n').trim() : text;
}

/**
 * A placeholder is emitted when its page lacks the Gateway image row, which may
 * arrive on another history page. Reconcile over the merged transcript.
 */
export function withoutRedundantStagedImagePlaceholders(messages: WorkspaceMessage[]) {
  const placeholder = (row: WorkspaceMessage) => row.stagedImagePlaceholder === true && row.role === 'user' && row.text === STAGED_IMAGE_PLACEHOLDER
    && !row.attachments?.length && row.cliProvenance?.kind === 'claude-native';
  if (!messages.some(placeholder)) return messages;
  const images = messages.filter(row => row.role === 'user' && row.cliProvenance?.kind !== 'claude-native'
    && row.attachments?.some(item => item.mimeType.startsWith('image/')));
  const placeholders = messages.filter(placeholder);
  const candidates = new Map(placeholders.map(row => {
    const at = timestamp(row);
    return [row, images.filter(image => Boolean(row.sessionKey) && image.sessionKey === row.sessionKey
      && image.transcriptSessionId === row.transcriptSessionId
      && (!image.stagedImageCounterpartId || image.stagedImageCounterpartId === row.id)
      && Math.abs(timestamp(image) - at) <= COUNTERPART_WINDOW_MS)] as const;
  }));
  const counterparts = new Map<WorkspaceMessage, string>();
  const removed = new Set<WorkspaceMessage>();
  for (const [row, matches] of candidates) {
    const image = matches[0];
    if (!image || matches.length !== 1 || [...candidates.values()].filter(rows => rows.includes(image)).length !== 1) continue;
    counterparts.set(image, row.id); removed.add(row);
  }
  if (!removed.size) return messages;
  return messages.flatMap(row => removed.has(row) ? [] : counterparts.has(row)
    ? [{ ...row, stagedImageCounterpartId: counterparts.get(row)! }] : [row]);
}

function imported(row: Record<string, unknown>) {
  return isRecord(row.__openclaw) && row.__openclaw.importedFrom === 'claude-cli';
}

function timestamp(row: WorkspaceMessage) {
  if (!row.timestamp) return NaN;
  const numeric = Number(row.timestamp);
  return Number.isFinite(numeric) ? numeric : Date.parse(row.timestamp);
}
