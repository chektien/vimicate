import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage, WorkspaceMessageRole } from '../workspace/workspaceTypes';
import { transcriptGroupPositions, transcriptMessageMarker, transcriptRolePresentation } from './transcriptPresentation';

describe('transcript presentation', () => {
  it('uses the native transcript glyph grammar for every role', () => {
    const expected: [WorkspaceMessageRole, string][] = [
      ['user', '❯'], ['assistant', ''], ['narration', '※'], ['error', '✗'], ['run', '▸'], ['tool', '⚙'],
      ['approval', '◇'], ['media', '▣'], ['openclaw', '⇄'], ['session', '≡'], ['workspace', '⊞'],
      ['command', '»'], ['boundary', '─'], ['config', '◈'], ['system', '·'], ['vimicate', '❖'], ['operator', '·'],
    ];
    expect(expected.map(([role]) => [role, transcriptRolePresentation(role).marker])).toEqual(expected);
  });

  it('connects consecutive machine rows without grouping conversation or boundaries', () => {
    const messages = ['user', 'run', 'tool', 'error', 'boundary', 'session', 'assistant'].map((role, index) => ({ id: String(index), role, text: role })) as WorkspaceMessage[];
    expect(transcriptGroupPositions(messages)).toEqual(['standalone', 'first', 'middle', 'last', 'standalone', 'standalone', 'standalone']);
  });

  it('does not duplicate the rule glyph on the self-contained compaction boundary', () => {
    expect(transcriptMessageMarker({ role: 'boundary', text: '--- compaction ---' })).toBe('');
    expect(transcriptMessageMarker({ role: 'boundary', text: '──────  new conversation  ──────' })).toBe('─');
  });
});
