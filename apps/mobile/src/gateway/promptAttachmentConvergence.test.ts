import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { mergeLatestHistory } from './historyPagination';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';

const localImage = { id: 'picker-image', filename: 'screenshot.png', mimeType: 'image/png', uri: 'file:///private/picker/screenshot.png', byteCount: 212405 };
const local: WorkspaceMessage = { id: 'local-prompt', role: 'user', text: 'review this image', source: 'local', sessionKey: 'one', idempotencyKey: 'submission', attachments: [localImage] };
function canonical(mediaCount = 1) {
  return messagesFromPayload({ sessionKey: 'one', messages: [{ role: 'user', content: local.text, timestamp: 1100, idempotencyKey: 'submission:user', __openclaw: {
    id: 'canonical-prompt', steerTargetRunId: 'active-run',
    media: Array.from({ length: mediaCount }, (_, i) => ({ url: `media://inbound/image-${i}.png`, contentType: 'image/png', kind: 'image', sizeBytes: 212405 })),
    mediaImageLayout: { slots: Array.from({ length: mediaCount }, (_, i) => ({ kind: 'inline', factIndex: i })) },
  } }] })[0]!;
}
const preamble: WorkspaceMessage = { id: 'preamble', role: 'narration', text: 'checking the image', source: 'live', runId: 'active-run', sessionKey: 'one' };

describe('prompt media across optimistic and preamble/history convergence', () => {
  it('keeps one attachment at send, first preamble refresh, and subsequent refreshes', () => {
    const durable = canonical();
    expect(durable.attachments).toHaveLength(1);
    let rows = [local, preamble];
    expect(rows[0]!.attachments).toHaveLength(1);
    for (let refresh = 0; refresh < 3; refresh++) {
      rows = mergeLatestHistory([durable], rows, 'one');
      expect(rows.filter((m) => m.role === 'user')).toHaveLength(1);
      expect(rows.find((m) => m.role === 'user')?.attachments).toEqual(durable.attachments);
      expect(rows.some((m) => m.id === 'preamble')).toBe(true);
    }
  });

  it('does not resurrect the local URI from a late optimistic replay in either merge order', () => {
    const durable = canonical();
    for (const copies of [[local, durable], [durable, local]]) {
      const joined = coalesceTranscriptIdentities(copies);
      expect(joined).toHaveLength(1);
      expect(joined[0]?.attachments).toEqual(durable.attachments);
      expect(coalesceTranscriptIdentities([...joined, local])[0]?.attachments).toEqual(durable.attachments);
    }
  });

  it('repairs previously persisted doubled cards from the next canonical refresh', () => {
    const durable = canonical();
    const polluted = { ...durable, attachments: [...durable.attachments!, localImage] };
    const cache = parsedTranscriptCache(serializedTranscriptCache([polluted]));
    expect(cache[0]?.attachments).toHaveLength(2);
    const refreshed = mergeLatestHistory([durable], cache, 'one');
    expect(refreshed[0]?.attachments).toEqual(durable.attachments);
  });

  it('keeps two genuinely distinct managed images even when filenames are equal', () => {
    const durable = canonical(2);
    durable.attachments = durable.attachments!.map((a) => ({ ...a, filename: 'screenshot.png' }));
    const rows = mergeLatestHistory([durable], [local], 'one');
    expect(rows[0]?.attachments).toEqual(durable.attachments);
    expect(rows[0]?.attachments).toHaveLength(2);
  });

  it('retains local media while a partial canonical record has no attachment snapshot', () => {
    const { attachments: _ignored, ...partial } = canonical();
    expect(mergeLatestHistory([partial], [local], 'one')[0]?.attachments).toEqual([localImage]);
  });
});
