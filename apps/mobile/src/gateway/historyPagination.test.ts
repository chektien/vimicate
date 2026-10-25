import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { upsertLiveMessage } from './gatewayEventProjection';
import { historyCursorFromPayload, mergeLatestHistory, mergeOlderHistory, refreshedHistoryCursor } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { sameTranscriptPublication } from './transcriptPublicationEquality';

const history = (id: string, text: string): WorkspaceMessage => ({ id, text, role: 'assistant', source: 'history', sessionKey: 'one' });

describe('history pagination owner', () => {
  it('keeps a local user when an assistant-only page shares its submission base', () => {
    const prompt: WorkspaceMessage = { id: 'local-p', role: 'user', source: 'local', text: 'keep my prompt',
      sessionKey: 's', runId: 'r', idempotencyKey: 'r', timestamp: '1788265860000' };
    const answer: WorkspaceMessage = { id: 'a', role: 'assistant', source: 'history', text: 'answer',
      sessionKey: 's', runId: 'r', idempotencyKey: 'r:assistant', timestamp: '1788265861000', state: 'complete' };
    expect(mergeLatestHistory([answer], [prompt], 's')).toEqual([prompt, answer]);
  });

  it('reads bounded cursor metadata and shifts a progressed cursor after new rows arrive', () => {
    const first = historyCursorFromPayload({ nextOffset: 80, hasMore: true, totalMessages: 200 }, 'one');
    const progressed = { ...first, nextOffset: 160 };
    const refreshed = historyCursorFromPayload({ nextOffset: 80, hasMore: true, totalMessages: 202 }, 'one');
    expect(refreshedHistoryCursor(progressed, refreshed).nextOffset).toBe(162);
  });

  it('keeps older history, a pending local turn and structured live detail on latest refresh', () => {
    const current: WorkspaceMessage[] = [
      history('old', 'old'),
      { id: 'local', text: 'question', role: 'user', source: 'local', sessionKey: 'one' },
      { id: 'tool', text: 'exec', role: 'tool', source: 'live', sessionKey: 'one' },
    ];
    expect(mergeLatestHistory([history('old', 'old'), history('new', 'answer')], current, 'one').map((message) => message.id)).toEqual(['old', 'local', 'tool', 'new']);
  });

  it('replaces an overlapping durable row with the newest representation', () => {
    const stale = history('answer', 'part');
    const final = history('answer', 'complete');
    expect(mergeLatestHistory([final], [stale], 'one')).toEqual([final]);
  });

  it('removes old blank tool cards when the canonical result refreshes', () => {
    const old: WorkspaceMessage = { id: 'tool-result', role: 'tool', text: 'tool · activity', source: 'history', sessionKey: 'one', attachments: [
      { id: 'empty', filename: 'attachment', mimeType: 'image/jpeg' },
    ] };
    const fresh: WorkspaceMessage = { id: 'tool-result', role: 'tool', text: 'tool · activity', source: 'history', sessionKey: 'one' };
    expect(mergeLatestHistory([fresh], [old], 'one')).toEqual([fresh]);
  });

  it('converges a recovered queued input with its canonical model-history prompt', () => {
    const [pending] = messagesFromPayload({ sessionKey: 'one', pendingInputs: { items: [{
      id: 'pending-1', runId: 'run-1', acceptedAt: 1000, state: 'queued',
      message: { role: 'user', idempotencyKey: 'submission-1', content: 'check drafts' },
    }], total: 1 } });
    const canonical: WorkspaceMessage = {
      id: 'history-prompt', role: 'user', text: 'check drafts', source: 'history',
      sessionKey: 'one', idempotencyKey: 'submission-1:user', timestamp: '1100',
    };

    const merged = mergeLatestHistory([canonical], pending ? [pending] : [], 'one');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'pending-input:pending-1', text: 'check drafts', source: 'history',
      runId: 'run-1', idempotencyKey: 'submission-1',
    });
  });

  it('places live tool detail before its durable final and drops its superseded assistant preview', () => {
    const final = { ...history('answer', 'complete'), runId: 'run-1' };
    const current: WorkspaceMessage[] = [
      { id: 'local', text: 'question', role: 'user', source: 'local', sessionKey: 'one' },
      { id: 'tool', text: 'exec\ndone', role: 'tool', source: 'live', sessionKey: 'one', runId: 'run-1', state: 'complete' },
      { id: 'preview', text: 'part', role: 'assistant', source: 'live', sessionKey: 'one', runId: 'run-1', state: 'streaming' },
    ];
    expect(mergeLatestHistory([final], current, 'one').map((message) => message.id)).toEqual(['local', 'tool', 'answer']);
  });

  it('replaces a completed live tool projection with its canonical call and result rows', () => {
    const runId = 'run-1';
    const toolCallId = 'exec-00000000-0000-4000-9000-000000000124';
    const prompt: WorkspaceMessage = {
      id: 'history-prompt', text: 'audit the presentation', role: 'user', source: 'history',
      sessionKey: 'one', runId, idempotencyKey: 'submission:user',
    };
    const call: WorkspaceMessage = {
      id: 'history-tool-call', text: 'bash\nsed -n 1,260p AGENTS.md', role: 'tool', source: 'history',
      sessionKey: 'one', idempotencyKey: `codex:session:run:tool:${toolCallId}:call`,
      tool: { name: 'bash', summary: 'bash · sed -n 1,260p AGENTS.md' },
    };
    const result: WorkspaceMessage = {
      id: 'history-tool-result', text: 'bash\nproject instructions', role: 'tool', source: 'history',
      sessionKey: 'one', idempotencyKey: `codex:session:run:tool:${toolCallId}:result`,
      tool: { name: 'bash', summary: 'bash · sed -n 1,260p AGENTS.md' },
    };
    const final = history('history-answer', 'audit complete');
    const live: WorkspaceMessage = {
      id: `live-tool-${runId}-${toolCallId}`, text: 'bash\nproject instructions', role: 'tool',
      source: 'live', state: 'complete', sessionKey: 'one', runId,
      tool: { name: 'bash', summary: 'bash · print lines 1-260 from AGENTS.md' },
    };
    const unmatched: WorkspaceMessage = {
      ...live,
      id: `live-tool-${runId}-exec-unmatched`,
      text: 'bash\nstill running',
      state: 'streaming',
    };

    expect(mergeLatestHistory(
      [prompt, call, result, final],
      [prompt, live, unmatched, final],
      'one',
    ).map((message) => message.id)).toEqual([
      'history-prompt', 'live-tool-run-1-exec-unmatched', 'history-tool-call', 'history-tool-result', 'history-answer',
    ]);
  });

  it('converges a follow-up warning and live tool trail with its canonical final without oscillating', () => {
    const oldPrompt: WorkspaceMessage = {
      id: 'history-old-prompt', text: 'implement save and load', role: 'user', source: 'history',
      sessionKey: 'one', idempotencyKey: 'old-turn:user', timestamp: '1000',
    };
    const oldAnswer: WorkspaceMessage = {
      id: 'history-old-answer', text: 'Implemented save and load.', role: 'assistant', source: 'history',
      sessionKey: 'one', idempotencyKey: 'old-turn:assistant', timestamp: '2000',
    };
    const localFollowUp: WorkspaceMessage = {
      id: 'local-follow-up', text: 'now verify it', role: 'user', source: 'local', sessionKey: 'one',
      runId: 'run-follow-up', idempotencyKey: 'follow-up', timestamp: '3000',
    };
    const warning: WorkspaceMessage = {
      id: 'live-warning-run-follow-up',
      text: 'OpenClaw recorded a native tool.call without a matching tool.result',
      role: 'error', source: 'live', sessionKey: 'one', runId: 'run-follow-up', timestamp: '3100',
    };
    const tool: WorkspaceMessage = {
      id: 'live-tool-run-follow-up-exec-1', text: 'bash\nchecking saved state', role: 'tool',
      source: 'live', sessionKey: 'one', runId: 'run-follow-up', state: 'streaming', timestamp: '3200',
      tool: { name: 'bash', summary: 'bash · checking saved state' },
    };
    const pending: WorkspaceMessage = {
      id: 'live-run-run-follow-up', text: 'running', role: 'run', source: 'live',
      sessionKey: 'one', runId: 'run-follow-up', state: 'streaming', timestamp: '3300',
    };
    const canonicalFollowUp: WorkspaceMessage = {
      id: 'history-follow-up', text: localFollowUp.text, role: 'user', source: 'history',
      sessionKey: 'one', idempotencyKey: 'follow-up:user', timestamp: '3000',
    };
    const canonicalFinal: WorkspaceMessage = {
      id: 'history-follow-up-answer', text: 'Verification complete.', role: 'assistant', source: 'history',
      sessionKey: 'one', idempotencyKey: 'follow-up:assistant', timestamp: '4000',
    };
    const canonical = [oldPrompt, oldAnswer, canonicalFollowUp, canonicalFinal];
    const expected = [
      'history-old-prompt', 'history-old-answer', 'history-follow-up',
      'live-warning-run-follow-up', 'live-tool-run-follow-up-exec-1',
      'live-run-run-follow-up', 'history-follow-up-answer',
    ];

    let published = mergeLatestHistory(
      canonical,
      [oldPrompt, oldAnswer, localFollowUp, warning, tool, pending],
      'one',
    );
    expect(published.map((message) => message.id)).toEqual(expected);

    for (let cycle = 0; cycle < 4; cycle += 1) {
      const afterRepeatedLiveFrame = upsertLiveMessage(published, { ...pending });
      expect(sameTranscriptPublication(published, afterRepeatedLiveFrame), `live cycle ${cycle}`).toBe(true);
      const refreshed = mergeLatestHistory(canonical, afterRepeatedLiveFrame, 'one');
      expect(refreshed.map((message) => message.id), `history cycle ${cycle}`).toEqual(expected);
      expect(sameTranscriptPublication(afterRepeatedLiveFrame, refreshed), `convergence cycle ${cycle}`).toBe(true);
      published = refreshed;
    }
  });

  it('keeps a richer live assistant stable until lagging canonical history catches up', () => {
    const partial = { ...history('history-answer', 'partial'), runId: 'run-1' };
    const live = { ...history('live-answer', 'partial plus current streaming text'), source: 'live' as const, runId: 'run-1' };
    expect(mergeLatestHistory([partial], [live], 'one')).toEqual([live]);
    const complete = { ...partial, text: 'partial plus current streaming text and final' };
    expect(mergeLatestHistory([complete], [live], 'one')).toEqual([complete]);
  });

  it('prepends older pages exactly once', () => {
    expect(mergeOlderHistory([history('old', 'old')], [history('new', 'new'), history('old', 'old')], 'one').map((message) => message.id)).toEqual(['old', 'new']);
  });

  it('orders delayed Gateway records across history page boundaries by their embedded timestamps', () => {
    const row = (id: string, role: WorkspaceMessage['role'], timestamp: number): WorkspaceMessage => ({
      id, role, timestamp: String(timestamp), text: id, source: 'history', sessionKey: 'one',
    });
    const olderPage = [
      row('prompt-1', 'user', 1787764659052),
      row('prompt-2', 'user', 1787764680778),
      row('prompt-3', 'user', 1787764692019),
      row('prompt-4', 'user', 1787764760235),
    ];
    // OpenClaw appended these records more than an hour later, so offset
    // pagination returned them in the newer page despite their embedded event
    // times falling between the steering prompts above.
    const newerPage = [
      row('preamble-1', 'assistant', 1787764682155),
      row('tool-1', 'tool', 1787764682159),
      row('preamble-2', 'assistant', 1787764696014),
    ];

    expect(mergeOlderHistory(olderPage, newerPage, 'one').map((message) => message.id)).toEqual([
      'prompt-1', 'prompt-2', 'preamble-1', 'tool-1', 'prompt-3', 'preamble-2', 'prompt-4',
    ]);
  });

  it('reconciles one canonical prompt without deleting or reversing a genuinely repeated identical prompt', () => {
    const canonical: WorkspaceMessage = { id: 'history-prompt', text: 'same', role: 'user', source: 'history', sessionKey: 'one' };
    const local = (id: string): WorkspaceMessage => ({ id, text: 'same', role: 'user', source: 'local', sessionKey: 'one' });
    expect(mergeLatestHistory([canonical], [local('first'), local('second')], 'one').map((message) => message.id)).toEqual(['history-prompt', 'second']);
  });

  it('keeps repeated prompts FIFO through every partial history refresh without submission keys', () => {
    const local = (id: string): WorkspaceMessage => ({ id, text: 'same request', role: 'user', source: 'local', sessionKey: 'one' });
    const canonical = (id: string): WorkspaceMessage => ({ id, text: 'same request', role: 'user', source: 'history', sessionKey: 'one' });
    const first = local('local-first');
    const second = local('local-second');
    const third = local('local-third');
    const current = [first, second, third];

    expect(mergeLatestHistory([canonical('history-first')], current, 'one').map((message) => message.id)).toEqual([
      'history-first', 'local-second', 'local-third',
    ]);
    expect(mergeLatestHistory([canonical('history-first'), canonical('history-second')], current, 'one').map((message) => message.id)).toEqual([
      'history-first', 'history-second', 'local-third',
    ]);
    expect(mergeLatestHistory([canonical('history-first'), canonical('history-second'), canonical('history-third')], current, 'one').map((message) => message.id)).toEqual([
      'history-first', 'history-second', 'history-third',
    ]);
  });

  it('keeps repeated prompts FIFO when each partial refresh becomes the next published state', () => {
    const local = (id: string): WorkspaceMessage => ({ id, text: 'same request', role: 'user', source: 'local', sessionKey: 'one' });
    const canonical = (id: string): WorkspaceMessage => ({ id, text: 'same request', role: 'user', source: 'history', sessionKey: 'one' });
    const first = canonical('history-first');
    const second = canonical('history-second');
    const third = canonical('history-third');

    const afterFirst = mergeLatestHistory([first], [local('local-first'), local('local-second'), local('local-third')], 'one');
    expect(afterFirst.map((message) => message.id)).toEqual(['history-first', 'local-second', 'local-third']);

    const afterSecond = mergeLatestHistory([first, second], afterFirst, 'one');
    expect(afterSecond.map((message) => message.id)).toEqual(['history-first', 'history-second', 'local-third']);

    const afterThird = mergeLatestHistory([first, second, third], afterSecond, 'one');
    expect(afterThird.map((message) => message.id)).toEqual(['history-first', 'history-second', 'history-third']);
  });

  it('keeps interleaved detail beside repeated prompts through iterative partial refreshes', () => {
    const prompt = (id: string, source: 'history' | 'local'): WorkspaceMessage => ({
      id, text: 'same request', role: 'user', source, sessionKey: 'one', runId: 'shared-run',
    });
    const old = history('old', 'old answer');
    const local = [prompt('local-first', 'local'), prompt('local-second', 'local'), prompt('local-third', 'local')];
    const canonical = [prompt('history-first', 'history'), prompt('history-second', 'history'), prompt('history-third', 'history')];
    const firstDetail: WorkspaceMessage = { id: 'detail-first', text: 'first detail', role: 'narration', source: 'live', sessionKey: 'one', runId: 'shared-run' };
    const secondDetail: WorkspaceMessage = { id: 'detail-second', text: 'second detail', role: 'tool', source: 'live', sessionKey: 'one', runId: 'shared-run' };
    const thirdDetail: WorkspaceMessage = { id: 'detail-third', text: 'third detail', role: 'narration', source: 'live', sessionKey: 'one', runId: 'shared-run' };
    const expected = (canonicalCount: number) => [
      'old', canonicalCount >= 1 ? 'history-first' : 'local-first', 'detail-first',
      canonicalCount >= 2 ? 'history-second' : 'local-second', 'detail-second',
      canonicalCount >= 3 ? 'history-third' : 'local-third', 'detail-third',
    ];
    let published: WorkspaceMessage[] = [old, local[0]!, firstDetail, local[1]!, secondDetail, local[2]!, thirdDetail];
    for (let count = 1; count <= canonical.length; count += 1) {
      published = mergeLatestHistory([old, ...canonical.slice(0, count)], published, 'one');
      expect(published.map((message) => message.id), `refresh ${count}`).toEqual(expected(count));
    }
  });

  it('retains exact authored command text through repeated canonical refreshes', () => {
    const canonical: WorkspaceMessage = { id: 'history-think', text: ':think high', role: 'user', source: 'history', sessionKey: 'one', idempotencyKey: 'submission-think:user', timestamp: 'canonical-time' };
    const optimistic: WorkspaceMessage = { id: 'local-think', text: ':Think high', role: 'user', source: 'local', sessionKey: 'one', idempotencyKey: 'submission-think' };
    const first = mergeLatestHistory([canonical], [optimistic], 'one');

    expect(first[0]?.text).toBe(':Think high');
    expect(mergeLatestHistory([canonical], first, 'one')[0]?.text).toBe(':Think high');
  });

  it('replaces an optimistic submission with the gateway user row whose idempotency key has a role suffix', () => {
    const canonical: WorkspaceMessage = { id: 'history-prompt', text: 'question', role: 'user', source: 'history', sessionKey: 'one', idempotencyKey: 'submission-1:user' };
    const optimistic: WorkspaceMessage = { id: 'local-prompt', text: 'question', role: 'user', source: 'local', sessionKey: 'one', idempotencyKey: 'submission-1' };
    expect(mergeLatestHistory([canonical], [optimistic], 'one')).toEqual([canonical]);
  });

  it('keeps the exact authored colon command while adopting canonical history metadata', () => {
    const canonical: WorkspaceMessage = { id: 'history-think', text: ':think high', role: 'user', source: 'history', sessionKey: 'one', idempotencyKey: 'submission-think:user', timestamp: 'canonical-time' };
    const optimistic: WorkspaceMessage = { id: 'local-think', text: ':Think high', role: 'user', source: 'local', sessionKey: 'one', idempotencyKey: 'submission-think' };
    expect(mergeLatestHistory([canonical], [optimistic], 'one')).toEqual([{ ...canonical, text: ':Think high' }]);
  });

  it('keeps an older unscoped status row before a newly canonicalized prompt', () => {
    const oldTurn: WorkspaceMessage = { id: 'old-turn', text: 'old answer', role: 'assistant', source: 'history', sessionKey: 'one' };
    const status: WorkspaceMessage = { id: 'status', text: ':status — done', role: 'command', source: 'live', sessionKey: 'one' };
    const optimistic: WorkspaceMessage = { id: 'local-slide-3', text: 'slide 3', role: 'user', source: 'local', sessionKey: 'one', idempotencyKey: 'submission-3' };
    const canonical: WorkspaceMessage = { id: 'history-slide-3', text: 'slide 3', role: 'user', source: 'history', sessionKey: 'one', idempotencyKey: 'submission-3:user' };
    expect(mergeLatestHistory([oldTurn, canonical], [oldTurn, status, optimistic], 'one').map((message) => message.id)).toEqual(['old-turn', 'status', 'history-slide-3']);
  });

  it('keeps a completed run footer after its canonical final when history omits runId', () => {
    const canonicalPrompt: WorkspaceMessage = { id: 'history-prompt', text: 'chronology probe', role: 'user', source: 'history', sessionKey: 'one', idempotencyKey: 'submission:user', timestamp: '1000' };
    const canonicalFinal: WorkspaceMessage = { id: 'history-answer', text: 'CHRONOLOGY_OK', role: 'assistant', source: 'history', sessionKey: 'one', idempotencyKey: 'gateway-answer', timestamp: '4000' };
    const liveFinal: WorkspaceMessage = { ...canonicalFinal, id: 'live-answer', source: 'live', runId: 'run-1' };
    const completion: WorkspaceMessage = { id: 'live-run-run-1', text: '✓ done in 3s', role: 'run', state: 'complete', source: 'live', sessionKey: 'one', runId: 'run-1' };
    const current: WorkspaceMessage[] = [canonicalPrompt, liveFinal, completion];

    expect(mergeLatestHistory([canonicalPrompt, canonicalFinal], current, 'one').map((message) => message.id)).toEqual([
      'history-prompt', 'history-answer', 'live-run-run-1',
    ]);
  });

  it('correlates a live final to its canonical turn when Gateway assigns a different assistant identity and timestamp', () => {
    const canonicalPrompt: WorkspaceMessage = { id: 'history-prompt', text: 'chronology probe', role: 'user', source: 'history', sessionKey: 'one', idempotencyKey: 'submission:user', timestamp: '1000' };
    const canonicalFinal: WorkspaceMessage = { id: 'history-answer', text: 'CHRONOLOGY_OK', role: 'assistant', source: 'history', sessionKey: 'one', idempotencyKey: 'gateway-answer:assistant', timestamp: '4000' };
    const localPrompt: WorkspaceMessage = { ...canonicalPrompt, id: 'local-prompt', source: 'local', idempotencyKey: 'submission', timestamp: '900' };
    const liveFinal: WorkspaceMessage = { ...canonicalFinal, id: 'live-answer', source: 'live', idempotencyKey: 'live-run-answer', timestamp: '3500', runId: 'run-1' };
    const completion: WorkspaceMessage = { id: 'live-run-run-1', text: '✓ done in 3s', role: 'run', state: 'complete', source: 'live', sessionKey: 'one', runId: 'run-1' };

    const merged = mergeLatestHistory([canonicalPrompt, canonicalFinal], [localPrompt, liveFinal, completion], 'one');
    expect(merged.map((message) => message.id)).toEqual(['history-prompt', 'history-answer', 'live-run-run-1']);
    expect(merged[1]).toMatchObject({ source: 'history', runId: 'run-1', text: 'CHRONOLOGY_OK' });
  });

  it('keeps each canonicalized steering prompt above the live narration and tools that followed it', () => {
    const old = history('old-answer', 'previous answer');
    const prompt = (id: string, text: string, source: 'history' | 'local', idempotencyKey: string): WorkspaceMessage => ({
      id, text, role: 'user', source, sessionKey: 'one', idempotencyKey,
    });
    const canonicalFirst = prompt('history-first', 'can you tell me the top 10 students', 'history', 'first:user');
    const canonicalSecond = prompt('history-second', 'describe what are you doing now?', 'history', 'second:user');
    const localFirst = prompt('local-first', canonicalFirst.text, 'local', 'first');
    const localSecond = prompt('local-second', canonicalSecond.text, 'local', 'second');
    const narration: WorkspaceMessage = { id: 'narration', text: "I'll inspect the workspace first.", role: 'narration', source: 'live', sessionKey: 'one', runId: 'run-1' };
    const firstTool: WorkspaceMessage = { id: 'first-tool', text: 'read instructions', role: 'tool', source: 'live', sessionKey: 'one', runId: 'run-1' };
    const secondTool: WorkspaceMessage = { id: 'second-tool', text: 'run privacy gateway', role: 'tool', source: 'live', sessionKey: 'one', runId: 'run-1' };

    const merged = mergeLatestHistory(
      [old, canonicalFirst, canonicalSecond],
      [old, localFirst, narration, firstTool, localSecond, secondTool],
      'one',
    );
    expect(merged.map((message) => message.id)).toEqual([
      'old-answer', 'history-first', 'narration', 'first-tool', 'history-second', 'second-tool',
    ]);
  });

  it('preserves live publication order when several steering prompts share one active run', () => {
    const old = history('old-answer', 'previous answer');
    const prompt = (id: string, text: string, source: 'history' | 'local', idempotencyKey: string): WorkspaceMessage => ({
      id, text, role: 'user', source, sessionKey: 'one', idempotencyKey, runId: 'shared-run',
    });
    const localFirst = prompt('local-first', 'edit the saved document', 'local', 'first');
    const localSecond = prompt('local-second', 'ask ccwork to check formatting', 'local', 'second');
    const localThird = prompt('local-third', 'use ccwork where possible', 'local', 'third');
    const canonical = [
      prompt('history-first', localFirst.text, 'history', 'first:user'),
      prompt('history-second', localSecond.text, 'history', 'second:user'),
      prompt('history-third', localThird.text, 'history', 'third:user'),
    ];
    const firstPreamble: WorkspaceMessage = { id: 'first-preamble', role: 'narration', text: "I'll update the latest saved DOCX.", source: 'live', sessionKey: 'one', runId: 'shared-run' };
    const firstTool: WorkspaceMessage = { id: 'first-tool', role: 'tool', text: 'read instructions', source: 'live', sessionKey: 'one', runId: 'shared-run' };
    const secondPreamble: WorkspaceMessage = { id: 'second-preamble', role: 'narration', text: "I'll delegate the formatting review.", source: 'live', sessionKey: 'one', runId: 'shared-run' };

    const merged = mergeLatestHistory(
      [old, ...canonical],
      [old, localFirst, firstPreamble, firstTool, localSecond, localThird, secondPreamble],
      'one',
    );

    expect(merged.map((message) => message.id)).toEqual([
      'old-answer',
      'history-first', 'first-preamble', 'first-tool',
      'history-second', 'history-third', 'second-preamble',
    ]);

    const restored = parsedTranscriptCache(serializedTranscriptCache(merged));
    expect(mergeLatestHistory([old, ...canonical], restored, 'one').map((message) => message.id)).toEqual([
      'old-answer',
      'history-first', 'first-preamble', 'first-tool',
      'history-second', 'history-third', 'second-preamble',
    ]);
  });

  it('preserves steering publication order while canonical history catches up one prompt at a time', () => {
    const old = history('old-answer', 'previous answer');
    const prompt = (id: string, text: string, source: 'history' | 'local', idempotencyKey: string): WorkspaceMessage => ({
      id, text, role: 'user', source, sessionKey: 'one', idempotencyKey, runId: 'shared-run',
    });
    const localFirst = prompt('local-first', 'edit the saved document', 'local', 'first');
    const localSecond = prompt('local-second', 'ask ccwork to check formatting', 'local', 'second');
    const localThird = prompt('local-third', 'use ccwork where possible', 'local', 'third');
    const canonicalFirst = prompt('history-first', localFirst.text, 'history', 'first:user');
    const firstPreamble: WorkspaceMessage = { id: 'first-preamble', role: 'narration', text: "I'll update the latest saved DOCX.", source: 'live', sessionKey: 'one', runId: 'shared-run' };
    const firstTool: WorkspaceMessage = { id: 'first-tool', role: 'tool', text: 'read instructions', source: 'live', sessionKey: 'one', runId: 'shared-run' };
    const secondPreamble: WorkspaceMessage = { id: 'second-preamble', role: 'narration', text: "I'll delegate the formatting review.", source: 'live', sessionKey: 'one', runId: 'shared-run' };

    const merged = mergeLatestHistory(
      [old, canonicalFirst],
      [old, localFirst, firstPreamble, firstTool, localSecond, localThird, secondPreamble],
      'one',
    );

    expect(merged.map((message) => message.id)).toEqual([
      'old-answer',
      'history-first', 'first-preamble', 'first-tool',
      'local-second', 'local-third', 'second-preamble',
    ]);
  });

  it('moves a shared-run completion footer after the canonical final without regrouping steering detail', () => {
    const prompt = (id: string, text: string, source: 'history' | 'local', idempotencyKey: string, timestamp: string): WorkspaceMessage => ({
      id, text, role: 'user', source, sessionKey: 'one', idempotencyKey, timestamp, runId: 'shared-run',
    });
    const localFirst = prompt('local-first', 'edit the document', 'local', 'first', '1000');
    const localSecond = prompt('local-second', 'also check the formatting', 'local', 'second', '3000');
    const canonicalFirst = prompt('history-first', localFirst.text, 'history', 'first:user', '1000');
    const canonicalSecond = prompt('history-second', localSecond.text, 'history', 'second:user', '3000');
    const preamble: WorkspaceMessage = {
      id: 'preamble', role: 'narration', text: "I'll edit the document first.", source: 'live', sessionKey: 'one', runId: 'shared-run', timestamp: '2000',
    };
    const tool: WorkspaceMessage = {
      id: 'tool', role: 'tool', text: 'render document', source: 'live', sessionKey: 'one', runId: 'shared-run', timestamp: '4000', state: 'complete',
    };
    const canonicalFinal: WorkspaceMessage = {
      id: 'history-final', role: 'assistant', text: 'The revised document is ready.', source: 'history', sessionKey: 'one', timestamp: '5000',
    };
    const liveFinal: WorkspaceMessage = {
      ...canonicalFinal, id: 'live-final', source: 'live', runId: 'shared-run', state: 'complete',
    };
    // The terminal event can be published before the last tool/final chat
    // projection reaches React Native. It is still a footer, not ordinary
    // run detail, and must never retain that transient publication slot.
    const completion: WorkspaceMessage = {
      id: 'completion', role: 'run', text: '✓ done in 4s', source: 'live', sessionKey: 'one', runId: 'shared-run', state: 'complete',
    };

    const merged = mergeLatestHistory(
      [canonicalFirst, canonicalSecond, canonicalFinal],
      [localFirst, preamble, localSecond, completion, tool, liveFinal],
      'one',
    );

    expect(merged.map((message) => message.id)).toEqual([
      'history-first', 'preamble', 'history-second', 'tool', 'history-final', 'completion',
    ]);
  });

  it('moves a late preamble back beside its owning prompt instead of leaving it below newer completed turns', () => {
    const old = history('old-answer', 'previous answer');
    const prompt: WorkspaceMessage = {
      id: 'history-search-prompt', role: 'user', text: 'find the approved software list',
      source: 'history', sessionKey: 'one', idempotencyKey: 'search:user',
    };
    const optimistic: WorkspaceMessage = {
      ...prompt, id: 'local-search-prompt', source: 'local', idempotencyKey: 'search', runId: 'run-search',
    };
    const answer = history('search-answer', 'The likely page is the approved tools list.');
    const newerPrompt: WorkspaceMessage = {
      id: 'newer-prompt', role: 'user', text: 'what did my Mac Studio cost?', source: 'history', sessionKey: 'one',
    };
    const newerAnswer = history('newer-answer', 'Your Mac Studio cost $2,599.');
    const latePreamble: WorkspaceMessage = {
      id: 'late-preamble', role: 'narration', text: "I'll search the official site.",
      source: 'live', sessionKey: 'one', runId: 'run-search', state: 'streaming',
    };

    const merged = mergeLatestHistory(
      [old, prompt, answer, newerPrompt, newerAnswer],
      [old, optimistic, answer, newerPrompt, newerAnswer, latePreamble],
      'one',
    );

    expect(merged.map((message) => message.id)).toEqual([
      'old-answer', 'history-search-prompt', 'late-preamble', 'search-answer', 'newer-prompt', 'newer-answer',
    ]);
  });

  it('does not republish an unowned preamble restored from the old cache below newer canonical answers', () => {
    const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'find the list', source: 'history', sessionKey: 'one' };
    const answer = history('answer', 'The likely page is the approved tools list.');
    const newerPrompt: WorkspaceMessage = { id: 'newer-prompt', role: 'user', text: 'what did my Mac cost?', source: 'history', sessionKey: 'one' };
    const newerAnswer = history('newer-answer', 'Your Mac Studio cost $2,599.');
    const restoredOrphan: WorkspaceMessage = {
      id: 'old-cache-preamble', role: 'narration', text: "I'll search the official site.",
      source: 'live', sessionKey: 'one', runId: 'lost-run',
    };

    expect(mergeLatestHistory(
      [prompt, answer, newerPrompt, newerAnswer],
      [prompt, answer, newerPrompt, newerAnswer, restoredOrphan],
      'one',
    ).map((message) => message.id)).toEqual(['prompt', 'answer', 'newer-prompt', 'newer-answer']);
  });

  it('does not append an older unmatched live answer below a newer canonical response', () => {
    const firstPrompt: WorkspaceMessage = {
      id: 'first-prompt', role: 'user', text: 'complete the ExampleTracker update',
      source: 'history', sessionKey: 'one', timestamp: '1787818147121',
    };
    const olderLiveAnswer: WorkspaceMessage = {
      id: 'older-live-answer', role: 'assistant',
      text: 'The ExampleTracker update is complete; the verified draft remains unsent.',
      source: 'live', sessionKey: 'one', runId: 'older-run',
      timestamp: '1787818539801', state: 'complete',
    };
    const firstCanonicalAnswer: WorkspaceMessage = {
      id: 'first-canonical-answer', role: 'assistant',
      // Canonical protocol cleanup can make this text differ enough that the
      // live representation cannot safely converge by prefix or identity.
      text: 'The ExampleTracker update is complete. The verified draft remains unsent.',
      source: 'history', sessionKey: 'one', timestamp: '1787818539802',
    };
    const latestPrompt: WorkspaceMessage = {
      id: 'latest-prompt', role: 'user', text: 'what did you do last?',
      source: 'history', sessionKey: 'one', timestamp: '1787819103353',
    };
    const latestAnswer: WorkspaceMessage = {
      id: 'latest-answer', role: 'assistant', text: 'Last actions: submitted and verified the feedback.',
      source: 'history', sessionKey: 'one', timestamp: '1787819112916',
    };

    expect(mergeLatestHistory(
      [firstPrompt, firstCanonicalAnswer, latestPrompt, latestAnswer],
      [firstPrompt, olderLiveAnswer, firstCanonicalAnswer, latestPrompt, latestAnswer],
      'one',
    ).map((message) => message.id)).toEqual([
      'first-prompt', 'older-live-answer', 'first-canonical-answer', 'latest-prompt', 'latest-answer',
    ]);
  });

  it('repairs an already-corrupted cache whose older unmatched live answer was previously appended last', () => {
    const firstPrompt: WorkspaceMessage = {
      id: 'first-prompt', role: 'user', text: 'complete the ExampleTracker update',
      source: 'history', sessionKey: 'one', timestamp: '1787818147121',
    };
    const olderLiveAnswer: WorkspaceMessage = {
      id: 'older-live-answer', role: 'assistant',
      text: 'The ExampleTracker update is complete; the verified draft remains unsent.',
      source: 'live', sessionKey: 'one', runId: 'older-run',
      timestamp: '1787818539801', state: 'complete',
    };
    const firstCanonicalAnswer: WorkspaceMessage = {
      id: 'first-canonical-answer', role: 'assistant',
      text: 'The ExampleTracker update is complete. The verified draft remains unsent.',
      source: 'history', sessionKey: 'one', timestamp: '1787818539802',
    };
    const latestPrompt: WorkspaceMessage = {
      id: 'latest-prompt', role: 'user', text: 'what did you do last?',
      source: 'history', sessionKey: 'one', timestamp: '1787819103353',
    };
    const latestAnswer: WorkspaceMessage = {
      id: 'latest-answer', role: 'assistant', text: 'Last actions: submitted and verified the feedback.',
      source: 'history', sessionKey: 'one', timestamp: '1787819112916',
    };

    expect(mergeLatestHistory(
      [firstPrompt, firstCanonicalAnswer, latestPrompt, latestAnswer],
      [firstPrompt, firstCanonicalAnswer, latestPrompt, latestAnswer, olderLiveAnswer],
      'one',
    ).map((message) => message.id)).toEqual([
      'first-prompt', 'older-live-answer', 'first-canonical-answer', 'latest-prompt', 'latest-answer',
    ]);
  });

  it('moves an owned untimestamped older live answer out of a newer turn', () => {
    const oldPrompt: WorkspaceMessage = {
      id: 'old-prompt', role: 'user', text: 'complete the ExampleTracker update',
      source: 'history', sessionKey: 'one', runId: 'older-run', timestamp: '1000',
    };
    const oldCanonicalAnswer: WorkspaceMessage = {
      id: 'old-canonical-answer', role: 'assistant',
      text: 'The verified ExampleTracker draft remains ready for review.',
      source: 'history', sessionKey: 'one', timestamp: '2000',
    };
    const newerPrompt: WorkspaceMessage = {
      id: 'newer-prompt', role: 'user', text: 'what did you do last?',
      source: 'history', sessionKey: 'one', runId: 'newer-run', timestamp: '3000',
    };
    const newerAnswer: WorkspaceMessage = {
      id: 'newer-answer', role: 'assistant', text: 'Last actions: submitted and verified the feedback.',
      source: 'history', sessionKey: 'one', timestamp: '4000',
    };
    const olderLiveAnswer: WorkspaceMessage = {
      id: 'older-live-answer', role: 'assistant',
      text: 'ExampleTracker is complete; the document was checked and the draft remains unsent.',
      source: 'live', sessionKey: 'one', runId: 'older-run', state: 'complete',
    };

    // An older build persisted the live answer after the newer prompt. Its
    // old run still has an authoritative prompt, so the representation must
    // be retained, but its corrupt cache coordinate must not be treated as
    // chronology authority inside the newer turn.
    const canonical = [oldPrompt, oldCanonicalAnswer, newerPrompt, newerAnswer];
    for (let cacheSlot = 0; cacheSlot <= canonical.length; cacheSlot += 1) {
      const corrupted = [...canonical];
      corrupted.splice(cacheSlot, 0, olderLiveAnswer);
      const restoredCorruptCache = parsedTranscriptCache(serializedTranscriptCache(corrupted));
      expect(mergeLatestHistory(canonical, restoredCorruptCache, 'one').map((message) => message.id), `cache slot ${cacheSlot}`).toEqual([
        'old-prompt', 'older-live-answer', 'old-canonical-answer', 'newer-prompt', 'newer-answer',
      ]);
    }
  });

  it('drops an untimestamped restored live answer whose run and turn ownership were lost', () => {
    const oldPrompt: WorkspaceMessage = {
      id: 'old-prompt', role: 'user', text: 'prepare the morning brief',
      source: 'history', sessionKey: 'one', timestamp: '1787801000000',
    };
    const oldAnswer: WorkspaceMessage = {
      id: 'old-answer', role: 'assistant', text: 'Morning Brief — completed activity',
      source: 'history', sessionKey: 'one', timestamp: '1787801100000',
    };
    const latestPrompt: WorkspaceMessage = {
      id: 'latest-prompt', role: 'user', text: 'update standup',
      source: 'history', sessionKey: 'one', timestamp: '1787801800000',
    };
    const latestAnswer: WorkspaceMessage = {
      id: 'latest-answer', role: 'assistant', text: 'Updated standup.md',
      source: 'history', sessionKey: 'one', timestamp: '1787801900000',
    };
    // Older builds could persist this unmatched representation after the
    // latest answer. With neither a timestamp nor another row from its run,
    // that tail coordinate is not chronology evidence.
    const staleRestoredAnswer: WorkspaceMessage = {
      id: 'stale-live-morning-brief', role: 'assistant', text: '[Morning brief] Morning Brief — completed activity',
      source: 'live', sessionKey: 'one', runId: 'lost-morning-run', state: 'complete',
    };

    expect(mergeLatestHistory(
      [oldPrompt, oldAnswer, latestPrompt, latestAnswer],
      [oldPrompt, oldAnswer, latestPrompt, latestAnswer, staleRestoredAnswer],
      'one',
    ).map((message) => message.id)).toEqual([
      'old-prompt', 'old-answer', 'latest-prompt', 'latest-answer',
    ]);
  });
});
