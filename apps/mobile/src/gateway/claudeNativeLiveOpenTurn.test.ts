import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { claudeNativeLiveDiagnosis } from './claudeNativeLiveConvergence';

const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'run-claude';
const steps = ['Two parts: move resets into their own section.', 'Resolving merge conflicts first.', 'Base is clean (18/18 tests).'];

const native = (id: string, role: 'user' | 'assistant', text: string, timestamp: number, tool = role === 'assistant') => ({
  role, timestamp, content: role === 'user' ? text : [{ type: 'text', text }, ...(tool ? [{ type: 'toolcall', id: `tool-${id}`, name: 'Bash', arguments: {} }] : [])],
  ...(role === 'assistant' ? { stopReason: tool ? 'tool_use' : 'end_turn' } : {}),
  __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id },
});
// The prompt is native only (a queued input Claude took later), so it has no
// Gateway position: the matcher bounds the turn by the native prompt alone.
function history(answered = false) {
  return messagesFromPayload({ sessionKey, sessionId, messages: [
    native('earlier', 'user', 'Earlier task.', 1000), native('earlier-answer', 'assistant', 'Earlier answer.', 1100, false),
    native('prompt', 'user', 'Move password resets.', 2000),
    ...steps.map((text, index) => native(`step-${index}`, 'assistant', text, 2100 + index * 100)),
    ...(answered ? [native('answer', 'assistant', 'All done.', 2500, false)] : []),
  ] });
}
function frame(text: string, timestamp?: number) {
  return projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state: 'delta',
    message: { role: 'assistant', content: text, ...(timestamp ? { timestamp } : {}) } } }, sessionKey)!.message;
}
const liveRow = (rows: WorkspaceMessage[]) => rows.find(row => row.id === `live-chat-${runId}`);

describe('Claude native commentary in an open turn', () => {
  // Physical example-project (6 Oct): saved commentary rows were already shown and
  // the live copy repeated all of them below. A reconnect stamped the copy with
  // the current time, past the last saved row, and frames after a history
  // refresh arrived untimed. Neither copy was retired.
  for (const [label, stamp] of [['stamped after a reconnect', 2300 + 60_000], ['untimed', undefined]] as const) {
    it(`retires a ${label} streaming copy that the saved commentary covers`, () => {
      const rows = history();
      const covered = frame(steps.join('\n\n'), stamp);
      expect(claudeNativeLiveDiagnosis([...rows, covered], covered)).toBe('match');
      expect(liveRow(upsertLiveMessage(rows, covered))).toBeUndefined();
      const longer = upsertLiveMessage(rows, frame([...steps, 'Creating the billing worktree.'].join('\n\n'), stamp));
      expect(liveRow(longer)?.text).toBe('Creating the billing worktree.');
      expect(longer.at(-1)).toBe(liveRow(longer));
    });
  }

  it('keeps a new turn\'s copy when only an answered earlier turn shares its first commentary', () => {
    const rows = history(true);
    for (const stamp of [undefined, 2500 + 60_000]) {
      const live = frame([steps[0], 'Something new this turn.'].join('\n\n'), stamp);
      expect(claudeNativeLiveDiagnosis([...rows, live], live)).not.toBe('match');
      expect(liveRow(upsertLiveMessage(rows, live))?.text).toBe(live.text);
    }
  });
});
