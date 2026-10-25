import { BoundedSessionCache } from '../workspace/boundedSessionCache';

export const MAX_PROMPT_ATTACHMENTS = 10;
export const MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES = 18 * 1024 * 1024;

export type PromptAttachment = { id: string; uri: string; filename: string; mimeType: string; byteCount: number; kind: 'image' | 'file' };
export type GatewayPromptAttachment = { id: string; filename: string; mimeType: string; byteCount: number; dataBase64: string; uri?: string };
export type PromptAttachmentImport = Readonly<{ sessionKey: string }>;

export class SessionPromptAttachmentDrafts {
  private readonly values: BoundedSessionCache<PromptAttachment[]>;
  constructor(private readonly discard: (items: PromptAttachment[]) => void = () => {}) {
    this.values = new BoundedSessionCache(64, discard);
  }
  dispose() { this.cancelImport(); this.values.clear(); }
  private readonly empty: PromptAttachment[] = [];
  private pendingImport: PromptAttachmentImport | undefined;

  beginImport(sessionKey: string): PromptAttachmentImport | undefined {
    if (!sessionKey || this.pendingImport) return undefined;
    return this.pendingImport = { sessionKey };
  }
  isImporting(sessionKey: string) { return this.pendingImport?.sessionKey === sessionKey; }
  ownsImport(ticket: PromptAttachmentImport) { return this.pendingImport === ticket; }
  finishImport(ticket: PromptAttachmentImport) {
    if (!this.ownsImport(ticket)) return false;
    this.pendingImport = undefined;
    return true;
  }
  cancelImport() { this.pendingImport = undefined; }
  hasPendingDrafts() { return this.values.hasEntries() || this.pendingImport !== undefined; }

  restore(sessionKey: string) { return this.values.restore(sessionKey) ?? this.empty; }
  replace(sessionKey: string, attachments: PromptAttachment[]) {
    if (sessionKey) {
      this.discard(this.restore(sessionKey).filter((item) => !attachments.some((next) => next.uri === item.uri)));
      if (attachments.length) this.values.store(sessionKey, attachments);
      else this.values.delete(sessionKey);
    }
    return attachments;
  }
  append(sessionKey: string, additions: PromptAttachment[]) {
    return this.replace(sessionKey, appendPromptAttachments(this.restore(sessionKey), additions));
  }
  remove(sessionKey: string, id: string) {
    return this.replace(sessionKey, this.restore(sessionKey).filter((item) => item.id !== id));
  }
  clear(sessionKey: string) { return this.replace(sessionKey, []); }
}

export function normalizedPromptAttachment(input: { id?: string | undefined; uri?: string | undefined; filename?: string | null | undefined; mimeType?: string | null | undefined; byteCount?: number | null | undefined }): PromptAttachment {
  const uri = input.uri?.trim() ?? ''; const filename = input.filename?.trim() || 'attachment'; const mimeType = input.mimeType?.trim().toLowerCase() || inferredMimeType(filename);
  const byteCount = typeof input.byteCount === 'number' && Number.isFinite(input.byteCount) ? Math.floor(input.byteCount) : 0;
  if (!uri) throw new Error('The selected attachment has no readable file location.');
  if (byteCount < 1) throw new Error(`${filename} is empty or its size is unavailable.`);
  if (byteCount > MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES) throw new Error(`${filename} exceeds the 18 MB total attachment budget.`);
  return { id: input.id?.trim() || `${Date.now()}-${filename}-${byteCount}`, uri, filename, mimeType, byteCount, kind: mimeType.startsWith('image/') ? 'image' : 'file' };
}

export function appendPromptAttachments(current: PromptAttachment[], additions: PromptAttachment[]) {
  const unique = additions.filter((addition) => !current.some((item) => item.uri === addition.uri && item.filename === addition.filename && item.byteCount === addition.byteCount));
  if (current.length + unique.length > MAX_PROMPT_ATTACHMENTS) throw new Error(`Attachment limit reached: ${MAX_PROMPT_ATTACHMENTS}.`);
  const result = [...current, ...unique];
  if (result.reduce((sum, item) => sum + item.byteCount, 0) > MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES) throw new Error('Attachments exceed the 18 MB total per-message budget.');
  return result;
}

export function formattedAttachmentSize(byteCount: number) {
  if (byteCount >= 1_000_000) return `${(byteCount / 1_000_000).toFixed(1)} MB`;
  if (byteCount >= 1_000) return `${(byteCount / 1_000).toFixed(1)} KB`;
  return `${byteCount} B`;
}

function inferredMimeType(filename: string) {
  const extension = filename.split('.').at(-1)?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'txt' || extension === 'md') return 'text/plain';
  return 'application/octet-stream';
}
