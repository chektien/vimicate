import { byteLength } from 'base64-js';
import { materializePromptAttachment, type AttachmentReaderFactory } from './promptAttachmentPayloads';
import { MAX_PROMPT_ATTACHMENTS, MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES, type GatewayPromptAttachment, type PromptAttachment } from './promptAttachments';

export type ImageUploadCopy = { dataBase64: string; byteCount: number; mimeType: string };
export type ImageUploadOptimizer = (dataBase64: string) => Promise<ImageUploadCopy>;
const GATEWAY_IMAGE_BYTES = 6 * 1024 * 1024;

/** Count original bytes against the shared budget; only upload copies are optimized. */
export async function materializePromptAttachmentBatch(selected: PromptAttachment[], openReader: AttachmentReaderFactory, optimize: ImageUploadOptimizer, onOptimize: (filename: string) => void, assertActive: () => void = () => {}) {
  if (selected.length > MAX_PROMPT_ATTACHMENTS) throw new Error(`Attachment limit reached: ${MAX_PROMPT_ATTACHMENTS}.`);
  let remaining = MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES;
  const result: GatewayPromptAttachment[] = [];
  for (const attachment of selected) {
    assertActive();
    let payload = await materializePromptAttachment(attachment, openReader, remaining, assertActive);
    assertActive();
    remaining -= payload.byteCount;
    if (attachment.kind === 'image' && payload.byteCount > GATEWAY_IMAGE_BYTES) {
      onOptimize(attachment.filename);
      const copy = await optimize(payload.dataBase64);
      assertActive();
      if (copy.mimeType !== 'image/jpeg' || copy.byteCount < 1 || copy.byteCount > GATEWAY_IMAGE_BYTES || byteLength(copy.dataBase64) !== copy.byteCount) throw new Error('Could not prepare an image upload copy. The original attachment is unchanged.');
      payload = { ...payload, ...copy, filename: `${attachment.filename.replace(/\.[^.]+$/, '')}.upload.jpg` };
    }
    result.push(payload);
  }
  return result;
}
