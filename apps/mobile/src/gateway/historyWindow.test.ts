import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { hasRenderedAssistantFinalForRun } from './runCompletionMessage';
import { latestHistoryWindow, latestPresentationWindow, olderHistoryWindow, transcriptPresentationRowCost } from './historyWindow';

const row = (index: number): WorkspaceMessage => ({ id: String(index), role: 'assistant', text: String(index), source: 'history', sessionKey: 'one' });

describe('bounded transcript presentation window', () => {
  it('keeps the oldest side after a deliberate older-history prepend', () => {
    expect(olderHistoryWindow([row(1), row(2)], [row(3), row(4)], 'one', 3).map((item) => item.id)).toEqual(['1', '2', '3']);
  });
  it('retains the review boundary beside one admitted indivisible long record', () => {
    const long = { ...row(1), text: Array.from({ length: 500 }, (_, index) => String(index)).join('\n') };
    const result = olderHistoryWindow([long], [row(2), row(3)], 'one', 480, '2');
    expect(result.map(row => row.id)).toEqual(['1', '2']);
    expect(result.reduce((cost, row) => cost + transcriptPresentationRowCost(row), 0)).toBe(501);
  });
  it('restores the newest side when returning to live tail', () => {
    expect(latestHistoryWindow([row(3), row(4)], [row(1), row(2)], 'one', 3).map((item) => item.id)).toEqual(['2', '3', '4']);
  });
  it('deduplicates overlap before enforcing the cap', () => {
    expect(olderHistoryWindow([row(1), row(2)], [row(2), row(3)], 'one', 4).map((item) => item.id)).toEqual(['1', '2', '3']);
  });
  it('bounds by rendered rows rather than admitting hundreds of multiline messages', () => {
    const multiline = (index: number): WorkspaceMessage => ({ ...row(index), text: Array.from({ length: 100 }, (_, line) => `${index}-${line}`).join('\n') });
    const result = latestHistoryWindow([multiline(1), multiline(2), multiline(3)], [], 'one', 150);
    expect(result.map((item) => item.id)).toEqual(['3']);
    expect(result.reduce((sum, item) => sum + transcriptPresentationRowCost(item), 0)).toBe(100);
  });
  it('charges folded tool output as one visible row', () => {
    const tool: WorkspaceMessage = { ...row(1), role: 'tool', text: Array.from({ length: 20_000 }, (_, index) => String(index)).join('\n') };
    expect(transcriptPresentationRowCost(tool)).toBe(1);
  });
  it('keeps the accepted prompt beside a pathological answer that renders as one explicit fold', () => {
    const prompt: WorkspaceMessage = { ...row(1), role: 'user', text: 'accepted prompt' };
    const answer: WorkspaceMessage = { ...row(2), text: Array.from({ length: 20_000 }, (_, index) => `answer ${index}`).join('\n') };
    expect(transcriptPresentationRowCost(answer)).toBe(1);
    expect(latestHistoryWindow([prompt, answer], [], 'one', 2).map((item) => item.id)).toEqual(['1', '2']);
  });
  it('bounds unique live tool rows without waiting for canonical history refresh', () => {
    const live = Array.from({ length: 2_000 }, (_, index): WorkspaceMessage => ({ ...row(index), role: 'tool', source: 'live', text: `tool ${index}\n${'x'.repeat(2_000)}` }));
    const bounded = latestPresentationWindow(live);
    expect(bounded).toHaveLength(480);
    expect(bounded[0]?.id).toBe('1520');
    expect(bounded.at(-1)?.id).toBe('1999');
  });
  it('retains the accepted prompt when its live detail fills the entire newest window', () => {
    const prompt: WorkspaceMessage = {
      id: 'accepted', role: 'user', text: 'keep this accepted prompt', source: 'local', sessionKey: 'one', runId: 'run-1',
    };
    const live = Array.from({ length: 480 }, (_, index): WorkspaceMessage => ({
      id: `tool-${index}`, role: 'tool', text: `tool ${index}`, source: 'live', sessionKey: 'one', runId: 'run-1',
    }));

    const bounded = latestPresentationWindow([prompt, ...live]);

    expect(bounded).toHaveLength(480);
    expect(bounded[0]?.id).toBe('accepted');
    expect(bounded[1]?.id).toBe('tool-1');
    expect(bounded.at(-1)?.id).toBe('tool-479');

    const refreshed = latestHistoryWindow([], [prompt, ...live], 'one');
    expect(refreshed.map((message) => message.id)).toEqual(bounded.map((message) => message.id));
  });
  it('does not resurrect a prompt from before a new-conversation boundary', () => {
    const prompt: WorkspaceMessage = { id: 'old-prompt', role: 'user', text: 'old', source: 'history', sessionKey: 'one' };
    const boundary: WorkspaceMessage = { id: 'new', role: 'boundary', text: 'new conversation', source: 'history', sessionKey: 'one' };
    const live = Array.from({ length: 480 }, (_, index): WorkspaceMessage => ({
      id: `new-tool-${index}`, role: 'tool', text: `tool ${index}`, source: 'live', sessionKey: 'one', runId: 'run-new',
    }));

    const bounded = latestPresentationWindow([prompt, boundary, ...live]);

    expect(bounded).toHaveLength(480);
    expect(bounded[0]?.id).toBe('new-tool-0');
    expect(bounded.some((message) => message.id === 'old-prompt')).toBe(false);
  });
  it('keeps one shared-run completion after the canonical final across repeated refreshes', () => {
    const prompt = (id: string, text: string, source: 'history' | 'local', key: string, timestamp: string): WorkspaceMessage => ({
      id, text, role: 'user', source, sessionKey: 'one', runId: 'shared-run', idempotencyKey: key, timestamp,
    });
    const localPrimary = prompt('local-primary', 'primary', 'local', 'primary', '1000');
    const localSteer = prompt('local-steer', 'steer', 'local', 'steer', '2000');
    const canonicalPrimary = prompt('history-primary', 'primary', 'history', 'primary:user', '1000');
    const canonicalSteer = prompt('history-steer', 'steer', 'history', 'steer:user', '2000');
    const final: WorkspaceMessage = {
      id: 'history-final', role: 'assistant', text: 'PRIMARY\nSTEER', source: 'history', sessionKey: 'one', timestamp: '4000',
    };
    const completion: WorkspaceMessage = {
      id: 'live-run-shared-run', role: 'run', text: '✓ done in 3s', state: 'complete', source: 'live', sessionKey: 'one', runId: 'shared-run',
    };
    const canonical = [canonicalPrimary, canonicalSteer, final];

    const first = latestHistoryWindow(
      canonical,
      [localPrimary, completion, localSteer],
      'one',
    );
    expect(first.map((message) => message.id)).toEqual([
      'history-primary', 'history-steer', 'history-final', 'live-run-shared-run',
    ]);

    // A prior RN refresh can also have persisted a synthetic history footer
    // with the same timestamp as its parent assistant. The next refresh must
    // replace that projection, not sort it ahead of the assistant or retain
    // both it and the run-owned live footer.
    const staleSynthetic: WorkspaceMessage = {
      id: 'history-run-history-final', role: 'run', text: '✓ done in 3s', state: 'complete', source: 'history', sessionKey: 'one', timestamp: '4000',
    };
    const second = latestHistoryWindow(
      canonical,
      [canonicalPrimary, canonicalSteer, staleSynthetic, final, completion],
      'one',
    );
    expect(second.map((message) => message.id)).toEqual([
      'history-primary', 'history-steer', 'history-final', 'live-run-shared-run',
    ]);
  });

  it('publishes a canonical final as the accepted run turn and removes its stale pending row', () => {
    const localPrompt: WorkspaceMessage = {
      id: 'local-prompt', role: 'user', text: 'question', source: 'local', sessionKey: 'one', runId: 'run-1', idempotencyKey: 'submission', timestamp: '1000',
    };
    const pending: WorkspaceMessage = {
      id: 'live-run-run-1', role: 'run', text: '… run completed · final answer pending', state: 'streaming', source: 'live', sessionKey: 'one', runId: 'run-1',
    };
    const canonicalPrompt: WorkspaceMessage = {
      id: 'history-prompt', role: 'user', text: 'question', source: 'history', sessionKey: 'one', idempotencyKey: 'submission:user', timestamp: '1000',
    };
    const canonicalFinal: WorkspaceMessage = {
      id: 'history-final', role: 'assistant', text: 'answer', source: 'history', sessionKey: 'one', timestamp: '4000',
    };

    const published = latestHistoryWindow([canonicalPrompt, canonicalFinal], [localPrompt, pending], 'one');
    expect(published.map((message) => message.id)).toEqual(['history-prompt', 'history-final', 'history-run-history-final']);
    expect(published[0]).toMatchObject({ runId: 'run-1' });
    expect(hasRenderedAssistantFinalForRun(published, 'run-1')).toBe(true);
    expect(published.some((message) => message.text.includes('final answer pending'))).toBe(false);
  });

  it('shows a canonical final immediately when its user row no longer text-matches the submitted prompt', () => {
    const localPrompt: WorkspaceMessage = {
      id: 'local-prompt', role: 'user', text: 'post the presentation update', source: 'local',
      sessionKey: 'one', runId: 'run-56', idempotencyKey: 'submission-56', timestamp: '1000',
    };
    const pending: WorkspaceMessage = {
      id: 'live-run-run-56', role: 'run', text: '… run completed · final answer pending',
      state: 'streaming', source: 'live', sessionKey: 'one', runId: 'run-56',
    };
    // OpenClaw can persist a normalized, posted-prefix or attachment-only user
    // representation that cannot safely reconcile to the locally authored
    // prompt by text. BUG-056's native display planner hid the real answer in
    // this shape until a thread switch rebuilt the transcript.
    const canonicalPrompt: WorkspaceMessage = {
      id: 'history-prompt', role: 'user', text: '[posted message with attachment]',
      source: 'history', sessionKey: 'one', timestamp: '2000',
    };
    const canonicalFinal: WorkspaceMessage = {
      id: 'history-final', role: 'assistant', text: 'The presentation update was posted successfully.',
      source: 'history', sessionKey: 'one', timestamp: '3000',
    };

    const published = latestHistoryWindow(
      [canonicalPrompt, canonicalFinal],
      [localPrompt, pending],
      'one',
    );

    expect(published.filter(({ role }) => role === 'assistant').map(({ text }) => text)).toEqual([
      canonicalFinal.text,
    ]);
    expect(published.findIndex(({ id }) => id === canonicalFinal.id)).toBeGreaterThan(
      published.findIndex(({ id }) => id === canonicalPrompt.id),
    );
  });
});
