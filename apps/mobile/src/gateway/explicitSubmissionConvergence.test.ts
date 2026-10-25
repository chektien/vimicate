import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { mergeLatestHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { projectTranscriptDisplayGroups } from '../transcript/transcriptDisplayProjection';

const sessionKey = 'agent:main:fixture:submission-convergence';
const timestamp = '1700000001000';
const local = (submission: string): WorkspaceMessage => ({
  id: `local-${submission}`, role: 'user', source: 'local', sessionKey,
  transcriptSessionId: '11111111-1111-4111-8111-111111111111', runId: 'shared-active-run',
  idempotencyKey: submission, text: 'Repeat this intentional prompt', timestamp,
});
const canonical = (submission: string): WorkspaceMessage => ({
  ...local(submission), id: `canonical-${submission}`, source: 'history',
  idempotencyKey: `${submission}:user`,
});
const restore = (rows: WorkspaceMessage[]) => parsedTranscriptCache(serializedTranscriptCache(rows));

describe('explicit submission identity during canonical convergence', () => {
  it.each([true, false])('does not consume the first equal prompt when only the second submission is canonical, timed=%s', (timed) => {
    const first = local('first');
    const second = local('second');
    const admitted = canonical('second');
    if (!timed) for (const row of [first, second, admitted]) delete row.timestamp;
    const original = JSON.stringify([first, second, admitted]);
    let rows = mergeLatestHistory([admitted], [first, second], sessionKey);
    for (let refresh = 0; refresh < 3; refresh++) {
      expect(rows.map(row => row.id)).toEqual([first.id, admitted.id]);
      expect(projectTranscriptDisplayGroups(rows).filter(row => row.role === 'user')).toHaveLength(2);
      rows = mergeLatestHistory([admitted], restore(rows), sessionKey);
    }
    expect(JSON.stringify([first, second, admitted])).toBe(original);
    // The delayed first canonical row completes convergence without losing
    // either intentionally repeated input or borrowing its sibling's slot.
    rows = mergeLatestHistory([canonical('first'), admitted], rows, sessionKey);
    expect(rows.map(row => row.id)).toEqual(['canonical-first', admitted.id]);
    expect(rows.map(row => row.idempotencyKey)).toEqual(['first:user', 'second:user']);
  });

  it('preserves an unrelated explicit local submission beside equal canonical content', () => {
    const authored = local('local-only');
    const unrelated = canonical('elsewhere');
    const rows = mergeLatestHistory([unrelated], [authored], sessionKey);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(authored);
    expect(rows).toContainEqual(unrelated);
  });

  it('still joins the exact explicit submission when canonical time and translated command text differ', () => {
    const authored = { ...local('exact'), text: ':Think high' };
    const admitted = { ...canonical('exact'), text: ':think high', timestamp: '1700000002000' };
    expect(mergeLatestHistory([admitted], [authored], sessionKey))
      .toEqual([{ ...admitted, text: authored.text }]);
  });

  it.each(['neither', 'canonical', 'local'] as const)('retains the established legacy fallback with %s key missing', (missing) => {
    const authored = local('legacy');
    const admitted = canonical('legacy');
    if (missing !== 'canonical') delete authored.idempotencyKey;
    if (missing !== 'local') delete admitted.idempotencyKey;
    expect(mergeLatestHistory([admitted], [authored], sessionKey)).toHaveLength(1);
  });
});
