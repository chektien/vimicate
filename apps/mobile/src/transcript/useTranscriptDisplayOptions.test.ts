import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptOptionCommand, visibleTranscriptMessages } from './transcriptDisplayOptions';

const messages: WorkspaceMessage[] = [
  { id: 'assistant', role: 'assistant', text: 'answer', source: 'live' },
  { id: 'tool', role: 'tool', text: 'result', source: 'live' },
  { id: 'run', role: 'run', text: 'working', source: 'live' },
  { id: 'raw', role: 'openclaw', text: 'frame', source: 'live' },
  { id: 'history', role: 'session', text: 'durable boundary', source: 'history' },
];

describe('transcript display options', () => {
  it('hides only live progress/raw detail while preserving answers, tool results, and durable rows', () => {
    expect(visibleTranscriptMessages(messages, { progress: false, verbose: false }).map((message) => message.id)).toEqual(['assistant', 'tool', 'history']);
  });
  it('parses toggles and explicit values without changing state on invalid input', () => {
    expect(transcriptOptionCommand(':progress off', { progress: true, verbose: true }).options?.progress).toBe(false);
    expect(transcriptOptionCommand(':verbose', { progress: true, verbose: true }).options?.verbose).toBe(false);
    expect(transcriptOptionCommand(':progress maybe', { progress: true, verbose: true }).options).toBeUndefined();
  });
});
