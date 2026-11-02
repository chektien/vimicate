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

const narration = (text: string): WorkspaceMessage => ({
  id: 'live-item-r1-pre', role: 'narration', text, runId: 'r1',
  sessionKey: 'agent/item/preamble', source: 'live', state: 'streaming',
});

it.each(['live', 'history'] as const)('retains cumulative narration bytes when a late live prefix follows %s', source => {
  const longer = { ...narration('Yes. All three threads are complete.'), source, timestamp: '300000',
    transcriptSessionId: 'generation-1', narrationItemId: 'pre' };
  expect(convergedLiveMessage(longer, narration('Yes. All three threads'))).toMatchObject({
    text: longer.text, source, timestamp: longer.timestamp, state: 'streaming',
    transcriptSessionId: 'generation-1', narrationItemId: 'pre',
  });
});

it.each([{ runId: 'r2' }, { sessionKey: 'other' }, { transcriptSessionId: 'generation-2' }, { narrationItemId: 'other' }])(
  'does not borrow cumulative narration bytes across conflicting ownership %j', conflict => {
    const previous = { ...narration('Yes. All three threads are complete.'), transcriptSessionId: 'generation-1', narrationItemId: 'pre' };
    const incoming = { ...narration('Yes.'), ...conflict };
    expect(convergedLiveMessage(previous, incoming).text).toBe(incoming.text);
  },
);

it('accepts a non-prefix narration correction rather than selecting by length', () => {
  expect(convergedLiveMessage(narration('long preliminary statement'), narration('Corrected.')).text).toBe('Corrected.');
});

it('retains durable narration first-time authority when a delayed live prefix has a later timestamp', () => {
  const durable = { ...narration('Yes. All three threads are complete.'), source: 'history' as const,
    transcriptSessionId: 'g', narrationItemId: 'pre', timestamp: '100' };
  const live = { ...narration('Yes. All three threads'), timestamp: '200' };
  expect(convergedLiveMessage(durable, live)).toMatchObject({
    text: durable.text, source: 'history', timestamp: '100', state: 'streaming',
  });
});
