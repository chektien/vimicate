import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';

// Physical example-project: prompts sent during a Claude run stayed twice. The local
// row kept the composer's trailing newline/space; pending-input custody held
// the Gateway-trimmed text under the same submission id.
const sessionKey = 'agent:main:direct:fixture-queue';
const transcriptSessionId = '33333333-3333-4333-8333-333333333333';
const acceptedAt = 1_790_334_537_267;

function rows(localText: string, pendingText: string): WorkspaceMessage[] {
  return [
    { id: 'local-sub-1', role: 'user', source: 'local', sessionKey, text: localText, idempotencyKey: 'sub-1',
      runId: 'active-run', timestamp: String(acceptedAt - 62) },
    { id: 'pending-input:custody-1', role: 'user', source: 'history', sessionKey, transcriptSessionId, text: pendingText,
      runId: 'sub-1', inputAcceptedAtMs: acceptedAt, timestamp: String(acceptedAt) },
  ];
}

describe('queued prompt custody with authored edge whitespace', () => {
  it.each([['fix this\nthe error is misleading\n', 'fix this\nthe error is misleading'],
    ['test related errors and fix all of them ', 'test related errors and fix all of them']])(
    'keeps one row for %j', (local, pending) => {
      const users = coalesceTranscriptIdentities(rows(local, pending)).filter(row => row.role === 'user');
      expect(users).toHaveLength(1);
      expect(users[0]?.source).toBe('local');
    });

  it('pairs through the submission id when the acknowledgement bound a different operation id', () => {
    const [local, pending] = rows('fix this', 'fix this');
    const users = coalesceTranscriptIdentities([{ ...local!, inputReceiptRunId: 'op-9' }, pending!]).filter(row => row.role === 'user');
    expect(users).toHaveLength(1);
  });

  it('keeps both rows when the text differs beyond edge whitespace', () => {
    expect(coalesceTranscriptIdentities(rows('fix this', 'fix that')).filter(row => row.role === 'user')).toHaveLength(2);
  });
});
