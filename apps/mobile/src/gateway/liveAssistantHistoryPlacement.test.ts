import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { correlateLiveAssistantsToCanonicalTurns } from './liveAssistantHistoryPlacement';

const prompt: WorkspaceMessage = { id: 'p', role: 'user', text: 'request', source: 'history',
  sessionKey: 's', transcriptSessionId: 'g1', runId: 'r1', idempotencyKey: 'p:user', timestamp: '1788265860000' };
const oldLive: WorkspaceMessage = { id: 'live-chat-r1', role: 'assistant', text: 'same prefix more old output',
  source: 'live', state: 'complete', sessionKey: 's', transcriptSessionId: 'g1', runId: 'r1' };
const answer: WorkspaceMessage = { ...oldLive, id: 'new-answer', source: 'history', text: 'same prefix' };

describe('canonical turn ownership', () => {
  it.each([
    { transcriptSessionId: 'g2', runId: 'r2' },
    { sessionKey: 'other' },
    { transcriptSessionId: 'g2' },
    { runId: 'r2' },
  ])('refuses reused prompt identity across conflicting concrete owners: %j', (scope) => {
    const canonical = [{ ...prompt, ...scope }, { ...answer, ...scope }];
    const result = correlateLiveAssistantsToCanonicalTurns(canonical, [oldLive], [prompt, oldLive]);
    expect(result.consumed.size).toBe(0);
    expect(result.messages).toEqual(canonical);
  });

  it.each([
    { sessionKey: 'other' }, { transcriptSessionId: 'g2' }, { runId: 'r2' },
  ])('refuses conflicting prompt owners even when assistant owners agree: %j', (scope) => {
    // Distinct primary IDs exercise the submission-key path as well.
    const canonical = [{ ...prompt, id: 'canonical-p', ...scope }, answer];
    const result = correlateLiveAssistantsToCanonicalTurns(canonical, [oldLive], [prompt, oldLive]);
    expect(result.consumed.size).toBe(0);
    expect(result.messages).toEqual(canonical);
  });

  it('refuses conflicting assistant owners even when the prompt identity matches', () => {
    const canonical = [prompt, { ...answer, runId: 'r2' }];
    const result = correlateLiveAssistantsToCanonicalTurns(canonical, [oldLive], [prompt, oldLive]);
    expect(result.consumed.size).toBe(0);
    expect(result.messages).toEqual(canonical);
  });

  it('correlates an owned prefix when concrete scope agrees', () => {
    const result = correlateLiveAssistantsToCanonicalTurns([prompt, answer], [oldLive], [prompt, oldLive]);
    expect(result.consumed.has(oldLive)).toBe(true);
    expect(result.messages[1]).toMatchObject({ id: answer.id, source: 'history', text: answer.text });
  });
});
