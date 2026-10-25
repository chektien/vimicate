import { describe, expect, it } from 'vitest';
import {
  authoredPromptFromTrajectory,
  recoveredSegmentFromTrajectory,
  recoveredSegmentsFromTrajectoryRecords,
} from './recover-openclaw-history-family.mjs';

const stableKey = 'agent:main:direct:vimicate-ios:project:example-project';
const sessionId = '00000000-0000-4000-b000-000000000161';

function record(type, ts, seq, data, runId = 'run-1') {
  return { type, ts, seq, data, runId, sessionId, sessionKey: stableKey, workspaceDir: '/tmp/example-project' };
}

describe('trajectory history recovery', () => {
  it('extracts the last authored Vimicate prompt rather than replay scaffolding', () => {
    expect(authoredPromptFromTrajectory('Vimicate selected project context:\nUser prompt:\nold\n\nVimicate project context:\nUser prompt:\nactual')).toBe('actual');
  });

  it('projects ordered user, tool, result, and assistant records into canonical JSONL', () => {
    const segment = recoveredSegmentFromTrajectory([
      record('prompt.submitted', '2026-05-19T10:00:00.000Z', 1, { prompt: 'Vimicate project context:\nUser prompt:\nrun tests' }),
      record('tool.call', '2026-05-19T10:00:01.000Z', 2, { toolCallId: 'call-1', name: 'bash', arguments: { command: 'pnpm test' } }),
      record('tool.result', '2026-05-19T10:00:02.000Z', 3, { toolCallId: 'call-1', name: 'bash', output: '{"passed":235}' }),
      record('model.completed', '2026-05-19T10:00:03.000Z', 4, { assistantTexts: ['All tests pass.'] }),
    ], stableKey, sessionId);
    const lines = segment.bytes.toString('utf8').trim().split('\n').map(JSON.parse);

    expect(lines[0]).toMatchObject({ type: 'session', id: sessionId, timestamp: '2026-05-19T10:00:00.000Z' });
    expect(lines.slice(1).map((line) => line.message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
    expect(lines[1].message.content).toBe('run tests');
    expect(lines[2].message.content[0]).toMatchObject({ type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'pnpm test' } });
    expect(lines[3].message.content[0]).toMatchObject({ type: 'toolResult', toolCallId: 'call-1', text: '{"passed":235}' });
    expect(lines[4].message.content[0].text).toBe('All tests pass.');
    expect(segment.messageCount).toBe(4);
  });

  it('fails closed when a trajectory mixes stable or concrete session authority', () => {
    const valid = record('prompt.submitted', '2026-05-19T10:00:00.000Z', 1, { prompt: 'hello' });
    expect(() => recoveredSegmentFromTrajectory([{ ...valid, sessionKey: 'agent:main:other' }], stableKey, sessionId)).toThrow(/mixes stable session authority/);
    expect(() => recoveredSegmentFromTrajectory([{ ...valid, sessionId: '00000000-0000-4000-8000-000000000150' }], stableKey, sessionId)).toThrow(/mixes concrete session authority/);
  });

  it('groups a rotated trajectory sink by record-owned concrete session authority', () => {
    const secondSessionId = '00000000-0000-4000-8000-000000000150';
    const currentSessionId = '00000000-0000-4000-8000-000000000125';
    const first = record(
      'prompt.submitted',
      '2026-05-19T10:00:00.000Z',
      1,
      { prompt: 'first generation' }
    );
    const second = {
      ...record(
        'prompt.submitted',
        '2026-05-20T10:00:00.000Z',
        1,
        { prompt: 'second generation' }
      ),
      sessionId: secondSessionId,
    };
    const current = {
      ...record(
        'prompt.submitted',
        '2026-05-21T10:00:00.000Z',
        1,
        { prompt: 'current generation stays canonical' }
      ),
      sessionId: currentSessionId,
    };

    const segments = recoveredSegmentsFromTrajectoryRecords(
      [second, first, second, current, { ...first, sessionKey: 'agent:main:other' }],
      stableKey,
      currentSessionId
    );

    expect(segments.map((segment) => segment.sessionId)).toEqual([
      sessionId,
      secondSessionId,
    ]);
    expect(segments.map((segment) => segment.messageCount)).toEqual([1, 1]);
  });

  it('fails closed when an exact-key trajectory record lacks session authority', () => {
    const currentSessionId = '00000000-0000-4000-8000-000000000125';
    expect(() => recoveredSegmentsFromTrajectoryRecords([
      { ...record('prompt.submitted', '2026-05-19T10:00:00.000Z', 1, { prompt: 'x' }), sessionId: 'invalid' },
    ], stableKey, currentSessionId)).toThrow(/no concrete session authority/);
  });
});
