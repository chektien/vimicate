import { describe, expect, it } from 'vitest';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const raw = '/Users/example/Library/Mobile%20Documents/notes/phone.png';
const decoded = raw.replace('%20', ' ');
function row(source = raw, text = `![phone](${raw})`): WorkspaceMessage {
  return { id: 'answer', role: 'assistant', text, sessionKey: 'thread', source: 'history',
    attachments: [{ id: 'old-image', filename: 'phone', mimeType: 'image/png', pixelWidth: 390,
      uri: `https://gateway.example/dashboard/__openclaw__/assistant-media?source=${encodeURIComponent(source)}` }] };
}
function restored(message: WorkspaceMessage) {
  return parsedTranscriptCache(serializedTranscriptCache([message]))[0]!;
}
function source(message: WorkspaceMessage) {
  return new URL(message.attachments![0]!.uri!).searchParams.get('source');
}
describe('restoring pre-fix Markdown image caches', () => {
  it('repairs a cached iCloud image without waiting for a history refetch', () => {
    const before = row(); const after = restored(before);
    expect(source(after)).toBe(decoded);
    expect(after.attachments![0]).toMatchObject({ id: 'old-image', filename: 'phone', pixelWidth: 390 });
    expect(after.text).toBe(before.text); expect(source(before)).toBe(raw);
  });
  it('is idempotent when a literal percent escape survives one decode', () => {
    const path = '/notes/literal%2520.png';
    const once = restored(row(path, `![phone](${path})`));
    expect(source(once)).toBe('/notes/literal%20.png');
    expect(restored(once)).toEqual(once);
  });
  it('does not decode again when another Markdown link resembles a repaired percent path', () => {
    const text = '![phone](/notes/literal%2520.png) ![other](/notes/literal%20.png)';
    const once = restored(row('/notes/literal%2520.png', text));
    expect(source(once)).toBe('/notes/literal%20.png');
    expect(restored(once)).toEqual(once);
  });
  it('preserves raw MEDIA paths and structured attachments without matching Markdown', () => {
    expect(source(restored(row(raw, `MEDIA:${raw}`)))).toBe(raw);
    expect(source(restored(row(raw, 'Screenshot attached')))).toBe(raw);
    expect(source(restored(row('/notes/other%20file.png')))).toBe('/notes/other%20file.png');
  });
  it('drops stale tickets, preserves thread scope, and supports relative route URLs', () => {
    const before = row();
    before.attachments![0]!.uri = `/__openclaw__/assistant-media?source=${encodeURIComponent(raw)}&mediaTicket=expired&sessionKey=thread`;
    const uri = restored(before).attachments![0]!.uri!;
    expect(uri.startsWith('/__openclaw__/assistant-media?')).toBe(true);
    const url = new URL(uri, 'https://gateway.example');
    expect(url.searchParams.get('source')).toBe(decoded);
    expect(url.searchParams.get('sessionKey')).toBe('thread');
    expect(url.searchParams.has('mediaTicket')).toBe(false);
  });
  it('preserves managed artifacts and non-image attachments', () => {
    const artifact = row(); artifact.attachments![0]!.artifactId = 'managed';
    expect(source(restored(artifact))).toBe(raw);
    const file = row(); file.attachments![0]!.mimeType = 'application/pdf';
    expect(source(restored(file))).toBe(raw);
  });
});
