import type { WorkspaceMessage } from './workspaceTypes';
import { isRecord } from './workspacePayloadFields';

export type MessageToolSend = { text: string; final: boolean };

/** Keep only the classification evidence, never destinations or credentials. */
export function messageToolSend(name: string, args: unknown): MessageToolSend | undefined {
  if (name !== 'message' && !name.endsWith('__message') || !isRecord(args)
    || args.action !== undefined && args.action !== 'send') return undefined;
  return validatedMessageToolSend({ text: args.message, final: args.final !== false });
}

export function validatedMessageToolSend(value: unknown): MessageToolSend | undefined {
  if (!isRecord(value) || typeof value.text !== 'string' || !value.text.trim()
    || value.text.length > 64_000 || typeof value.final !== 'boolean') return undefined;
  return { text: value.text.trim(), final: value.final };
}

/** A fresh mirror omits final just as its cached copy did. Keep its earned
 * classification until a loaded send supplies contrary evidence below. */
export function retainingMessageToolProgress(previous: WorkspaceMessage | undefined, incoming: WorkspaceMessage): WorkspaceMessage {
  return previous?.source === 'history' && incoming.source === 'history'
    && previous.role === 'narration' && incoming.role === 'assistant'
    && Boolean(previous.sessionKey) && previous.sessionKey === incoming.sessionKey
    && previous.transcriptSessionId === incoming.transcriptSessionId
    && Boolean(previous.idempotencyKey?.includes(':message-tool:'))
    && previous.idempotencyKey === incoming.idempotencyKey && previous.text.trim() === incoming.text.trim()
    ? { ...incoming, role: 'narration' } : incoming;
}

/** Re-run over the loaded transcript, including merged pages and cache rows.
 * Gateway mirrors omit `final`; the matching saved call supplies it by exact
 * text. Equal completed sends remain replies, as in the original policy.
 * No page-local index survives independently of the transcript that owns it. */
export function reconcileMessageToolProgress(rows: WorkspaceMessage[]): WorkspaceMessage[] {
  const scopes = new Map<string, { progress: Set<string>; replies: Set<string> }>();
  const scope = (row: WorkspaceMessage) => JSON.stringify([row.sessionKey, row.transcriptSessionId]);
  for (const row of rows) {
    const send = row.source === 'history' && row.role === 'tool' ? row.tool?.messageSend : undefined;
    if (!send) continue;
    const key = scope(row);
    let texts = scopes.get(key);
    if (!texts) { texts = { progress: new Set(), replies: new Set() }; scopes.set(key, texts); }
    (send.final ? texts.replies : texts.progress).add(send.text);
  }
  return rows.map(row => {
    if (row.source !== 'history' || row.role !== 'assistant' && row.role !== 'narration'
      || !row.idempotencyKey?.includes(':message-tool:')) return row;
    const texts = scopes.get(scope(row));
    const text = row.text.trim();
    const role = texts?.replies.has(text) ? 'assistant' : texts?.progress.has(text) ? 'narration' : row.role;
    return role === row.role ? row : { ...row, role };
  });
}
