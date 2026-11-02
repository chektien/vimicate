import { isRecord } from './workspacePayloadFields';

// OpenClaw hands image attachments to Claude Code as `@<path>` references to a
// staged host copy. The imported Claude transcript keeps that rewritten prompt,
// while the Gateway's own user record carries the real attachment. The staged
// host path is not servable, so it is a transport detail, not authored text.
const STAGED_IMAGE_REFERENCE = /(^|\s)@\/\S*\/\.openclaw-cli-images\/[A-Za-z0-9._-]+\.(?:png|jpe?g|gif|webp|heic|heif)(?=\s|$)/gi;

/** Same object when nothing changes, so identity-keyed lookups keep working. */
export function withoutClaudeStagedImageReferences(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.role !== 'user' || !isRecord(raw.__openclaw) || raw.__openclaw.importedFrom !== 'claude-cli') return raw;
  if (typeof raw.content === 'string') {
    const content = stripped(raw.content);
    return content === raw.content ? raw : { ...raw, content };
  }
  if (!Array.isArray(raw.content)) return raw;
  let changed = false;
  const content = raw.content.flatMap((part) => {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') return [part];
    const text = stripped(part.text);
    if (text === part.text) return [part];
    changed = true;
    return text ? [{ ...part, text }] : [];
  });
  return changed ? { ...raw, content } : raw;
}

function stripped(text: string) {
  STAGED_IMAGE_REFERENCE.lastIndex = 0;
  if (!STAGED_IMAGE_REFERENCE.test(text)) return text;
  return text.replace(STAGED_IMAGE_REFERENCE, '$1').replace(/[ \t]+\n/g, '\n').trim();
}
