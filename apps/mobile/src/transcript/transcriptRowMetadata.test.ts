import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptRowLifecycle, transcriptRowTimestamp } from './transcriptRowMetadata';

const chronology = { timeLabel: '11:40', focusedTimeLabel: 'Aug 27, 11:40' };

describe('transcript row metadata', () => {
  it('keeps a completed assistant response timestamp instead of replacing it with a duplicate tick', () => {
    const message: WorkspaceMessage = { id: 'answer', role: 'assistant', text: 'Updated standup.md', state: 'complete', timestamp: '2026-08-27T03:40:45.195Z' };
    const lifecycle = transcriptRowLifecycle(message);
    expect(lifecycle).toBeNull();
    expect(transcriptRowTimestamp(message, chronology, true, false, false, lifecycle)).toBe('11:40');
    expect(transcriptRowTimestamp(message, chronology, true, true, true, lifecycle)).toBe('Aug 27, 11:40');
  });

  it('reveals a user prompt date and time only while its message owns the transcript cursor', () => {
    const message: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'fix chronology', timestamp: '2026-08-27T03:40:00Z' };
    expect(transcriptRowTimestamp(message, chronology, true, false, false, null)).toBeUndefined();
    expect(transcriptRowTimestamp(message, chronology, true, true, true, null)).toBe('Aug 27, 11:40');
  });

  it('keeps machine progress lifecycle metadata concise', () => {
    const message: WorkspaceMessage = { id: 'tool', role: 'tool', text: 'bash', state: 'streaming', timestamp: '2026-08-27T03:40:00Z' };
    const lifecycle = transcriptRowLifecycle(message);
    expect(lifecycle).toEqual({ label: 'running', symbol: '●' });
    expect(transcriptRowTimestamp(message, chronology, true, true, true, lifecycle)).toBeUndefined();
  });
});
