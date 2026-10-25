import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { coalesceTranscriptIdentities } from '../gateway/transcriptIdentityWall';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { latestHistoryWindow } from '../gateway/historyWindow';
import { projectClaudeHistoryDeliveries } from './claudeHistoryPresentation';

function display(rows: WorkspaceMessage[]) { return projectClaudeHistoryDeliveries(coalesceTranscriptIdentities(rows)); }

const scope = { sessionKey: 'fixture:claude', sessionId: '00000000-0000-4000-8000-000000000130' };
const nativeIdentity = { importedFrom: 'claude-cli', cliSessionId: '00000000-0000-4000-8000-000000000114', externalId: 'native-input' };
function example() {
  return messagesFromPayload({ ...scope, messages: [
    { role: 'user', content: 'Repeat this prompt', timestamp: 1001, __openclaw: { id: 'native-input', ...nativeIdentity } },
    { role: 'assistant', content: 'Working on it', timestamp: 1002, __openclaw: { id: 'native-answer' } },
    // OpenClaw projectImportedIdentity preserves the local ID/position/key and
    // adds these three explicit native identity fields, before any aggregate.
    { role: 'user', content: 'Repeat this prompt', timestamp: 1000, idempotencyKey: 'submission:user',
      __openclaw: { id: 'canonical-input', ...nativeIdentity, transcriptPosition: { source: 'sqlite', rawSeq: 10 } } },
  ] });
}

describe('Claude imported prompt identity before aggregate publication', () => {
  it('retires a cached native prompt using the canonical external ID, keeping the first prompt slot', () => {
    const rows = example(); const before = JSON.stringify(rows);
    const result = display(rows);
    expect(result).toEqual([rows[2], rows[1]]);
    expect(display(result)).toBe(result);
    expect(JSON.stringify(rows)).toBe(before);
    const restored = parsedTranscriptCache(serializedTranscriptCache(result));
    expect(display([...restored, rows[0]!])).toEqual(restored);
    expect(display([rows[2]!, rows[1]!, rows[0]!])).toEqual(result);
  });

  it('bridges metadata-only refresh and cache restore through the real latest-history owner', () => {
    const [native, answer, canonical] = example() as [WorkspaceMessage, WorkspaceMessage, WorkspaceMessage];
    const { cliProvenance: _, ...unlinked } = canonical;
    const current = parsedTranscriptCache(serializedTranscriptCache([native, answer, unlinked]));
    const merged = latestHistoryWindow([canonical], current, scope.sessionKey);
    const published = display(merged);
    expect(published.filter(row => row.role === 'user')).toEqual([canonical]);
    expect(published.indexOf(canonical)).toBeLessThan(published.findIndex(row => row.id === answer.id));
    const refreshed = latestHistoryWindow([canonical], merged, scope.sessionKey);
    const republished = display(parsedTranscriptCache(serializedTranscriptCache(refreshed)));
    expect(republished.filter(row => row.role === 'user')).toEqual([canonical]);
    expect(republished.findIndex(row => row.id === canonical.id)).toBeLessThan(republished.findIndex(row => row.id === answer.id));
  });

  it('keeps real equal-text submissions and an ambiguous identity claim distinct', () => {
    const [native, answer, canonical] = example() as [WorkspaceMessage, WorkspaceMessage, WorkspaceMessage];
    const another = { ...canonical, id: 'other-canonical', idempotencyKey: 'another:user',
      cliProvenance: { kind: 'claude-native' as const, sessionId: nativeIdentity.cliSessionId, externalId: 'other-native' } };
    const otherNative = { ...native, id: 'other-native', cliProvenance: another.cliProvenance };
    expect(display([native, answer, canonical, otherNative, another])
      .filter(row => row.role === 'user')).toEqual([canonical, another]);
    const conflicting = { ...canonical, id: 'conflicting-owner', idempotencyKey: 'another:user' };
    expect(display([native, canonical, conflicting])).toHaveLength(3);
  });

  it('does not infer a binding from text, timestamps, foreign scope or inconsistent content', () => {
    const [native, , canonical] = example() as [WorkspaceMessage, WorkspaceMessage, WorkspaceMessage];
    const controls: Partial<WorkspaceMessage>[] = [
      { sessionKey: 'other' }, { transcriptSessionId: '11111111-1111-4111-8111-111111111111' },
      { cliProvenance: { kind: 'claude-native', sessionId: '11111111-1111-4111-8111-111111111111', externalId: native.id } },
      { text: 'A different prompt' },
      { attachments: [{ id: 'image', filename: 'keep.png', mimeType: 'image/png' }] }, { state: 'error' }, { source: 'live' },
    ];
    for (const change of controls) expect(display([native, { ...canonical, ...change }])).toHaveLength(2);
    for (const key of ['cliProvenance', 'displayPosition', 'idempotencyKey'] as const) {
      const missing = { ...canonical }; delete missing[key];
      expect(display([native, missing])).toHaveLength(2);
    }
    expect(display([{ ...native, runId: 'wrong' }, { ...canonical, runId: 'right' }])).toHaveLength(2);
    expect(display([{ ...native, attachments: [{ id: 'image', filename: 'keep.png', mimeType: 'image/png' }] }, canonical])).toHaveLength(2);
  });
});
