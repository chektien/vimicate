import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectRegisteredGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { flushBufferedLiveMessages, LiveMessagePublicationBuffer } from './liveMessagePublication';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { sealLiveChatForSteer } from './steerLiveSeal';
import { ToolBoundaryChatTexts } from './toolBoundaryLiveSeal';

const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'run-claude';
const source = 'fixture-source';
const at = (offset: number) => 1_794_304_000_000 + offset;
const one = 'Checking the live path.';
const two = 'Found the gap. Reading the docs next.';
const answer = 'Both answers are below.';

/** One mounted thread: wire frames pass the registered projection and the publication buffer. */
function thread(agentRuntime = 'claude-cli') {
  const buffer = new LiveMessagePublicationBuffer();
  let rows: WorkspaceMessage[] = [{ id: 'local-first', role: 'user', text: 'Start.', source: 'local', sessionKey, runId, idempotencyKey: 'first', timestamp: String(at(1000)) }];
  const receive = (event: string, payload: Record<string, unknown>) => {
    const projected = projectRegisteredGatewayEvent({ event, payload: { sessionKey, runId, ...payload } }, [{ sessionKey, path: '', agentRuntime }]);
    if (projected) buffer.enqueue(projected.message);
  };
  return {
    chat: (text: string, state: 'delta' | 'final' = 'delta') => receive('chat', { state, message: { content: text } }),
    tool: (id: string, ts: number, phase: 'start' | 'result' = 'start') => receive('agent', { stream: 'tool', ts: at(ts), data: { phase, name: 'exec', toolCallId: id, ...(phase === 'result' ? { result: {} } : {}) } }),
    publish: () => { flushBufferedLiveMessages(buffer, (_key, action) => { rows = action(rows); }); return rows; },
    update: (action: (current: WorkspaceMessage[]) => WorkspaceMessage[]) => { rows = action(rows); return rows; },
    rows: () => rows,
  };
}
const label = (row: WorkspaceMessage) => row.role === 'tool' ? row.id.replace(`live-tool-${runId}-`, 'tool ') : `${row.role}:${row.text}`;
const shown = (rows: WorkspaceMessage[]) => rows.filter(row => row.role === 'tool' || row.text).map(label);

describe('Claude CLI live text before a tool call is sealed as commentary', () => {
  it('seals each commentary above its tool and leaves only the final answer as the reply', () => {
    const live = thread();
    live.chat(one); live.publish();
    expect(shown(live.rows())).toEqual(['user:Start.', `assistant:${one}`]);
    live.tool('t0', 1100); live.publish();
    expect(shown(live.rows())).toEqual(['user:Start.', `narration:${one}`, 'tool t0']);
    live.tool('t0', 1150, 'result'); live.tool('t1', 1200); live.publish();
    live.chat(`${one}\n\n${two.slice(0, 14)}`); live.publish();
    live.chat(`${one}\n\n${two}`); live.publish();
    expect(shown(live.rows())).toEqual(['user:Start.', `narration:${one}`, 'tool t0', 'tool t1', `assistant:${two}`]);
    live.tool('t2', 1300); live.publish();
    live.chat(`${one}\n\n${two}\n\n${answer}`); live.publish();
    live.chat(`${one}\n\n${two}\n\n${answer}`, 'final');
    const rows = live.publish();
    expect(shown(rows)).toEqual(['user:Start.', `narration:${one}`, 'tool t0', 'tool t1', `narration:${two}`, 'tool t2', `assistant:${answer}`]);
    expect(rows.filter(row => row.role === 'narration').every(row => row.steerSealed && row.state === 'complete')).toBe(true);
    expect(rows.at(-1)).toMatchObject({ role: 'assistant', state: 'complete' });
    expect(rows.some(row => 'toolBoundaryChatText' in row)).toBe(false);
    // A cold restore keeps the seals and still crops a replayed final frame.
    const restored = parsedTranscriptCache(serializedTranscriptCache(rows));
    expect(restored.filter(row => row.steerSealed)).toHaveLength(2);
    expect(shown(restored)).toEqual(shown(rows));
  });

  it('seals only the text the wire showed before the tool, when later text reaches the same publication', () => {
    const live = thread();
    live.chat(one); live.tool('t0', 1100); live.chat(`${one}\n\n${answer}`);
    expect(shown(live.publish())).toEqual(['user:Start.', `narration:${one}`, 'tool t0', `assistant:${answer}`]);
    // Tools started together share one boundary: the second seals nothing new.
    live.tool('t1', 1200); live.tool('t2', 1210);
    expect(shown(live.publish())).toEqual(['user:Start.', `narration:${one}`, 'tool t0', `narration:${answer}`, 'tool t1', 'tool t2']);
  });

  // Audit (11 Nov): the wire memory took a delayed shorter frame at face value
  // while the published copy kept the longer text, so the two disagreed about
  // what had arrived before the tool.
  it('does not let a delayed shorter frame take back text that arrived before the tool', () => {
    for (const batched of [true, false]) {
      const live = thread();
      live.chat(`${one}\n\n${two}`); if (!batched) live.publish();
      live.chat(one); if (!batched) live.publish();
      live.tool('t0', 1100);
      expect(shown(live.publish())).toEqual(['user:Start.', `narration:${one}\n\n${two}`, 'tool t0']);
    }
  });

  it('leaves other runtimes and their live text untouched', () => {
    const live = thread('codex');
    live.chat(one); live.publish(); live.tool('t0', 1100);
    const rows = live.publish();
    expect(shown(rows)).toEqual(['user:Start.', `assistant:${one}`, 'tool t0']);
    expect(rows.some(row => row.steerSealed || 'toolBoundaryChatText' in row)).toBe(false);
  });

  it('keeps a steer seal and a tool seal in send order through a prompts-only refresh', () => {
    const live = thread();
    live.chat(one); live.publish(); live.tool('t0', 1100); live.publish();
    live.chat(`${one}\n\nReading the`); live.publish();
    live.update(current => sealLiveChatForSteer(current, { id: 'local-steer', role: 'user', text: 'Also check quotas.', source: 'local', sessionKey, runId, idempotencyKey: 'steer', timestamp: String(at(1500)) }, runId));
    live.chat(`${one}\n\nReading the docs.`); live.publish();
    live.tool('t1', 1600);
    const expected = ['user:Start.', `narration:${one}`, 'tool t0', 'narration:Reading the', 'user:Also check quotas.', 'narration: docs.', 'tool t1'];
    expect(shown(live.publish())).toEqual(expected);
    const positioned = (id: string, content: string, timestamp: number, rawSeq: number) => ({ role: 'user', content, timestamp: at(timestamp),
      idempotencyKey: `${id}:user`, __openclaw: { id, idempotencyKey: `${id}:user`, transcriptPosition: { source, rawSeq } } });
    const merged = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [
      positioned('first', 'Start.', 1000, 10), positioned('steer', 'Also check quotas.', 1500, 11)] }), live.rows(), sessionKey);
    expect(shown(merged)).toEqual(expected);
  });
});

describe('saved Claude history retires tool seals as it covers them', () => {
  const native = (id: string, text: string, timestamp: number, tool: boolean) => ({ role: 'assistant', timestamp: at(timestamp),
    content: [{ type: 'text', text }, ...(tool ? [{ type: 'toolcall', id: `tool-${id}`, name: 'Bash', arguments: {} }] : [])],
    stopReason: tool ? 'tool_use' : 'end_turn', __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id } });
  const prompt = { role: 'user', content: 'Start.', timestamp: at(1000), idempotencyKey: 'first:user',
    __openclaw: { id: 'first', idempotencyKey: 'first:user', transcriptPosition: { source, rawSeq: 10 } } };

  it('keeps a seal the saved steps do not reach yet, and retires every seal at the end of the turn', () => {
    const live = thread();
    live.chat(one); live.publish(); live.tool('t0', 1100); live.publish();
    live.chat(`${one}\n\n${two}`); live.publish(); live.tool('t1', 1300); live.publish();
    expect(shown(live.rows())).toEqual(['user:Start.', `narration:${one}`, 'tool t0', `narration:${two}`, 'tool t1']);

    // Mid-turn page: saved history holds the first step only.
    const partial = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [prompt, native('step-0', one, 1050, true)] }), live.rows(), sessionKey);
    live.update(() => partial);
    expect(partial.filter(row => row.steerSealed).map(row => row.text)).toEqual([two]);
    expect(partial.filter(row => row.role === 'narration').map(row => row.text)).toEqual([one, two]);
    live.chat(`${one}\n\n${two}\n\n${answer}`);
    const streaming = live.publish();
    expect(streaming.filter(row => row.role === 'narration').map(row => row.text)).toEqual([one, two]);
    expect(streaming.filter(row => row.role === 'assistant' && row.source === 'live').map(row => row.text)).toEqual([answer]);

    // Turn end: the final frame, the footer, then the complete saved turn.
    live.chat(`${one}\n\n${two}\n\n${answer}`, 'final'); live.publish();
    live.update(current => [...current, { id: `live-run-${runId}`, role: 'run', text: '✓ done in 1m', source: 'live', sessionKey, runId, state: 'complete' }]);
    const settled = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [
      prompt, native('step-0', one, 1050, true), native('step-1', two, 1250, true), native('answer', answer, 1400, false)] }), live.rows(), sessionKey);
    expect(settled.some(row => row.steerSealed || row.id === `live-chat-${runId}`)).toBe(false);
    expect(settled.filter(row => row.role !== 'tool').map(row => row.id)).toEqual(['first', 'step-0', 'step-1', 'answer', `live-run-${runId}`]);
  });
});

describe('seals keep working after saved history retires earlier ones', () => {
  const native = (id: string, text: string, timestamp: number) => ({ role: 'assistant', timestamp: at(timestamp),
    content: [{ type: 'text', text }, { type: 'toolcall', id: `tool-${id}`, name: 'Bash', arguments: {} }],
    stopReason: 'tool_use', __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id } });
  const prompt = { role: 'user', content: 'Start.', timestamp: at(1000), idempotencyKey: 'first:user',
    __openclaw: { id: 'first', idempotencyKey: 'first:user', transcriptPosition: { source, rawSeq: 10 } } };
  const three = 'Docs read. Comparing the routes.';

  // Independent review (10 Nov): a count of surviving seals reused an ID once
  // an earlier seal was retired, and the new seal replaced the survivor.
  it('names each seal after its tool, so a later seal never replaces a surviving one', () => {
    const live = thread();
    live.chat(one); live.publish(); live.tool('t0', 1100); live.publish();
    live.chat(`${one}\n\n${two}`); live.publish(); live.tool('t1', 1300); live.publish();
    live.update(current => mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [prompt, native('step-0', one, 1050)] }), current, sessionKey));
    live.chat(`${one}\n\n${two}\n\n${three}`); live.publish(); live.tool('t2', 1500);
    const rows = live.publish();
    expect(rows.filter(row => row.steerSealed).map(row => row.text)).toEqual([two, three]);
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    live.chat(`${one}\n\n${two}\n\n${three}\n\n${answer}`);
    const next = live.publish();
    expect(next.filter(row => row.role === 'narration').map(row => row.text)).toEqual([one, two, three]);
    expect(next.filter(row => row.role === 'assistant' && row.source === 'live').map(row => row.text)).toEqual([answer]);
  });

  // Independent review (10 Nov): retirement must not depend on text the cache
  // can drop. A restored run with no live copy still retires against history.
  it('retires the seals of a wholly sealed run from a cold restore, however long its text', () => {
    const long = (label: string) => `${label} ${'x'.repeat(40_000)}`;
    const live = thread();
    live.chat(long('one')); live.publish(); live.tool('t0', 1100); live.publish();
    live.chat(`${long('one')}\n\n${long('two')}`); live.publish(); live.tool('t1', 1300); live.publish();
    const restored = parsedTranscriptCache(serializedTranscriptCache(live.rows()));
    expect(restored.filter(row => row.steerSealed)).toHaveLength(2);
    const partial = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [prompt, native('step-0', long('one'), 1050)] }), restored, sessionKey);
    expect(partial.filter(row => row.steerSealed).map(row => row.text.slice(0, 3))).toEqual(['two']);
    expect(partial.filter(row => row.role === 'narration').map(row => row.text.slice(0, 3))).toEqual(['one', 'two']);
    const settled = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [
      prompt, native('step-0', long('one'), 1050), native('step-1', long('two'), 1250)] }), partial, sessionKey);
    expect(settled.some(row => row.steerSealed)).toBe(false);
    expect(settled.filter(row => row.role === 'narration').map(row => row.id)).toEqual(['step-0', 'step-1']);
  });

  // Second review (10 Nov): one saved step can stand behind several seals,
  // and a cache can truncate a single long seal.
  it('retires the fragments a steered prompt split one step into, from a cold restore', () => {
    const live = thread();
    live.chat('Reading the'); live.publish();
    live.update(current => sealLiveChatForSteer(current, { id: 'local-steer', role: 'user', text: 'Also check quotas.', source: 'local', sessionKey, runId, idempotencyKey: 'steer', timestamp: String(at(1500)) }, runId));
    live.chat('Reading the docs.'); live.publish(); live.tool('t0', 1600); live.publish();
    const restored = parsedTranscriptCache(serializedTranscriptCache(live.rows()));
    expect(restored.filter(row => row.steerSealed).map(row => row.text)).toEqual(['Reading the', ' docs.']);
    const steer = { role: 'user', content: 'Also check quotas.', timestamp: at(1500), idempotencyKey: 'steer:user',
      __openclaw: { id: 'steer', idempotencyKey: 'steer:user', transcriptPosition: { source, rawSeq: 11 } } };
    const history = () => messagesFromPayload({ sessionKey, sessionId, messages: [prompt, steer, native('step-0', 'Reading the docs.', 1550)] });
    const settled = mergeLatestHistory(history(), restored, sessionKey);
    expect(settled.some(row => row.steerSealed)).toBe(false);
    expect(settled.filter(row => row.role === 'narration').map(row => row.text)).toEqual(['Reading the docs.']);
    expect(mergeLatestHistory(history(), settled, sessionKey).filter(row => row.role === 'narration')).toHaveLength(1);
  });

  it('retires one seal longer than the cache keeps, by the evidence of its full text', () => {
    const long = `Long commentary ${'y'.repeat(70_000)}`;
    const live = thread();
    live.chat(long); live.publish(); live.tool('t0', 1100); live.publish();
    const restored = parsedTranscriptCache(serializedTranscriptCache(live.rows()));
    const seal = restored.find(row => row.steerSealed)!;
    expect(seal.text.length).toBeLessThan(long.length);
    expect(seal.sealText).toEqual({ length: long.length, hash: expect.any(Number), check: expect.any(Number) });
    const settled = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [prompt, native('step-0', long, 1050)] }), restored, sessionKey);
    expect(settled.some(row => row.steerSealed)).toBe(false);
    expect(settled.filter(row => row.role === 'narration').map(row => row.id)).toEqual(['step-0']);
  });

  // Third review (10 Nov): a steer after a whole paragraph leaves fragments
  // with a line break between them, and a hash must never stand in for text
  // the seal still holds.
  it('retires fragments separated by a paragraph break', () => {
    const live = thread();
    live.chat('First paragraph.'); live.publish();
    live.update(current => sealLiveChatForSteer(current, { id: 'local-steer', role: 'user', text: 'Also check quotas.', source: 'local', sessionKey, runId, idempotencyKey: 'steer', timestamp: String(at(1500)) }, runId));
    live.chat('First paragraph.\n\nSecond paragraph.'); live.publish(); live.tool('t0', 1600); live.publish();
    const restored = parsedTranscriptCache(serializedTranscriptCache(live.rows()));
    expect(restored.filter(row => row.steerSealed).map(row => row.text)).toEqual(['First paragraph.', 'Second paragraph.']);
    const steer = { role: 'user', content: 'Also check quotas.', timestamp: at(1500), idempotencyKey: 'steer:user',
      __openclaw: { id: 'steer', idempotencyKey: 'steer:user', transcriptPosition: { source, rawSeq: 11 } } };
    const settled = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [prompt, steer, native('step-0', 'First paragraph.\n\nSecond paragraph.', 1550)] }), restored, sessionKey);
    expect(settled.some(row => row.steerSealed)).toBe(false);
    expect(settled.filter(row => row.role === 'narration').map(row => row.id)).toEqual(['step-0']);
  });

  it('compares text the seal still holds directly, whatever any digest says', () => {
    // Equal length and equal 32-bit FNV-1a hash.
    const [sealed, saved] = ['Q>B!~RW8=-.F', '7ehK<NLY3wX7'];
    const live = thread();
    live.chat(sealed); live.publish(); live.tool('t0', 1100); live.publish();
    const history = () => messagesFromPayload({ sessionKey, sessionId, messages: [prompt, native('step-0', saved, 1050)] });
    expect(mergeLatestHistory(history(), live.rows(), sessionKey).filter(row => row.steerSealed).map(row => row.text)).toEqual([sealed]);
    // A cached digest that disagrees with the visible text is dropped on restore.
    const cached = JSON.parse(serializedTranscriptCache(live.rows())) as { messages?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const rows = Array.isArray(cached) ? cached : cached.messages!;
    const forged = rows.find(row => row.steerSealed === true)!;
    forged.sealText = { length: saved.length, hash: 1, check: 1 };
    const restored = parsedTranscriptCache(JSON.stringify(cached));
    expect(restored.find(row => row.steerSealed)!.sealText).toBeUndefined();
    expect(mergeLatestHistory(history(), restored, sessionKey).filter(row => row.steerSealed).map(row => row.text)).toEqual([sealed]);
  });

  // Fourth review (10 Nov): at 64,062 characters the truncated preview plus
  // its notice is exactly as long as the full text.
  it.each([63_999, 64_000, 64_001, 64_061, 64_062, 64_063])('retires a restored seal of %i characters', (length) => {
    const long = 'z'.repeat(length);
    const live = thread();
    live.chat(long); live.publish(); live.tool('t0', 1100); live.publish();
    const restored = parsedTranscriptCache(serializedTranscriptCache(live.rows()));
    expect(restored.filter(row => row.steerSealed)).toHaveLength(1);
    const history = () => messagesFromPayload({ sessionKey, sessionId, messages: [prompt, native('step-0', long, 1050)] });
    const settled = mergeLatestHistory(history(), restored, sessionKey);
    expect(settled.some(row => row.steerSealed)).toBe(false);
    expect(mergeLatestHistory(history(), settled, sessionKey).filter(row => row.role === 'narration').map(row => row.id)).toEqual(['step-0']);
    // The same seal never retires against different text of the same length.
    const other = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [prompt, native('step-0', `${'z'.repeat(length - 1)}y`, 1050)] }), restored, sessionKey);
    expect(other.filter(row => row.steerSealed)).toHaveLength(1);
  });

  it('never retires a seal against an equal step saved before its prompt', () => {
    const live = thread();
    live.chat(one); live.publish(); live.tool('t0', 1100); live.publish();
    const merged = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [native('earlier', one, 500), prompt] }), live.rows(), sessionKey);
    expect(merged.filter(row => row.steerSealed).map(row => row.text)).toEqual([one]);
  });
});

describe('the wire memory of live text is bounded and ends with its run', () => {
  const chat = (run: string, text: string, state: 'streaming' | 'complete' | 'error' = 'streaming'): WorkspaceMessage =>
    ({ id: `live-chat-${run}`, role: 'assistant', source: 'live', sessionKey, runId: run, text, chatCumulativeText: text, state, toolBoundaryChatText: '' });
  const tool = (run: string): WorkspaceMessage => ({ id: `live-tool-${run}-t`, role: 'tool', source: 'live', sessionKey, runId: run, text: 'exec', state: 'streaming', toolBoundaryChatText: '' });

  it('forgets a run at its final frame, error or lifecycle end, and ignores unmarked runtimes', () => {
    const texts = new ToolBoundaryChatTexts();
    texts.observe(chat('a', 'A'), false);
    expect(texts.observe(tool('a'), true).toolBoundaryChatText).toBe('A');
    expect('toolBoundaryChatText' in texts.observe(tool('a'), false)).toBe(false);
    texts.observe(chat('a', 'A done', 'complete'), false);
    texts.observe(chat('b', 'B'), false); texts.observe(chat('b', 'B', 'error'), false);
    texts.observe(chat('c', 'C'), false);
    texts.observe({ id: 'live-run-c', role: 'run', source: 'live', sessionKey, runId: 'c', text: 'end', state: 'complete' }, false);
    const { toolBoundaryChatText: _mark, ...unmarked } = chat('d', 'D');
    texts.observe(unmarked, false);
    expect(texts.size).toBe(0);
    for (const run of ['a', 'b', 'c', 'd']) expect('toolBoundaryChatText' in texts.observe(tool(run), true)).toBe(false);
  });

  it('keeps at most sixteen runs and no oversized text', () => {
    const texts = new ToolBoundaryChatTexts();
    for (let index = 0; index < 40; index += 1) texts.observe(chat(`run-${index}`, 'text'), false);
    expect(texts.size).toBe(16);
    texts.clear();
    texts.observe(chat('huge', 'x'.repeat(262_145)), false);
    expect(texts.size).toBe(0);
  });
});

describe('the live reducer never stores the transient boundary text', () => {
  it('strips an unresolved candidate mark', () => {
    const projected = projectRegisteredGatewayEvent({ event: 'agent', payload: { sessionKey, runId, stream: 'tool', ts: at(1100), data: { phase: 'start', name: 'exec', toolCallId: 't0' } } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }])!;
    expect(projected.message.toolBoundaryChatText).toBe('');
    const rows = upsertLiveMessage([], projected.message);
    expect(rows).toHaveLength(1);
    expect('toolBoundaryChatText' in rows[0]!).toBe(false);
    const chat = projectRegisteredGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state: 'delta', message: { content: one } } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }])!;
    expect(chat.message.toolBoundaryChatText).toBe('');
    expect(upsertLiveMessage(rows, chat.message).some(row => 'toolBoundaryChatText' in row)).toBe(false);
  });
});
