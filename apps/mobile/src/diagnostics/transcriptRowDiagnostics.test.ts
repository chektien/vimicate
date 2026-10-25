import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptRowDiagnosticsText } from './transcriptRowDiagnostics';

describe('transcript row diagnostics', () => {
  it('lists the selected session tail with source, identity and run', () => {
    const rows = [
      { id: 'other', role: 'assistant', text: 'x', source: 'history', sessionKey: 'b' },
      { id: 'answer-8a1ce57e', role: 'assistant', text: 'Codex and Claude Code are updated on both machines.', source: 'history', sessionKey: 'a', timestamp: '1790296724984' },
      { id: 'live-chat-run-abcdef', role: 'assistant', text: 'Codex and Claude\nCode', source: 'live', sessionKey: 'a', runId: 'run-abcdef', state: 'complete' },
    ] as WorkspaceMessage[];
    const text = transcriptRowDiagnosticsText(rows, 'a');
    expect(text).not.toContain('id=other');
    expect(text.split('\n')).toEqual([
      'transcript rows (oldest to newest)',
      'H assistant - id=nswer-8a1ce57e at=00:38:44Z len=51 "Codex and Claude Code ar"',
      'L assistant complete id=hat-run-abcdef run=abcdef at=- len=21 "Codex and Claude Code"',
      'live assistant rows',
      'L complete id=hat-run-abcdef at=- pos=1/2 len=21 nn=0 n=1 candidates=0 no-native-text',
    ]);
    expect(transcriptRowDiagnosticsText(rows, 'none')).toBe('transcript rows (oldest to newest)\n(none)');
  });

  it('survives an out-of-range timestamp and bounds the live section', () => {
    const live = Array.from({ length: 10 }, (_, index) => ({ id: `live-chat-run-${index}`, role: 'assistant', text: 'x',
      source: 'live', sessionKey: 'a', runId: `run-${index}`, state: 'complete', timestamp: '999999999999999999999' })) as WorkspaceMessage[];
    const text = transcriptRowDiagnosticsText(live, 'a');
    expect(text).toContain('at=-');
    expect(text).toContain('(2 earlier omitted)');
    expect(text.split('\n').filter(line => line.startsWith('L complete'))).toHaveLength(8);
  });
});
