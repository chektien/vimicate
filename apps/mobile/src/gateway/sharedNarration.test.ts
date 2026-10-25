import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import { loadSharedNarration, mergeSharedNarration, sharedNarrationStateForProject, type SharedNarrationTransport } from './sharedNarration';

const sessionKey = 'agent:main:direct:vimicate-ios:project:r3cap';
const sessionId = '00000000-0000-4000-b000-000000000126';
const token = 'A'.repeat(43);
const project: WorkspaceProject = { id: sessionKey, sessionKey, name: 'R3CAP', path: '~/repos/r3cap', branch: 'main', starred: false, threadCount: 1, state: 'running', sessionId };

function narrationRecord(runId: string, itemId: string, text: string, timestamp: number, sequence: number) {
  return { runId, itemId, text, firstSequence: sequence, lastSequence: sequence + 1, firstTimestampMs: timestamp, lastTimestampMs: timestamp + 10, revision: 2 };
}

describe('shared Gateway narration hydration', () => {
  it('enables only for the advertised contract and an immutable session generation', () => {
    expect(sharedNarrationStateForProject(project, { capabilities: { sharedNarration: 'shared-narration-v1' } })).toEqual({ sessionKey, sessionId });
    expect(sharedNarrationStateForProject(project, { capabilities: {} })).toBeNull();
    const { sessionId: _sessionId, ...withoutSessionId } = project;
    expect(sharedNarrationStateForProject(withoutSessionId, { capabilities: { sharedNarration: 'shared-narration-v1' } })).toBeNull();
  });

  it('hydrates one immutable bounded snapshot across pages', async () => {
    const records = [
      narrationRecord('run-1', 'pre-1', 'first preamble', 100, 1),
      narrationRecord('run-1', 'pre-2', 'second preamble', 300, 3),
    ];
    const request = vi.fn(async (params: Record<string, unknown>) => Number(params.cursor) === 0
      ? { contract: 'shared-narration-v1', stableSessionKey: sessionKey, sessionId, snapshotToken: token, cursor: 0, nextCursor: 1, hasMore: true, totalRecords: 2, records: [records[0]] }
      : { contract: 'shared-narration-v1', stableSessionKey: sessionKey, sessionId, snapshotToken: token, cursor: 1, hasMore: false, totalRecords: 2, records: [records[1]] });

    const messages = await loadSharedNarration({ sharedNarrationRequest: request }, { sessionKey, sessionId });
    expect(messages).toEqual([
      expect.objectContaining({ id: 'live-item-run-1-pre-1', role: 'narration', text: 'first preamble', timestamp: '100', runId: 'run-1', sessionKey, source: 'history' }),
      expect.objectContaining({ id: 'live-item-run-1-pre-2', timestamp: '300' }),
    ]);
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 1, snapshotToken: token }));
  });

  it('repairs the exact delayed R3CAP steering chronology and replaces an untimed live cache row', () => {
    const history: WorkspaceMessage[] = [
      // The photographed run was still active. All three accepted prompts
      // therefore remained optimistic/local when the delayed narration was
      // hydrated; a history-only sort cannot move narration across them.
      { id: 'p1', role: 'user', text: 'edit the saved file', timestamp: '1787764659052', sessionKey, source: 'local' },
      { id: 'p2', role: 'user', text: 'also ask ccwork', timestamp: '1787764680778', sessionKey, source: 'local' },
      { id: 'p3', role: 'user', text: 'use ccwork where possible', timestamp: '1787764692019', sessionKey, source: 'local' },
      { id: 'live-item-run-1-pre-1', role: 'narration', text: 'short preamble', runId: 'run-1', sessionKey, source: 'live', state: 'streaming' },
    ];
    // The physical report was born from these exact source times: the first
    // narration happened after the initial prompt but before either steer.
    // Arrival order grouped all three prompts first; source chronology must
    // recover the actual turn without relying on that arrival order.
    const durable: WorkspaceMessage[] = [
      { id: 'live-item-run-1-pre-1', role: 'narration', text: 'complete preamble', timestamp: '1787764675398', runId: 'run-1', sessionKey, source: 'history' },
      { id: 'live-item-run-1-pre-2', role: 'narration', text: 'delegation preamble', timestamp: '1787764691802', runId: 'run-1', sessionKey, source: 'history' },
    ];

    const merged = mergeSharedNarration(history, durable);
    expect(merged.map((message) => message.id)).toEqual([
      'p1', 'live-item-run-1-pre-1', 'p2', 'live-item-run-1-pre-2', 'p3',
    ]);
    expect(merged[1]).toMatchObject({ text: 'complete preamble', source: 'history', timestamp: '1787764675398' });
  });

  it('rejects authority, snapshot, cursor and identity drift before publication', async () => {
    const requestFor = (payload: Record<string, unknown>): SharedNarrationTransport => ({ sharedNarrationRequest: vi.fn(async () => payload) });
    const base = { contract: 'shared-narration-v1', stableSessionKey: sessionKey, sessionId, snapshotToken: token, cursor: 0, hasMore: false, totalRecords: 0, records: [] };
    await expect(loadSharedNarration(requestFor({ ...base, sessionId: '33333333-3333-4333-8333-333333333333' }), { sessionKey, sessionId })).rejects.toThrow('authority envelope');
    await expect(loadSharedNarration(requestFor({ ...base, snapshotToken: 'short' }), { sessionKey, sessionId })).rejects.toThrow('snapshot');
    await expect(loadSharedNarration(requestFor({ ...base, cursor: 2 }), { sessionKey, sessionId })).rejects.toThrow('authority envelope');
    await expect(loadSharedNarration(requestFor({ ...base, totalRecords: 1, records: [narrationRecord('same', 'same', 'one', 1, 1)], hasMore: true, nextCursor: 1 }), { sessionKey, sessionId })).rejects.toThrow('non-monotonic');
  });
});

it.each([
  { runId: 'r2' },
  { sessionKey: 'other' },
  { transcriptSessionId: 'other-generation' },
  { narrationItemId: 'other-item' },
])('preserves a distinct assistant when narration has conflicting ownership: %j', (conflict) => {
  const prompt: WorkspaceMessage = { id: 'p', role: 'user', text: 'request', source: 'history',
    sessionKey: 's', transcriptSessionId: 'g', timestamp: '1788265859000' };
  const shared: WorkspaceMessage = { id: 'live-item-r1-n', role: 'narration', text: 'intentional repeat',
    source: 'history', sessionKey: 's', transcriptSessionId: 'g', runId: 'r1', narrationItemId: 'n', timestamp: '1788265860000' };
  const answer: WorkspaceMessage = { id: 'distinct-answer', role: 'assistant', text: shared.text, state: 'complete',
    source: 'history', sessionKey: 's', transcriptSessionId: 'g', timestamp: '1788265860100', ...conflict };
  const rows = mergeSharedNarration([prompt, answer], [shared]);
  expect(rows.find(row => row.id === answer.id)).toEqual(answer);
  expect(rows.filter(row => row.text === shared.text)).toHaveLength(2);
});

it.each([
  { runId: 'r1' },
  { narrationItemId: 'n' },
  { cliProvenance: { kind: 'claude-native' as const, sessionId, externalId: 'live-item-r1-n' } },
])('prefers the exact narration owner over an equal-text unowned candidate: %j', (identity) => {
  const shared: WorkspaceMessage = { id: 'live-item-r1-n', role: 'narration', text: 'checking', source: 'history',
    sessionKey: 's', transcriptSessionId: 'g', runId: 'r1', narrationItemId: 'n', timestamp: '1788265860000' };
  const exact: WorkspaceMessage = { id: 'native-exact', role: 'assistant', text: shared.text, source: 'history',
    sessionKey: 's', transcriptSessionId: 'g', timestamp: '1788265861182', ...identity };
  const other: WorkspaceMessage = { id: 'unowned-repeat', role: 'assistant', text: shared.text, source: 'history',
    sessionKey: 's', transcriptSessionId: 'g', timestamp: '1788265860100' };
  const prompt: WorkspaceMessage = { ...other, id: 'prompt', role: 'user', text: 'request', timestamp: '1788265859000' };
  const rows = mergeSharedNarration([prompt, other, exact], [shared]);
  expect(rows.find(row => row.id === other.id)).toEqual(other);
  expect(rows.filter(row => row.role === 'narration')).toHaveLength(1);
  expect(rows.filter(row => row.text === shared.text)).toHaveLength(2);
});

it('keeps the 1.182 second unowned native preamble fallback', () => {
  const shared: WorkspaceMessage = { id: 'live-item-r1-n', role: 'narration', text: 'checking', source: 'history',
    sessionKey: 's', transcriptSessionId: 'g', runId: 'r1', narrationItemId: 'n', timestamp: '1788265860000' };
  const native: WorkspaceMessage = { id: 'native', role: 'assistant', text: shared.text, source: 'history',
    sessionKey: 's', transcriptSessionId: 'g', timestamp: '1788265861182' };
  const prompt: WorkspaceMessage = { ...native, id: 'prompt', role: 'user', text: 'request', timestamp: '1788265859000' };
  expect(mergeSharedNarration([prompt, native], [shared]).slice(1)).toEqual([expect.objectContaining({ role: 'narration', runId: 'r1', narrationItemId: 'n' })]);
});
