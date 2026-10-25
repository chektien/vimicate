import { expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptForwardReviewBoundary } from './transcriptForwardReviewBoundary';

it('keeps visible expanded tool members but can trim hidden members of a folded group', () => {
  const messages: WorkspaceMessage[] = [
    { id:'group',role:'tool',text:'2 calls',toolGroup:{count:2,lastMessageId:'last'} },
    { id:'first',role:'tool',text:'First visible detail' },
    { id:'last',role:'tool',text:'Last visible detail' },
  ];
  expect(transcriptForwardReviewBoundary(messages,0,new Set(['group']))).toBe('first');
  expect(transcriptForwardReviewBoundary(messages,0,new Set())).toBe('last');
  expect(transcriptForwardReviewBoundary(messages,1,new Set(['group']))).toBe('first');
  expect(transcriptForwardReviewBoundary(messages,undefined,new Set())).toBeUndefined();
});
