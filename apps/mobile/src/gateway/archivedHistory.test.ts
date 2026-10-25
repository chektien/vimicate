import { describe, expect, it, vi } from 'vitest';
import { archivedStateForProject, archiveIdentityTransition, loadNextArchivedSegment, type ArchivedHistoryTransport } from './archivedHistory';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

const key = 'agent:main:dashboard:example-thread';
const current = '33333333-3333-4333-8333-333333333333';
const archived = '00000000-0000-4000-b000-000000000122';
const project: WorkspaceProject = { id: key, sessionKey: key, name: 'Example Thread', path: '', branch: '—', starred: false, threadCount: 0, state: 'idle', sessionId: current, sessionStartedAtMs: 1000 };
const envelope = { contract: 'archived-family-v1', proof: 'audited-baseline+contiguous-ledger-v1', stableSessionKey: key, currentSessionId: current, currentSessionStartedAtMs: 1000, familyToken: 'family' };

describe('archived history owner', () => {
  it('negotiates SQLite census without fabricated epochs and invalidates legacy cursors', async () => {
    const legacy = archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } })!;
    const sqlite = archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'sqlite-family-v1', sessionHistory: 'sqlite-display-v1' } });
    expect(sqlite).not.toBeNull();
    expect(archiveIdentityTransition(legacy, sqlite)).toBe('generation');
    const segments = [
      { sessionId: archived, order: 0, state: 'archived', sourceRevision: 'revision-old' },
      { sessionId: current, order: 1, state: 'current', sourceRevision: 'revision-current' },
    ];
    const nativeEnvelope = { ...envelope, contract: 'sqlite-family-v1', proof: 'verified-import+sqlite-ownership-v1' };
    const request = vi.fn(async (params: Record<string, unknown>) => {
      expect(params.contract).toBe('sqlite-family-v1');
      return params.mode === 'segments'
        ? { ...nativeEnvelope, cursor: 0, hasMore: false, totalSegments: 2, segments }
        : { ...nativeEnvelope, segment: segments[0], sessionId: archived, offset: 0, hasMore: false, totalMessages: 1,
          messages: [{ id: 'native', role: 'assistant', content: 'retained history' }] };
    });
    const result = await loadNextArchivedSegment({ archivedHistoryRequest: request }, sqlite!);
    expect(result.messages[0]?.text).toBe('retained history');
    expect(result.state.segments?.[0]).not.toHaveProperty('startedAtMs');
    await expect(loadNextArchivedSegment({ archivedHistoryRequest: async () => ({ ...nativeEnvelope, proof: envelope.proof }) }, sqlite!)).rejects.toThrow('authority envelope');
    expect(archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'sqlite-family-v1' } })).toBeNull();
  });

  it('enables only for an advertised session with immutable generation identity', () => {
    expect(archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } })?.identity).toMatchObject({ sessionKey: key, currentSessionId: current });
    const { sessionId: _sessionId, ...withoutSessionID } = project;
    expect(archivedStateForProject(withoutSessionID as WorkspaceProject, { capabilities: { archivedSessionFamily: 'archived-family-v1' } })).toBeNull();
  });

  it('recovers the immutable generation from the authoritative thread binding when sessions.list omits it', () => {
    const registry = {
      capabilities: { archivedSessionFamily: 'archived-family-v1' },
      threads: { json: JSON.stringify({ threads: [{ currentBinding: { stableSessionKey: key, state: 'current', sessionID: current, sessionStartedAtSeconds: 1 } }] }) },
    };
    const { sessionId: _sessionId, sessionStartedAtMs: _started, ...withoutGeneration } = project;
    expect(archivedStateForProject(withoutGeneration, registry)?.identity).toEqual({ sessionKey: key, currentSessionId: current, currentSessionStartedAtMs: 1000 });
  });

  it('distinguishes capability arrival from a current-generation rollover', () => {
    const first = archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } })!;
    const rollover = { ...first, identity: { ...first.identity, currentSessionId: '00000000-0000-4000-b000-000000000133', currentSessionStartedAtMs: 2000 } };

    expect(archiveIdentityTransition(null, first)).toBe('available');
    expect(archiveIdentityTransition(first, first)).toBe('same');
    expect(archiveIdentityTransition(first, rollover)).toBe('generation');
    expect(archiveIdentityTransition(first, null)).toBe('removed');
  });

  it('loads exactly one nearest archived segment and prefixes its message identity', async () => {
    const archivedSegment = { sessionId: archived, order: 0, state: 'archived', startedAtMs: 100, endedAtMs: 900, endReason: 'new', sourceRevision: 'revision-old' };
    const currentSegment = { sessionId: current, order: 1, state: 'current', startedAtMs: 1000, sourceRevision: 'revision-current' };
    const request = vi.fn(async (params: Record<string, unknown>) => params.mode === 'segments'
      ? { ...envelope, cursor: 0, hasMore: false, totalSegments: 2, segments: [archivedSegment, currentSegment] }
      : { ...envelope, segment: archivedSegment, sessionId: archived, sessionKey: key, offset: 0, hasMore: false, totalMessages: 1, messages: [{ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'older answer' }] }] });
    const transport: ArchivedHistoryTransport = { archivedHistoryRequest: request };
    const state = archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } });
    const result = await loadNextArchivedSegment(transport, state!);
    expect(result.messages).toEqual([expect.objectContaining({ id: `archive:${archived}:m1`, text: 'older answer', sessionKey: key })]);
    expect(result.hasMore).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('pages within one long archived generation without composing it all at once', async () => {
    const archivedSegment = { sessionId: archived, order: 0, state: 'archived', startedAtMs: 100, endedAtMs: 900, endReason: 'new', sourceRevision: 'revision-old' };
    const currentSegment = { sessionId: current, order: 1, state: 'current', startedAtMs: 1000, sourceRevision: 'revision-current' };
    const transport: ArchivedHistoryTransport = { archivedHistoryRequest: vi.fn(async (params: Record<string, unknown>) => {
      if (params.mode === 'segments') return { ...envelope, cursor: 0, hasMore: false, totalSegments: 2, segments: [archivedSegment, currentSegment] };
      const offset = Number(params.offset);
      return offset === 0
        ? { ...envelope, segment: archivedSegment, sessionId: archived, sessionKey: key, offset: 0, hasMore: true, nextOffset: 2, totalMessages: 4, messages: [{ id: 'newer-1', role: 'assistant', content: 'newer one' }, { id: 'newer-2', role: 'assistant', content: 'newer two' }] }
        : { ...envelope, segment: archivedSegment, sessionId: archived, sessionKey: key, offset: 2, hasMore: false, totalMessages: 4, messages: [{ id: 'older-1', role: 'assistant', content: 'older one' }, { id: 'older-2', role: 'assistant', content: 'older two' }] };
    }) };
    const first = await loadNextArchivedSegment(transport, archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } })!);
    expect(first.messages.map((message) => message.text)).toEqual(['newer one', 'newer two']);
    expect(first.hasMore).toBe(true);
    const second = await loadNextArchivedSegment(transport, first.state);
    expect(second.messages.map((message) => message.text)).toEqual(['older one', 'older two']);
    expect(second.hasMore).toBe(false);
  });

  it('accepts raw totals beyond the presentation cap and skips non-projecting records', async () => {
    const archivedSegment = { sessionId: archived, order: 0, state: 'archived', startedAtMs: 100, endedAtMs: 900, endReason: 'new', sourceRevision: 'revision-old' };
    const currentSegment = { sessionId: current, order: 1, state: 'current', startedAtMs: 1000, sourceRevision: 'revision-current' };
    const request = vi.fn(async (params: Record<string, unknown>) => {
      if (params.mode === 'segments') return { ...envelope, cursor: 0, hasMore: false, totalSegments: 2, segments: [archivedSegment, currentSegment] };
      return Number(params.offset) === 0
        ? { ...envelope, segment: archivedSegment, sessionId: archived, offset: 0, hasMore: true, nextOffset: 1, totalMessages: 2_500, messages: [{ kind: 'metadata-only' }] }
        : { ...envelope, segment: archivedSegment, sessionId: archived, offset: 1, hasMore: true, nextOffset: 2, totalMessages: 2_500, messages: [{ id: 'visible', role: 'assistant', content: 'reachable answer' }] };
    });
    const result = await loadNextArchivedSegment({ archivedHistoryRequest: request }, archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } })!);
    expect(result.messages).toEqual([expect.objectContaining({ id: `archive:${archived}:visible`, text: 'reachable answer' })]);
    expect(result.state.pageCursor).toEqual({ segmentIndex: 0, nextOffset: 2, totalRawRecords: 2_500 });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('treats the host cursor as raw authority when projected row count differs', async () => {
    const archivedSegment = { sessionId: archived, order: 0, state: 'archived', startedAtMs: 100, endedAtMs: 900, endReason: 'new', sourceRevision: 'revision-old' };
    const currentSegment = { sessionId: current, order: 1, state: 'current', startedAtMs: 1000, sourceRevision: 'revision-current' };
    const expandedRows = Array.from({ length: 160 }, (_, index) => ({ id: `expanded-${index}`, role: 'tool', content: `projected ${index}` }));
    const transport: ArchivedHistoryTransport = { archivedHistoryRequest: vi.fn(async (params: Record<string, unknown>) => {
      if (params.mode === 'segments') return { ...envelope, cursor: 0, hasMore: false, totalSegments: 2, segments: [archivedSegment, currentSegment] };
      return Number(params.offset) === 0
        ? { ...envelope, segment: archivedSegment, sessionId: archived, offset: 0, hasMore: true, nextOffset: 128, totalMessages: 129, messages: expandedRows }
        : { ...envelope, segment: archivedSegment, sessionId: archived, offset: 128, hasMore: false, totalMessages: 129, messages: [] };
    }) };

    const first = await loadNextArchivedSegment(transport, archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } })!);
    expect(first.messages).toHaveLength(160);
    expect(first.state.pageCursor).toEqual({ segmentIndex: 0, nextOffset: 128, totalRawRecords: 129 });
    const terminal = await loadNextArchivedSegment(transport, first.state);
    expect(terminal.messages).toEqual([]);
    expect(terminal.hasMore).toBe(false);
  });

  it('rejects a repeated host cursor even when projection rows are present', async () => {
    const archivedSegment = { sessionId: archived, order: 0, state: 'archived', startedAtMs: 100, endedAtMs: 900, endReason: 'new', sourceRevision: 'revision-old' };
    const currentSegment = { sessionId: current, order: 1, state: 'current', startedAtMs: 1000, sourceRevision: 'revision-current' };
    const request = vi.fn(async (params: Record<string, unknown>) => params.mode === 'segments'
      ? { ...envelope, cursor: 0, hasMore: false, totalSegments: 2, segments: [archivedSegment, currentSegment] }
      : { ...envelope, segment: archivedSegment, sessionId: archived, offset: 0, hasMore: true, nextOffset: 0, totalMessages: 2, messages: [{ id: 'visible', role: 'assistant', content: 'row' }] });

    await expect(loadNextArchivedSegment({ archivedHistoryRequest: request }, archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } })!)).rejects.toThrow('non-monotonic');
  });

  it('rejects census authority drift before publishing messages', async () => {
    const transport: ArchivedHistoryTransport = { archivedHistoryRequest: vi.fn(async () => ({ ...envelope, currentSessionId: archived })) };
    const state = archivedStateForProject(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } });
    await expect(loadNextArchivedSegment(transport, state!)).rejects.toThrow('authority envelope');
  });
});
