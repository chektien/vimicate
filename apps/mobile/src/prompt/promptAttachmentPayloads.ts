import { byteLength } from 'base64-js';
import {
  MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES,
  type GatewayPromptAttachment,
  type PromptAttachment,
} from './promptAttachments';

type BoundedAttachmentReader = {
  readonly size?: number | null;
  readBase64(length: number): Promise<string>;
};

export type AttachmentReaderFactory = (uri: string) => Promise<BoundedAttachmentReader>;

export async function materializePromptAttachment(
  attachment: PromptAttachment,
  openReader: AttachmentReaderFactory,
  remainingBytes = MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES,
  assertActive: () => void = () => {},
): Promise<GatewayPromptAttachment> {
  const reader = await openReader(attachment.uri);
  assertActive();
  if (typeof reader.size === 'number' && reader.size > remainingBytes) {
    throw new Error(`${attachment.filename} exceeds the remaining 18 MB total attachment budget.`);
  }
  // Native code owns bounded I/O, file-handle disposal and base64 encoding.
  // A whole-file async read would lose the bound if picker metadata is stale.
  const dataBase64 = await reader.readBase64(remainingBytes + 1);
  const byteCount = byteLength(dataBase64);

  if (!byteCount) throw new Error(`${attachment.filename} is empty or could not be read.`);
  if (byteCount > remainingBytes) {
    throw new Error(`${attachment.filename} exceeds the remaining 18 MB total attachment budget.`);
  }

  return {
    id: attachment.id,
    uri: attachment.uri,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    byteCount,
    dataBase64,
  };
}
