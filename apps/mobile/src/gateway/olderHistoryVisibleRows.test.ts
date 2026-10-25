import { expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectTranscriptDisplayGroups } from '../transcript/transcriptDisplayProjection';
import { addedOlderVisibleRowCount } from './olderHistoryVisibleRows';

const tool = (id: string): WorkspaceMessage => ({ id, role: 'tool', text: `call ${id}\nresult ${id}`, source: 'history', sessionKey: 's' });

it('counts the actual display projection through a group that crosses the page boundary', () => {
  const before = [tool('10'), tool('11')];
  const old = [tool('8'), tool('9')];
  const previousProjectedMessages = projectTranscriptDisplayGroups(before);
  const context = { previousProjectedMessages };
  expect(addedOlderVisibleRowCount(before, [...old, ...before], context)).toBe(0);
  expect(addedOlderVisibleRowCount(before, [...old, ...before], {
    ...context, expandedMessageIDs: new Set([previousProjectedMessages[0]!.id]),
  })).toBe(2);
  expect(addedOlderVisibleRowCount(before, [
    { id: 'older-prose', role: 'assistant', text: 'Earlier explanation', source: 'history', sessionKey: 's' },
    ...old, ...before,
  ], context)).toBe(1);
});
