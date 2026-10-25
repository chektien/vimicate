import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent } from './gatewayEventProjection';
import { latestHistoryWindow } from './historyWindow';

describe('delivery final projection', () => {
  it('keeps the prose final after a structured delivery result across live and canonical convergence', () => {
    const sessionKey = 'agent:main:notes:standup';
    const runId = 'delivery-run';
    const toolCallId = 'delivery-call';
    const deliveryId = '1480855314935844997';
    const finalText = 'Posted to #hmd. Message id: 1514813591587393749.';
    const canonical = messagesFromPayload({
      sessionKey,
      messages: [
        { id: 'prompt', role: 'user', runId, timestamp: 1_000, content: 'post to my team' },
        { id: 'call', role: 'assistant', runId, timestamp: 2_000, content: [{
          type: 'toolCall', id: toolCallId, name: 'message', arguments: { action: 'send', channel: '#hmd' },
        }] },
        { id: 'result', role: 'toolResult', runId, timestamp: 3_000, content: [{
          type: 'toolResult', toolCallId, name: 'message', text: JSON.stringify({ guild_id: deliveryId }),
        }] },
        { id: 'final', role: 'assistant', runId, timestamp: 4_000, content: finalText },
      ],
    });

    expect(canonical.map(({ role }) => role)).toEqual(['user', 'tool', 'tool', 'assistant']);
    expect(canonical[2]).toMatchObject({ role: 'tool', tool: { name: 'message', summary: 'message · send' } });
    expect(canonical.at(-1)).toMatchObject({ id: 'final', role: 'assistant', text: finalText });

    const liveTool = projectGatewayEvent({
      event: 'agent',
      payload: {
        sessionKey, runId, stream: 'tool',
        data: { toolCallId, name: 'message', phase: 'result', result: { guild_id: deliveryId } },
      },
    }, sessionKey)!.message;
    const liveFinal = projectGatewayEvent({
      event: 'chat', payload: { sessionKey, runId, state: 'final', message: { content: finalText } },
    }, sessionKey)!.message;
    const completion: WorkspaceMessage = {
      id: `live-run-${runId}`, role: 'run', text: '✓ done in 2s', state: 'complete',
      source: 'live', sessionKey, runId,
    };

    expect(liveFinal).toMatchObject({ role: 'assistant', text: finalText, state: 'complete' });
    expect(projectGatewayEvent({
      event: 'chat', payload: { sessionKey, runId: 'bare-id', state: 'final', message: { content: deliveryId } },
    }, sessionKey)).toBeNull();

    const converged = latestHistoryWindow(canonical, [canonical[0]!, liveTool, liveFinal, completion], sessionKey);
    expect(converged.filter(({ role }) => role === 'assistant').map(({ text }) => text)).toEqual([finalText]);
    expect(converged.at(-2)).toMatchObject({ role: 'assistant', text: finalText });
    expect(converged.at(-1)).toMatchObject({ role: 'run', state: 'complete' });
  });
});
