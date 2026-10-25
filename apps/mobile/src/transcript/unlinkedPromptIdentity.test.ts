import { describe, expect, it } from 'vitest';
import fixture from '../../../../fixtures/openclaw/unlinked-prompt-identity.json';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { latestHistoryWindow } from '../gateway/historyWindow';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { projectTranscriptDisplayGroups } from './transcriptDisplayProjection';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

// The opt-in host test compares this wire fixture to actual installed native
// parser/index output. No real session, media or runtime response is captured.
const { sessionKey, sessionId, nativeWire, canonicalWire, linkedCanonicalWire } = fixture;
const answer = { role: 'assistant', content: 'Synthetic native progress', timestamp: nativeWire.timestamp + 1000,
  __openclaw: { id: 'native-answer', importedFrom: 'claude-cli', cliSessionId: fixture.cliSessionId, externalId: 'native-answer' } };
function parse(messages: unknown[], scope = { sessionKey, sessionId }) {
  return messagesFromPayload({ ...scope, messages });
}
function restore(rows: WorkspaceMessage[]) { return parsedTranscriptCache(serializedTranscriptCache(rows)); }
function users(rows: WorkspaceMessage[]) { return projectTranscriptDisplayGroups(rows).filter(row => row.role === 'user'); }

describe('unlinked Claude source-to-projection identity boundary', () => {
  it('reproduces two representations before proof across refresh and durable cache restore', () => {
    const native = parse([nativeWire, answer]);
    const canonical = parse([canonicalWire]);
    const before = JSON.stringify([native, canonical]);
    let retained = latestHistoryWindow(canonical, restore(native), sessionKey);
    for (let count = 0; count < 3; count++) {
      expect(users(retained).map(row => row.id)).toEqual(['native-0', 'canonical-0']);
      retained = restore(latestHistoryWindow(canonical, retained, sessionKey));
    }
    expect(JSON.stringify([native, canonical])).toBe(before);
    expect(retained.map(row => row.id)).toContain('native-answer');
    expect(users(retained).find(row => row.id === 'canonical-0')?.cliProvenance).toBeUndefined();
  });

  it('uses the native-enriched canonical identity before any aggregate and preserves durable anchors', () => {
    const initial = restore(parse([nativeWire, answer, canonicalWire]));
    const linked = parse([linkedCanonicalWire]);
    let retained = latestHistoryWindow(linked, initial, sessionKey);
    for (let count = 0; count < 3; count++) {
      const displayed = projectTranscriptDisplayGroups(retained);
      expect(displayed.filter(row => row.role === 'user' || row.role === 'assistant').map(row => row.id))
        .toEqual(['canonical-0', 'native-answer']);
      expect(users(retained)[0]).toMatchObject({ idempotencyKey: 'submission-0:user',
        displayPosition: linked[0]!.displayPosition, cliProvenance: linked[0]!.cliProvenance });
      // Persist the source vector, not display-only reconciliation. A partial
      // answer-only page must not erase the earlier prompt ordering anchor.
      expect(retained.map(row => row.id)).toContain('native-0');
      retained = restore(latestHistoryWindow(parse([answer]), retained, sessionKey));
    }
    expect(initial.find(row => row.id === 'canonical-0')?.cliProvenance).toBeUndefined();
  });

  it('does not promote a session binding, run ID, acceptance receipt or equal clocks into a native prompt link', () => {
    for (const change of [
      { cliSessionId: fixture.cliSessionId, externalId: 'native-0' },
      { runId: 'submission-0' }, { inputReceiptRunId: 'submission-0' },
    ]) {
      const canonical = { ...canonicalWire, ...change,
        __openclaw: { ...canonicalWire.__openclaw, ...change } };
      expect(users(restore(latestHistoryWindow(parse([canonical]), parse([nativeWire]), sessionKey))))
        .toHaveLength(2);
    }
  });

  it('keeps two intentional equal submissions distinct, whether both are unlinked or explicitly linked', () => {
    const secondNative = { ...nativeWire, __openclaw: { ...nativeWire.__openclaw, id: 'native-1', externalId: 'native-1' } };
    const secondCanonical = { ...canonicalWire, idempotencyKey: 'submission-1:user',
      __openclaw: { ...canonicalWire.__openclaw, id: 'canonical-1', seq: 2,
        transcriptPosition: { source: 'sqlite-fixture', rawSeq: 2 } } };
    const initial = parse([nativeWire, secondNative]);
    const unlinked = latestHistoryWindow(parse([canonicalWire, secondCanonical]), initial, sessionKey);
    expect(users(restore(unlinked))).toHaveLength(4);
    const linkedSecond = { ...secondCanonical, __openclaw: { ...secondCanonical.__openclaw,
      importedFrom: 'claude-cli', cliSessionId: fixture.cliSessionId, externalId: 'native-1' } };
    const linked = latestHistoryWindow(parse([linkedCanonicalWire, linkedSecond]), unlinked, sessionKey);
    expect(users(restore(linked)).map(row => row.idempotencyKey)).toEqual(['submission-0:user', 'submission-1:user']);
    expect(linked.filter(row => row.role === 'user')).toHaveLength(4);
  });

  it('requires the same route, concrete generation and CLI identity even through the cache codec', () => {
    const native = parse([nativeWire]);
    const controls = [
      parse([linkedCanonicalWire], { sessionKey: 'agent:main:fixture:foreign', sessionId }),
      parse([linkedCanonicalWire], { sessionKey, sessionId: '11111111-1111-4111-8111-111111111111' }),
      parse([{ ...linkedCanonicalWire, __openclaw: { ...linkedCanonicalWire.__openclaw,
        cliSessionId: '11111111-1111-4111-8111-111111111111' } }]),
      parse([{ ...linkedCanonicalWire, __openclaw: { ...linkedCanonicalWire.__openclaw, externalId: 'other-native' } }]),
    ];
    for (const canonical of controls) expect(users(restore([...native, ...canonical]))).toHaveLength(2);
  });
});
