import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { appendConversationBoundary, compactEmptyConversationBoundaries } from './conversationBoundaries';

const row = (id: string, role: WorkspaceMessage['role']): WorkspaceMessage => ({ id, role, text: id });

describe('conversation reset boundaries', () => {
  it('never stacks divider-only reset segments at a completed tail', () => {
    const first = appendConversationBoundary([row('answer', 'assistant')], row('reset-1', 'boundary'));
    const repeated = appendConversationBoundary(first, row('reset-2', 'boundary'));
    expect(repeated.map(({ id }) => id)).toEqual(['answer', 'reset-1']);
  });

  it('retains a later reset after the new segment has visible content', () => {
    const messages = [row('answer-1', 'assistant'), row('reset-1', 'boundary'), row('prompt-2', 'user')];
    expect(appendConversationBoundary(messages, row('reset-2', 'boundary')).map(({ id }) => id)).toEqual(['answer-1', 'reset-1', 'prompt-2', 'reset-2']);
  });

  it('compacts boundary-only history while preserving content-separated order', () => {
    const compacted = compactEmptyConversationBoundaries([
      row('leading', 'boundary'), row('answer-1', 'assistant'), row('reset-1', 'boundary'),
      row('metadata', 'system'), row('reset-2', 'boundary'), row('prompt-2', 'user'), row('reset-3', 'boundary'),
    ]);
    expect(compacted.map(({ id }) => id)).toEqual(['answer-1', 'reset-1', 'metadata', 'prompt-2', 'reset-3']);
  });

  it('retains the semantic compaction marker without treating it as a reset divider', () => {
    const compacted = compactEmptyConversationBoundaries([
      { ...row('compaction', 'boundary'), text: '--- compaction ---' },
      row('reset', 'boundary'),
      row('answer', 'assistant'),
    ]);
    expect(compacted.map(({ id }) => id)).toEqual(['compaction', 'answer']);
  });
});
