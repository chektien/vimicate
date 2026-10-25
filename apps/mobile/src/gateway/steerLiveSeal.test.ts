import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { sealLiveChatForSteer } from './steerLiveSeal';

const sessionKey = 'agent:main:direct:vimicate-ios:project:example-cloud';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'run-claude';
const source = 'fixture-source';
const steps = [
  "I'll start by collecting the three worker results.",
  'Collected all three worker results.',
  'Reviewing the three diffs now. Backend review is clean so far.',
  'Reviews done. Merging into one release branch.',
];

function frame(text: string, state: 'delta' | 'final' = 'delta') {
  return projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state, message: { content: text } } }, sessionKey)!.message;
}
function prompt(id: string, text: string, timestamp: number): WorkspaceMessage {
  return { id: `local-${id}`, role: 'user', text, source: 'local', sessionKey, runId, idempotencyKey: id, inputReceiptRunId: id, timestamp: String(timestamp) };
}
const shown = (rows: WorkspaceMessage[]) => rows.filter(row => row.text).map(row => `${row.role}:${row.text}`);

describe('Claude CLI steering seals live text above the steered prompt', () => {
  // Physical example-cloud turn (6 Oct): five steered prompts, and the whole turn's
  // commentary showed as one block below the newest prompt.
  it('keeps commentary between steered prompts from the live copy to the saved history', () => {
    let rows: WorkspaceMessage[] = [{ id: 'origin', role: 'user', text: 'ok so I can test sandbox?', source: 'local', sessionKey, runId, idempotencyKey: 'origin', timestamp: '1000' }];
    rows = upsertLiveMessage(rows, frame(steps.slice(0, 2).join('\n\n')));
    rows = sealLiveChatForSteer(rows, prompt('s1', 'not important but may reveal more', 2500), runId);
    rows = upsertLiveMessage(rows, frame(`${steps.slice(0, 2).join('\n\n')}\n\nReviewing the three diffs now. Backend rev`));
    rows = sealLiveChatForSteer(rows, prompt('s2', 'the password reset should be separate', 3500), runId);
    const full = steps.join('\n\n');
    rows = upsertLiveMessage(rows, frame(full));
    expect(shown(rows)).toEqual([
      'user:ok so I can test sandbox?',
      `narration:${steps.slice(0, 2).join('\n\n')}`,
      'user:not important but may reveal more',
      'narration:Reviewing the three diffs now. Backend rev',
      'user:the password reset should be separate',
      'assistant:iew is clean so far.\n\nReviews done. Merging into one release branch.',
    ]);

    // The final frame stays cropped, and a cold restore keeps the split.
    rows = upsertLiveMessage(rows, frame(full, 'final'));
    expect(shown(rows).at(-1)).toBe('assistant:iew is clean so far.\n\nReviews done. Merging into one release branch.');
    const restored = parsedTranscriptCache(serializedTranscriptCache(rows));
    expect(restored.filter(row => row.steerSealed)).toHaveLength(2);
    expect(shown(upsertLiveMessage(restored, frame(full, 'final'))).at(-1)).toBe(shown(rows).at(-1));

    // Turn end: lifecycle adds the run footer, then native history replaces
    // the seals and the live copy. Each steered prompt keeps its send position.
    rows = [...rows, { id: `live-run-${runId}`, role: 'run', text: '✓ done in 4m 1s', source: 'live', sessionKey, runId, state: 'complete' }];
    const native = (id: string, text: string, timestamp: number, tool: boolean) => ({ role: 'assistant', timestamp,
      content: [{ type: 'text', text }, ...(tool ? [{ type: 'toolcall', id: `tool-${id}`, name: 'Bash', arguments: {} }] : [])],
      stopReason: tool ? 'tool_use' : 'end_turn', __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id } });
    const positioned = (id: string, content: string, timestamp: number, rawSeq: number) => ({ role: 'user', content, timestamp,
      idempotencyKey: `${id}:user`, __openclaw: { id, idempotencyKey: `${id}:user`, transcriptPosition: { source, rawSeq } } });
    const canonical = messagesFromPayload({ sessionKey, sessionId, messages: [
      positioned('origin', 'ok so I can test sandbox?', 1000, 10),
      native('earlier', 'Earlier answer.', 1400, false),
      native('step-0', steps[0]!, 2000, true), native('step-1', steps[1]!, 2200, true),
      positioned('s1', 'not important but may reveal more', 2500, 11),
      native('step-2', steps[2]!, 3000, true),
      positioned('s2', 'the password reset should be separate', 3500, 12),
      native('answer', steps[3]!, 5000, false),
    ] });
    const settled = mergeLatestHistory(canonical, rows, sessionKey);
    expect(settled.some(row => row.steerSealed || row.id === `live-chat-${runId}`)).toBe(false);
    expect(settled.filter(row => row.role !== 'tool').map(row => row.id)).toEqual([
      'origin', 'earlier', 'step-0', 'step-1', 's1', 'step-2', 's2', 'answer', `live-run-${runId}`]);
  });

  it('seals the same way for a steered image prompt', () => {
    // Claude CLI steers carry images since the 9.8 image steering patch (cb4a09b).
    const image = { ...prompt('img', 'what colour is this?', 2500), attachments: [{ id: 'red', filename: 'red.png', mimeType: 'image/png' }] };
    const rows = sealLiveChatForSteer(upsertLiveMessage([], frame('Running the command.')), image, runId);
    expect(rows.map(row => `${row.role}:${row.text}`)).toEqual(['narration:Running the command.', 'user:what colour is this?', 'assistant:']);
    expect(rows[1]!.attachments).toHaveLength(1);
  });

  it('only seals an existing live copy and moves an empty continuation below the new prompt', () => {
    const steer = prompt('s', 'steer', 2000);
    expect(sealLiveChatForSteer([], steer, runId)).toEqual([steer]);
    const empty = { ...frame('x'), text: '' };
    const rows = sealLiveChatForSteer([empty], steer, runId);
    expect(rows.map(row => row.id)).toEqual([steer.id, empty.id]);
    expect(rows.some(row => row.steerSealed)).toBe(false);
  });
});
