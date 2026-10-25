import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { convergedLiveMessage } from './liveMessageConvergence';

const row = (text: string, state: WorkspaceMessage['state'] = 'streaming'): WorkspaceMessage => ({ id: 'live-chat-r1', role: 'assistant', text, state, source: 'live', runId: 'r1' });

describe('cumulative assistant convergence', () => {
  it('does not let a delayed shorter prefix shrink the visible response', () => {
    expect(convergedLiveMessage(row('one two three'), row('one two')).text).toBe('one two three');
  });

  it('allows non-prefix edits and terminal authority', () => {
    expect(convergedLiveMessage(row('draft alpha'), row('final beta')).text).toBe('final beta');
    expect(convergedLiveMessage(row('long draft'), row('short', 'complete'))).toMatchObject({ text: 'short', state: 'complete' });
  });

  it('replaces explicit ImageGen snapshots instead of accumulating obsolete attempts', () => {
    const first = { ...row('creating'), attachments: [{ id: 'attempt-1', filename: 'first.png', mimeType: 'image/png', uri: 'https://example.test/first.png' }] };
    const second = { ...row('creating'), attachments: [{ id: 'attempt-2', filename: 'second.png', mimeType: 'image/png', uri: 'https://example.test/second.png' }] };
    expect(convergedLiveMessage(first, second).attachments).toEqual(second.attachments);

    const textOnly = row('creating a better version');
    expect(convergedLiveMessage(second, textOnly).attachments).toEqual(second.attachments);

    const terminalWithoutMedia = row('No image was accepted.', 'complete');
    expect(convergedLiveMessage(second, terminalWithoutMedia).attachments).toBeUndefined();
  });
});

describe('durable live-detail convergence', () => {
  it('does not let a late untimestamped narration frame erase its hydrated source coordinate', () => {
    const hydrated: WorkspaceMessage = {
      id: 'live-item-r1-pre', role: 'narration', text: 'checking', timestamp: '300000',
      runId: 'r1', sessionKey: 'one', source: 'history',
    };
    const late: WorkspaceMessage = {
      id: hydrated.id, role: 'narration', text: 'checking', state: 'streaming',
      runId: 'r1', sessionKey: 'one', source: 'live',
    };

    expect(convergedLiveMessage(hydrated, late)).toMatchObject({
      timestamp: '300000', source: 'history', state: 'streaming',
    });
  });
});
