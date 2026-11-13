import { expect, it } from 'vitest';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const path = 'repo@gateway/internal/proof%20image.png';
function row(source = '~/repos/course/repo@gateway/internal/proof image.png'): WorkspaceMessage {
  return { id: 'old-answer', role: 'assistant', sessionKey: 'claims', source: 'history', text: `![Claim screenshot](${path})`,
    attachments: [{ id: 'old-image', filename: 'Claim screenshot', mimeType: 'image/png', pixelWidth: 800,
      uri: `https://gateway.example/__openclaw__/assistant-media?source=${encodeURIComponent(source)}&mediaTicket=expired` }] };
}
const restore = (value: WorkspaceMessage) => parsedTranscriptCache(serializedTranscriptCache([value]))[0]!;

it('repairs already-cached named-root cards using exact authored path evidence, keeping geometry and row identity', () => {
  const before = row(), after = restore(before);
  expect(after.attachments![0]).toEqual({ id: 'old-image', filename: 'Claim screenshot', mimeType: 'image/png', pixelWidth: 800,
    uri: 'repo@gateway/internal/proof image.png', projectImageSessionKey: 'claims' });
  expect(after.id).toBe(before.id); expect(after.text).toBe(before.text);
  expect(restore(after)).toEqual(after); expect(before.attachments![0]!.uri).toContain('mediaTicket=expired');
});

it('does not guess from a basename, another root, absent thread, structured artifact or tool text', () => {
  const noScope = row(); delete noScope.sessionKey;
  for (const value of [row('~/repos/course/unrelated/proof image.png'), row('~/repos/course/repo@other/internal/proof image.png'),
    noScope, { ...row(), text: 'Screenshot attached' }]) {
    expect(restore(value).attachments![0]!.uri).toBe(value.attachments![0]!.uri);
  }
  const artifact = row(); artifact.attachments![0]!.artifactId = 'managed';
  expect(restore(artifact).attachments![0]!.uri).toBe(artifact.attachments![0]!.uri);
  expect(restore({ ...row(), role: 'tool' }).attachments).toBeUndefined();
});

it('preserves qualified literal percent escapes through repeated restores without decoding twice', () => {
  const value = row('~/repos/course/repo@gateway/internal/literal%20.png'); value.text = '![proof](repo@gateway/internal/literal%2520.png)';
  const after = restore(value);
  expect(after.attachments![0]!.uri).toBe('repo@gateway/internal/literal%20.png'); expect(restore(after)).toEqual(after);
});
