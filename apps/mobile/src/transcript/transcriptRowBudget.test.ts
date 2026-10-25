import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptMessageIsFoldedByDefault } from './transcriptRowBudget';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';

const base = { source: 'live' as const, sessionKey: 'agent:one', timestamp: '1788359872003' };

/**
 * A machine row publishes a semantic headline first and its raw payload
 * underneath. Everything past that headline is evidence the reader asks for,
 * not prose: a short structured payload must not render unfolded merely
 * because it fits inside the character bound.
 */
describe('machine row fold budget', () => {
  it('folds any machine row that carries detail below its headline', () => {
    expect(transcriptMessageIsFoldedByDefault({ role: 'error', text: 'read timed out after 120s\n{\n  "code": "tool_timeout"\n}' })).toBe(true);
    expect(transcriptMessageIsFoldedByDefault({ role: 'approval', text: 'open a review page\n{\n  "tool": "browser"\n}' })).toBe(true);
    expect(transcriptMessageIsFoldedByDefault({ role: 'tool', text: 'Bash · completed' })).toBe(true);
  });

  it('keeps a headline-only machine row visible', () => {
    expect(transcriptMessageIsFoldedByDefault({ role: 'error', text: 'read timed out after 120s' })).toBe(false);
    expect(transcriptMessageIsFoldedByDefault({ role: 'run', text: 'end' })).toBe(false);
  });

  it('leaves ordinary conversation unfolded', () => {
    expect(transcriptMessageIsFoldedByDefault({ role: 'assistant', text: 'Line one.\nLine two.\nLine three.' })).toBe(false);
    expect(transcriptMessageIsFoldedByDefault({ role: 'narration', text: 'Reading the config.\nChecking the allowlist.' })).toBe(false);
  });

  it('keeps a folded approval decidable', () => {
    const approval: WorkspaceMessage = {
      ...base, id: 'live-approval-a1', role: 'approval', state: 'streaming',
      text: 'open a review page\n{\n  "tool": "browser",\n  "target": "https://example.com"\n}',
      approval: { id: 'a1', kind: 'plugin', allowedDecisions: ['allow-once', 'deny'], resolved: false },
    };
    const [row, ...rest] = buildVisibleTranscriptRenderRows([approval], new Set());
    expect(rest).toHaveLength(0);
    expect(row?.compiled.source).toBe('open a review page  … [4 lines folded]');
    // The decision affordance renders on the last row of a message, and a
    // folded row is both the first and the last row of its message.
    expect(row?.firstInMessage).toBe(true);
    expect(row?.lastInMessage).toBe(true);
    expect(row?.fold).toEqual({ expanded: false, hiddenLineCount: 4 });
    expect(buildVisibleTranscriptRenderRows([approval], new Set(['live-approval-a1'])).at(-1)?.lastInMessage).toBe(true);
  });
});
