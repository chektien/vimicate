import { describe, expect, it } from 'vitest';
import { ChatStreamAccumulator, mergeChatStreamMessage } from './chatStreamAccumulator';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const sessionKey = 'agent:main:direct:fixture';
const chat = (payload: Record<string, unknown>) => ({ type: 'event', event: 'chat', payload: { sessionKey, runId: 'run-1', ...payload } });

describe('OpenClaw 9.8 chat deltaText streams', () => {
  it('matches the gateway client merge rules', () => {
    const base = { role: 'assistant', content: [{ type: 'text', text: 'Both of' }] };
    expect(mergeChatStreamMessage(undefined, { message: base })).toBe(base);
    expect(mergeChatStreamMessage(base, { deltaText: ' your messages' })).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Both of your messages' }] });
    expect(mergeChatStreamMessage(base, { deltaText: '' })).toBe(base);
    expect(mergeChatStreamMessage(base, { deltaText: 'Rewritten', replace: true })).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Rewritten' }] });
    expect(mergeChatStreamMessage(undefined, { deltaText: 'orphan' })).toBeUndefined();
    expect(mergeChatStreamMessage({ role: 'assistant', content: 'plain' }, { deltaText: ' text' })).toEqual({ role: 'assistant', content: 'plain text' });
  });

  // Recorded live from a claude-cli turn on 6 Oct: one snapshot, then deltaText only.
  it('keeps the live row growing past the first words, then forgets the run at final', () => {
    const streams = new ChatStreamAccumulator();
    const frames = [
      chat({ state: 'delta', deltaText: "I'll check the current", message: { role: 'assistant', content: [{ type: 'text', text: "I'll check the current" }] } }),
      chat({ state: 'delta', deltaText: ' date on this machine.' }),
      chat({ state: 'delta', deltaText: '\n\nThe `date` command shows it is 14:41 S' }),
      chat({ state: 'delta', deltaText: 'GT (UTC+8).' }),
    ];
    let rows: WorkspaceMessage[] = [];
    for (const frame of frames) {
      const projected = projectGatewayEvent(streams.normalize(frame), sessionKey);
      if (projected) rows = upsertLiveMessage(rows, projected.message);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'live-chat-run-1', state: 'streaming',
      text: "I'll check the current date on this machine.\n\nThe `date` command shows it is 14:41 SGT (UTC+8)." });
    streams.normalize(chat({ state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }));
    expect(streams.normalize(chat({ state: 'delta', deltaText: ' stray' }))).toEqual(chat({ state: 'delta', deltaText: ' stray' }));
  });

  it('never appends to a baseline from before a dropped connection', () => {
    const streams = new ChatStreamAccumulator();
    streams.normalize(chat({ state: 'delta', message: { role: 'assistant', content: 'Before' } }));
    streams.clear();
    const after = chat({ state: 'delta', deltaText: ' after' });
    expect(streams.normalize(after)).toEqual(after);
    expect(projectGatewayEvent(streams.normalize(after), sessionKey)).toBeNull();
  });
});
