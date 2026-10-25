import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { mergeSharedNarration } from './sharedNarration';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { completedRunMessage, reconcileCompletedRunMessage } from './runCompletionMessage';
import { decorateGatewayMedia } from './gatewayMedia';

const sessionKey = 'agent:main:dashboard:qa';
const runId = 'vimicate-provider-owned';

function chat(text: string, state: 'delta' | 'final' = 'delta', run = runId) {
  const projected = projectGatewayEvent({ event: 'chat', payload: {
    sessionKey, runId: run, state, message: { role: 'assistant', content: [{ type: 'text', text }] },
  } }, sessionKey);
  if (!projected) throw new Error('chat frame did not project');
  return projected.message;
}

function preamble(text: string, itemId: string, run = runId) {
  const projected = projectGatewayEvent({ event: 'agent', payload: {
    sessionKey, runId: run, stream: 'item', data: { kind: 'preamble', phase: 'end', itemId, progressText: text },
  } }, sessionKey);
  if (!projected) throw new Error('preamble frame did not project');
  return projected.message;
}

function terminal(text: string) {
  const projected = projectGatewayEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'lifecycle', data: {
      phase: 'end', terminalReply: { disposition: 'visible', text },
    },
  } }, sessionKey);
  if (!projected) throw new Error('terminal receipt did not project');
  return projected.message;
}

describe('OpenClaw cumulative chat and item-preamble convergence', () => {
  it('replays the physical two-wait GLM sequence as one row per authored announcement plus its final', () => {
    const prompt: WorkspaceMessage = { id: 'accepted-prompt', role: 'user', text: 'bounded two-wait fixture',
      sessionKey, runId, source: 'history' };
    const steer: WorkspaceMessage = { id: 'accepted-steer', role: 'user', text: 'steer',
      sessionKey, runId, source: 'history' };
    let rows: WorkspaceMessage[] = [prompt];
    rows = upsertLiveMessage(rows, chat('QG_A'));
    rows = upsertLiveMessage(rows, preamble('QG_A', 'commentary-0-a'));
    expect(rows.filter(row => row.text === 'QG_A').map(row => row.role)).toEqual(['narration']);

    rows = [...rows, steer];
    rows = upsertLiveMessage(rows, chat('QG_A\n\nQG_B'));
    rows = upsertLiveMessage(rows, preamble('QG_B', 'commentary-0-b'));
    expect(rows.filter(row => row.text === 'QG_B').map(row => row.role)).toEqual(['narration']);
    expect(rows.filter(row => row.role === 'assistant')).toEqual([]);

    rows = upsertLiveMessage(rows, terminal('QG_FINAL'));
    rows = upsertLiveMessage(rows, chat('QG_A\n\nQG_B\n\nQG_FINAL', 'final'));
    expect(rows.filter(row => row.role === 'narration').map(row => row.text)).toEqual(['QG_A', 'QG_B']);
    expect(rows.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(['QG_FINAL']);
  });

  it('keeps distinct equal-text preamble items, a repeated final, and another run separate', () => {
    let rows: WorkspaceMessage[] = [];
    rows = upsertLiveMessage(rows, chat('Same'));
    rows = upsertLiveMessage(rows, preamble('Same', 'first'));
    rows = upsertLiveMessage(rows, chat('Same\n\nSame'));
    rows = upsertLiveMessage(rows, preamble('Same', 'second'));
    rows = upsertLiveMessage(rows, terminal('Same'));
    rows = upsertLiveMessage(rows, chat('Same\n\nSame\n\nSame', 'final'));
    rows = upsertLiveMessage(rows, chat('Same', 'final', 'another-run'));
    expect(rows.filter(row => row.runId === runId && row.role === 'narration')).toHaveLength(2);
    expect(rows.filter(row => row.runId === runId && row.role === 'assistant').map(row => row.text)).toEqual(['Same']);
    expect(rows.filter(row => row.runId === 'another-run' && row.role === 'assistant').map(row => row.text)).toEqual(['Same']);
  });

  it('preserves a noncumulative final identical to an earlier preamble, including late item arrival', () => {
    let rows = upsertLiveMessage([], preamble('Same', 'first'));
    rows = upsertLiveMessage(rows, chat('Same', 'final'));
    expect(rows.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(['Same']);

    let late = upsertLiveMessage([], chat('Same', 'final'));
    late = upsertLiveMessage(late, preamble('Same', 'first'));
    expect(late.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(['Same']);

    const multiline = 'Same paragraph\n\nSame conclusion';
    let many = upsertLiveMessage([], preamble(multiline, 'multiline'));
    many = upsertLiveMessage(many, chat(multiline, 'final'));
    expect(many.filter(row => row.role === 'assistant').map(row => row.text)).toEqual([multiline]);
    many = upsertLiveMessage(many, preamble(multiline, 'multiline'));
    expect(many.filter(row => row.role === 'assistant').map(row => row.text)).toEqual([multiline]);
  });

  it('recomputes from the raw envelope after a stripped row and preserves a later equal-text final', () => {
    let rows = upsertLiveMessage([], preamble('A', 'first'));
    rows = upsertLiveMessage(rows, chat('A\n\nB'));
    expect(rows.find(row => row.role === 'assistant')).toMatchObject({
      text: 'B', chatCumulativeText: 'A\n\nB', state: 'streaming',
    });
    rows = upsertLiveMessage(rows, preamble('B', 'second'));
    expect(rows.filter(row => row.role === 'assistant')).toEqual([]);
    rows = upsertLiveMessage(rows, terminal('B'));
    rows = upsertLiveMessage(rows, chat('A\n\nB\n\nB', 'final'));
    expect(rows.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(['B']);

    const reversed = upsertLiveMessage([preamble('First', 'prior')], chat('First'));
    expect(reversed.filter(row => row.role === 'assistant')).toEqual([]);
  });

  it('lets a late exact terminal receipt replace a completed aggregate and survive its done footer', () => {
    let rows = upsertLiveMessage([], preamble('Preamble', 'first'));
    rows = upsertLiveMessage(rows, chat('Preamble\n\nActual final', 'final'));
    expect(rows.find(row => row.role === 'assistant')?.text).toBe('Preamble\n\nActual final');
    rows = upsertLiveMessage(rows, terminal('Actual final'));
    expect(rows.find(row => row.role === 'assistant')?.text).toBe('Actual final');
    rows = reconcileCompletedRunMessage(rows, completedRunMessage(sessionKey, runId, 60_000));
    expect(rows.find(row => row.role === 'run')?.terminalReplyText).toBe('Actual final');
    rows = upsertLiveMessage(rows, chat('Preamble\n\nActual final', 'final'));
    expect(rows.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(['Actual final']);
  });

  it.each(['before', 'after'])('never restores a raw MEDIA directive from a %s lifecycle receipt', (order) => {
    const source = '/workspace/retained/sandbox-live-desktop-dark.png';
    const rawFinal = `Here is the image.\n\nMEDIA:${source}`;
    const frame = projectGatewayEvent({ event: 'chat', payload: {
      sessionKey, runId, state: 'final', message: { content: [
        { type: 'text', text: 'Here is the image.' },
        { type: 'image', artifactId: 'artifact_managed_image_fixture', url: '/api/chat/media/outgoing/one/image/full',
          alt: 'sandbox-live-desktop-dark.png', mimeType: 'image/png', width: 1280, height: 900, sizeBytes: 77164 },
      ] },
    } }, sessionKey)!.message;
    let rows = order === 'before' ? upsertLiveMessage([], chat('Here is the image.')) : [];
    if (order === 'before') {
      rows = upsertLiveMessage(rows, terminal(rawFinal));
      expect(rows.find(row => row.role === 'assistant')?.text).toBe('Here is the image.');
    }
    rows = upsertLiveMessage(rows, frame);
    if (order === 'after') rows = upsertLiveMessage(rows, terminal(rawFinal));
    const answer = rows.find(row => row.role === 'assistant')!;
    expect(answer.text).toBe('Here is the image.');
    expect(answer.attachments).toHaveLength(1);
    expect(answer.attachments![0]).toMatchObject({
      artifactId: 'artifact_managed_image_fixture', uri: '/api/chat/media/outgoing/one/image/full',
      filename: 'sandbox-live-desktop-dark.png', pixelWidth: 1280, pixelHeight: 900, byteCount: 77164,
    });
    const decorated = decorateGatewayMedia([answer], 'wss://gateway.example/socket', 'paired-test-credential', sessionKey)[0]!;
    expect(decorated.attachments![0]).toMatchObject({
      uri: 'https://gateway.example/api/chat/media/outgoing/one/image/full',
      headers: { Authorization: 'Bearer paired-test-credential', 'x-openclaw-requester-session-key': sessionKey },
    });
    rows = reconcileCompletedRunMessage(rows, completedRunMessage(sessionKey, runId, 1000));
    rows = upsertLiveMessage(rows, frame);
    expect(rows.find(row => row.role === 'assistant')?.text).toBe('Here is the image.');
  });

  it('preserves attachment-only assistants and media when preamble prose is absorbed', () => {
    const media = [{ id: 'image-1', filename: 'image.png', mimeType: 'image/png', uri: 'https://example.test/image.png' }];
    const attachmentOnly: WorkspaceMessage = { id: 'media-only', role: 'assistant', text: '', attachments: media,
      source: 'live', sessionKey, runId };
    expect(upsertLiveMessage([], attachmentOnly)).toEqual([attachmentOnly]);
    let rows = upsertLiveMessage([], { ...chat('Progress'), attachments: media });
    rows = upsertLiveMessage(rows, preamble('Progress', 'item'));
    expect(rows.find(row => row.role === 'assistant')).toMatchObject({ text: '', attachments: media });

    rows = upsertLiveMessage(rows, chat('Progress'));
    expect(rows.find(row => row.role === 'assistant')?.attachments).toEqual(media);
  });

  it('retains a richer raw envelope through late shorter frames and later item convergence', () => {
    let rows = upsertLiveMessage([], preamble('A', 'first'));
    rows = upsertLiveMessage(rows, chat('A\n\nB\n\nC'));
    rows = upsertLiveMessage(rows, chat('A\n\nB'));
    expect(rows.find(row => row.role === 'assistant')).toMatchObject({
      text: 'B\n\nC', chatCumulativeText: 'A\n\nB\n\nC',
    });
    rows = upsertLiveMessage(rows, preamble('B', 'second'));
    expect(rows.find(row => row.role === 'assistant')?.text).toBe('C');

    rows = upsertLiveMessage(rows, chat('A\n\nB'));
    expect(rows.find(row => row.role === 'assistant')?.text).toBe('C');
  });

  it('does not borrow a terminal reply from a different concrete generation', () => {
    const first = '00000000-0000-4000-8000-000000000130';
    const second = '00000000-0000-4000-8000-000000000118';
    const ended = { ...terminal('Wrong final'), transcriptSessionId: second };
    const aggregate = { ...chat('Preamble\n\nRight final', 'final'), transcriptSessionId: first };
    const rows = upsertLiveMessage([ended], aggregate);
    expect(rows.find(row => row.role === 'assistant')?.text).toBe('Preamble\n\nRight final');
  });

  it('does not consume fuzzy prefixes, other runs, or the intervening tool and steer rows', () => {
    let rows = upsertLiveMessage([], preamble('Progress', 'first'));
    rows = upsertLiveMessage(rows, chat('Progressive final', 'final'));
    rows = upsertLiveMessage(rows, chat('Progress', 'delta', 'other-run'));
    const tool: WorkspaceMessage = { id: 'tool-owned', role: 'tool', text: 'exec · done', source: 'live',
      sessionKey, runId };
    const steer: WorkspaceMessage = { id: 'steer-owned', role: 'user', text: 'Keep going', source: 'history',
      sessionKey, runId };
    rows = upsertLiveMessage([...rows, tool, steer], terminal('Actual answer'));
    rows = upsertLiveMessage(rows, chat('Progress\n\nActual answer', 'final'));
    expect(rows.find(row => row.id === `live-chat-${runId}`)?.text).toBe('Actual answer');
    expect(rows.find(row => row.id === 'live-chat-other-run')?.text).toBe('Progress');
    expect(rows.find(row => row.id === 'tool-owned')).toBe(tool);
    expect(rows.find(row => row.id === 'steer-owned')).toBe(steer);
  });

  it('keeps canonical item identity after refresh and rejects a late cumulative replay', () => {
    const sessionId = '00000000-0000-4000-8000-000000000130';
    const canonical = messagesFromPayload({ sessionKey, sessionId, messages: [
      { role: 'user', content: 'bounded two-wait fixture', timestamp: 1_790_434_867_196,
        __openclaw: { id: 'prompt', runId } },
      { role: 'assistant', content: [{ type: 'text', text: 'QG_A' }], timestamp: 1_790_434_869_272,
        openclawStreamFallback: { source: 'segment', itemId: 'commentary-0-a', replacementText: 'QG_A' },
        __openclaw: { id: 'native-a', runId } },
      { role: 'assistant', content: [{ type: 'text', text: 'QG_FINAL' }], timestamp: 1_790_434_936_406,
        __openclaw: { id: 'native-final', runId } },
    ] });
    let rows: WorkspaceMessage[] = [];
    rows = upsertLiveMessage(rows, chat('QG_A'));
    rows = upsertLiveMessage(rows, preamble('QG_A', 'commentary-0-a'));
    rows = upsertLiveMessage(rows, terminal('QG_FINAL'));
    rows = upsertLiveMessage(rows, chat('QG_A\n\nQG_FINAL', 'final'));
    rows = mergeLatestHistory(canonical, rows, sessionKey);
    rows = mergeSharedNarration(rows, [{ id: `live-item-${runId}-commentary-0-a`, role: 'narration',
      source: 'history', sessionKey, transcriptSessionId: sessionId, narrationItemId: 'commentary-0-a',
      runId, text: 'QG_A', timestamp: '1790434869272' }]);
    rows = upsertLiveMessage(rows, chat('QG_A\n\nQG_FINAL', 'final'));
    expect(rows.filter(row => row.text === 'QG_A').map(row => row.role)).toEqual(['narration']);
    expect(rows.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(['QG_FINAL']);
  });
});
