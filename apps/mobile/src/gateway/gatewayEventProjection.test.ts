import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { pendingApprovalMessages, projectGatewayEvent, projectRegisteredGatewayEvent, reconcilePendingApprovalMessages, upsertLiveMessage } from './gatewayEventProjection';
import { transcriptMessageIsFoldedByDefault } from '../transcript/transcriptRowBudget';
import { mergeSharedNarration } from './sharedNarration';

describe('structured gateway event projection', () => {
  it('does not expose a bare model lifecycle phase as transcript prose', () => {
    const modelPhase = { event: 'agent', payload: { sessionKey: 'one', runId: 'r-model', stream: 'lifecycle', data: { phase: 'model' } } };
    expect(projectGatewayEvent(modelPhase, 'one')).toBeNull();
    expect(projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r-model', stream: 'lifecycle', data: { phase: 'start' } } }, 'one')?.message).toMatchObject({ role: 'run', text: 'start' });
    expect(projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r-model', stream: 'lifecycle', data: { phase: 'error', reason: 'model unavailable' } } }, 'one')?.message).toMatchObject({ role: 'error', text: 'Run failed · model unavailable' });
  });
  it('projects useful cumulative assistant chat deltas and suppresses generic liveness', () => {
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'r1', state: 'delta', message: { content: [{ type: 'text', text: 'I am checking the project.' }] } } }, 'one')?.message).toMatchObject({ id: 'live-chat-r1', role: 'assistant', text: 'I am checking the project.', state: 'streaming' });
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'r1', state: 'delta', message: { content: [{ type: 'text', text: 'working' }] } } }, 'one')).toBeNull();
  });

  it('replaces a pi-runtime non-prefix rewrite within one assistant row', () => {
    const frames = [
      { event: 'chat', payload: { sessionKey: 'one', runId: 'pi-run', state: 'delta', delta: 'draft', replace: false, message: { content: '<think>checking</think>Draft answer' } } },
      { event: 'chat', payload: { sessionKey: 'one', runId: 'pi-run', state: 'delta', delta: 'Clean answer', replace: true, message: { content: 'Clean answer' } } },
      { event: 'chat', payload: { sessionKey: 'one', runId: 'pi-run', state: 'final', message: { content: 'Clean answer, complete.' } } },
    ];

    const transcript = frames
      .map((frame) => projectGatewayEvent(frame, 'one')?.message)
      .filter((message): message is WorkspaceMessage => Boolean(message))
      .reduce(upsertLiveMessage, [] as WorkspaceMessage[]);

    expect(transcript).toEqual([
      expect.objectContaining({
        id: 'live-chat-pi-run',
        role: 'assistant',
        text: 'Clean answer, complete.',
        state: 'complete',
        runId: 'pi-run',
      }),
    ]);
  });

  it('projects structured media immediately from a live chat event', () => {
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'r-media', state: 'final', message: { content: [{ type: 'image', title: 'capture.png', url: '/api/chat/media/outgoing/capture.png', mimeType: 'image/png' }] } } }, 'one')?.message).toMatchObject({
      id: 'live-chat-r-media',
      role: 'assistant',
      state: 'complete',
      attachments: [{ filename: 'capture.png', mimeType: 'image/png', uri: '/api/chat/media/outgoing/capture.png' }],
    });
  });

  it('suppresses assistant sentinels without discarding media or ordinary NO', () => {
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'sentinel', state: 'final', message: { content: 'NO_REPLY' } } }, 'one')).toBeNull();
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'prefix', state: 'delta', message: { content: 'HEARTBEAT_' } } }, 'one')).toBeNull();
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'ordinary', state: 'final', message: { content: 'NO' } } }, 'one')?.message.text).toBe('NO');
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'media', state: 'final', message: { content: [{ type: 'text', text: 'HEARTBEAT_OK' }, { type: 'image', title: 'proof.png', url: 'https://example.test/proof.png', mimeType: 'image/png' }] } } }, 'one')?.message).toMatchObject({ text: '', attachments: [{ filename: 'proof.png' }] });
  });

  it('does not render malformed assistant projection diagnostics as red errors', () => {
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'r1', state: 'error', errorMessage: 'error: content=text=search x role=assistant timestamp=1781229207542' } }, 'one')).toBeNull();
    expect(projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'error', data: { reason: 'error: content=text=search x role=assistant timestamp=1781229207542' } } }, 'one')).toBeNull();
  });

  it('upserts tool progress by semantic tool-call identity', () => {
    const start = projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'tool', data: { toolCallId: 't1', name: 'exec', phase: 'start', meta: 'pwd', args: { cmd: 'pwd' } } } }, 'one')!.message;
    const result = projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'tool', data: { toolCallId: 't1', name: 'exec', phase: 'result', meta: 'pwd', result: { output: '/tmp', durationMs: 1250 } } } }, 'one')!.message;
    expect(upsertLiveMessage(upsertLiveMessage([], start), result)).toEqual([expect.objectContaining({ id: 'live-tool-r1-t1', text: expect.stringContaining('exec'), state: 'complete', tool: { name: 'exec', summary: 'exec · pwd', durationMs: 1250 } })]);
  });

  it('inserts a delayed run preamble beside its owning prompt instead of below newer completed turns', () => {
    const current = [
      { id: 'prompt', role: 'user' as const, text: 'find the software list', source: 'history' as const, sessionKey: 'one', runId: 'r1' },
      { id: 'answer', role: 'assistant' as const, text: 'The likely page is…', source: 'history' as const, sessionKey: 'one' },
      { id: 'newer-prompt', role: 'user' as const, text: 'what did the Mac cost?', source: 'history' as const, sessionKey: 'one' },
      { id: 'newer-answer', role: 'assistant' as const, text: '$2,599', source: 'history' as const, sessionKey: 'one' },
    ];
    const late = { id: 'preamble', role: 'narration' as const, text: "I'll search the official site.", source: 'live' as const, sessionKey: 'one', runId: 'r1' };

    expect(upsertLiveMessage(current, late).map((message) => message.id)).toEqual([
      'prompt', 'preamble', 'answer', 'newer-prompt', 'newer-answer',
    ]);
  });

  it('keeps one narration row when a runtime streams preamble updates without an item id', () => {
    const preamble = (progressText: string, seq: number) => ({
      event: 'agent',
      payload: { sessionKey: 'one', runId: 'r9', seq, stream: 'item', data: { kind: 'preamble', progressText } },
    });
    // A runtime that omits itemId still sends `phase: update` frames for one
    // logical announcement. `seq` differs on every frame, so keying identity on
    // it turns each update into another visible copy of the same announcement.
    const first = projectGatewayEvent(preamble('Creating the draft now', 11), 'one')!.message;
    const second = projectGatewayEvent(preamble('Creating the draft now: an unsent Reply All', 12), 'one')!.message;

    expect(second.id).toBe(first.id);
    const live = upsertLiveMessage(upsertLiveMessage([], first), second);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ role: 'narration', text: 'Creating the draft now: an unsent Reply All' });
  });

  it('does not let a host-timed live preamble cross an optimistic prompt from another clock', () => {
    const current = [
      { id: 'p1', role: 'user' as const, text: 'edit the file', timestamp: '100000', source: 'local' as const, sessionKey: 'one', runId: 'r1' },
      { id: 'p2', role: 'user' as const, text: 'ask ccwork', timestamp: '200000', source: 'local' as const, sessionKey: 'one', runId: 'r1' },
      // A new run can publish its first frame before chat.send's response has
      // supplied the run id that binds this optimistic prompt.
      { id: 'p3', role: 'user' as const, text: 'use ccwork', timestamp: '400000', source: 'local' as const, sessionKey: 'one' },
    ];
    const frame = { event: 'agent', payload: { sessionKey: 'one', runId: 'r2', ts: 300, stream: 'item', data: { kind: 'preamble', itemId: 'pre', progressText: 'delegating now' } } };
    const late = projectGatewayEvent(frame, 'one')!.message;

    expect(late).toMatchObject({ id: 'live-item-r2-pre', timestamp: '300000' });
    const live = upsertLiveMessage(current, late);
    // The local accepted-at time and host event time are not a shared clock.
    // Arrival after p3 is the only safe provisional order until host history
    // gives the preamble a canonical coordinate.
    expect(live.map((message) => message.id)).toEqual(['p1', 'p2', 'p3', 'live-item-r2-pre']);

    const authoritative = {
      ...late, timestamp: '500000', source: 'history' as const,
      transcriptSessionId: 'session-one', narrationItemId: 'pre',
    };
    expect(mergeSharedNarration(live, [authoritative]).map((message) => message.id))
      .toEqual(['p1', 'p2', 'p3', 'live-item-r2-pre']);
  });

  it('repositions an existing untimed preamble when the same live identity gains its authoritative source time', () => {
    const current = [
      { id: 'p1', role: 'user' as const, text: 'edit the file', timestamp: '100000', source: 'local' as const, sessionKey: 'one', runId: 'r1' },
      { id: 'p2', role: 'user' as const, text: 'ask ccwork', timestamp: '300000', source: 'local' as const, sessionKey: 'one', runId: 'r1' },
      { id: 'pre', role: 'narration' as const, text: 'delegating now', source: 'live' as const, sessionKey: 'one', runId: 'r1', state: 'streaming' as const },
    ];
    const authoritative: WorkspaceMessage = {
      id: 'pre', role: 'narration', text: 'delegating now', timestamp: '200000',
      source: 'history', sessionKey: 'one', runId: 'r1',
    };

    expect(upsertLiveMessage(current, authoritative).map((message) => message.id)).toEqual(['p1', 'pre', 'p2']);
  });

  it('coalesces chat and agent projections of the same tool-call identity', () => {
    const chat = projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', runId: 'r1', state: 'delta', message: { content: [{ type: 'toolCall', id: 't1', name: 'computer_use', arguments: { action: 'click' } }] } } }, 'one')!.message;
    const agent = projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'tool', data: { toolCallId: 't1', name: 'computer_use', phase: 'start', args: { action: 'click' } } } }, 'one')!.message;
    expect(chat.id).toBe('live-tool-r1-t1');
    expect(upsertLiveMessage(upsertLiveMessage([], chat), agent)).toHaveLength(1);
    expect(upsertLiveMessage(upsertLiveMessage([], chat), agent)[0]).toMatchObject({ role: 'tool', tool: { name: 'computer_use' } });
  });

  it.each([false, true])('keeps the current OpenClaw pre-tool chat flush separate from its sole agent tool projection (accepted prompt: %s)', (hasAcceptedPrompt) => {
    // Current OpenClaw flushes the buffered assistant text as `chat` before it
    // forwards the tool lifecycle as `agent`. Unlike the legacy BUG-073
    // producer, the chat payload contains no second projection of the tool.
    // These are the public shapes retained by the current upstream
    // server-chat agent-event contract.
    const chatFrame = {
      event: 'chat',
      payload: {
        sessionKey: 'one', runId: 'run-tool-flush', state: 'delta',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Before tool expanded' }], timestamp: 1_788_068_000_000 },
      },
    };
    const agentFrame = {
      event: 'agent',
      payload: {
        sessionKey: 'one', runId: 'run-tool-flush', stream: 'tool', ts: 1_788_068_000_001,
        data: { phase: 'start', name: 'read', toolCallId: 'tool-flush-1' },
      },
    };
    const chat = projectGatewayEvent(chatFrame, 'one')!.message;
    const agent = projectGatewayEvent(agentFrame, 'one')!.message;
    const prompt: WorkspaceMessage = { id: 'accepted-prompt', role: 'user', text: 'Read the file', runId: 'run-tool-flush', timestamp: '1788067999999' };
    const promptIDs = hasAcceptedPrompt ? [prompt.id] : [];
    let transcript: WorkspaceMessage[] = hasAcceptedPrompt ? [prompt] : [];

    for (let cycle = 0; cycle < 110; cycle += 1) {
      transcript = upsertLiveMessage(transcript, chat);
      transcript = upsertLiveMessage(transcript, agent);
      expect(transcript.map(({ id }) => id), `cycle ${cycle}`).toEqual([
        ...promptIDs,
        'live-chat-run-tool-flush',
        'live-tool-run-tool-flush-tool-flush-1',
      ]);
    }

    expect(transcript.filter(({ role }) => role !== 'user')).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'Before tool expanded', timestamp: '1788068000000' }),
      expect.objectContaining({ role: 'tool', text: 'read · running', tool: { name: 'read', summary: 'read · running' } }),
    ]);

    const final = projectGatewayEvent({
      event: 'chat',
      payload: {
        sessionKey: 'one', runId: 'run-tool-flush', state: 'final',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Final answer' }], timestamp: 1_788_068_000_002 },
      },
    }, 'one')!.message;
    transcript = upsertLiveMessage(transcript, final);
    expect(transcript.map(({ id }) => id)).toEqual([
      ...promptIDs,
      'live-tool-run-tool-flush-tool-flush-1',
      'live-chat-run-tool-flush',
    ]);
    expect(transcript.at(-1)).toMatchObject({ state: 'complete', text: 'Final answer', timestamp: '1788068000002' });
  });

  it('never attributes an internal child session stream to its selected parent', () => {
    expect(projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'agent:main:notes:active-memory:child', runId: 'memory', stream: 'tool', data: { name: 'memory_search', phase: 'result', result: 'private child output' } } }, 'agent:main:notes')).toBeNull();
  });

  it('routes a late frame to its registered origin after selection moved elsewhere', () => {
    const frame = { event: 'agent', payload: { sessionKey: 'thread-a', runId: 'run-a', stream: 'item', data: { kind: 'preamble', progressText: 'late A progress' } } };
    const projected = projectRegisteredGatewayEvent(frame, [
      { sessionKey: 'thread-a', path: '~/a' },
      { sessionKey: 'thread-b', path: '~/b' },
    ]);

    expect(projected).toMatchObject({ sessionKey: 'thread-a', message: { sessionKey: 'thread-a', runId: 'run-a', text: 'late A progress' } });
    expect(projected?.sessionKey).not.toBe('thread-b');
    expect(projectRegisteredGatewayEvent({ event: 'chat', payload: { sessionKey: 'unknown', runId: 'run-x', state: 'final', message: { content: 'private' } } }, [
      { sessionKey: 'thread-a', path: '~/a' },
      { sessionKey: 'thread-b', path: '~/b' },
    ])).toBeNull();
  });

  it('turns raw streamed tool metadata into a concise action and preserves it through completion', () => {
    const start = projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'tool', data: {
      toolCallId: 't-json', name: 'bash', phase: 'start', meta: '{"cmd":"pnpm vitest run src/transcript/transcriptVisibleRows.test.ts","env":{"SECRET":"hidden"}}',
      args: { cmd: 'pnpm vitest run src/transcript/transcriptVisibleRows.test.ts' },
    } } }, 'one')!.message;
    const result = projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'tool', data: {
      toolCallId: 't-json', name: 'bash', phase: 'result', result: { output: '{"very":"large raw result"}', durationMs: 900 },
    } } }, 'one')!.message;
    const [settled] = upsertLiveMessage(upsertLiveMessage([], start), result);

    expect(start.tool?.summary).toBe('bash · pnpm vitest run src/transcript/transcriptVisibleRows.test.ts');
    expect(settled?.tool?.summary).toBe(start.tool?.summary);
    expect(settled?.tool?.summary).not.toMatch(/[{}]/);
    expect(settled?.tool?.summary).not.toContain('SECRET');
  });

  it('never projects another session into the selected transcript', () => {
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'two', runId: 'r1', state: 'delta', message: { content: 'wrong' } } }, 'one')).toBeNull();
    expect(projectGatewayEvent({ event: 'chat', payload: { runId: 'r1', state: 'delta', message: { content: 'unowned' } } }, 'one')).toBeNull();
  });

  it('never merges run-less live frames under a shared unknown identity', () => {
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', state: 'delta', message: { content: 'unowned frame' } } }, 'one')).toBeNull();
    expect(projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', stream: 'item', data: { kind: 'preamble', progressText: 'unowned progress' } } }, 'one')).toBeNull();
    expect(projectGatewayEvent({ event: 'chat', payload: { sessionKey: 'one', state: 'delta', message: { content: 'still unowned' } } }, 'one', '')).toBeNull();
    expect(projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', stream: 'item', data: { runId: 'explicit-data-run', kind: 'preamble', progressText: 'owned progress' } } }, 'one')?.message).toMatchObject({ runId: 'explicit-data-run', text: 'owned progress' });
  });

  it('keeps actionable approval decisions scoped to the selected session', () => {
    const approval = projectGatewayEvent({ event: 'exec.approval.requested', payload: { id: 'a1', expiresAtMs: 42, request: { sessionKey: 'one', command: 'rm file', allowedDecisions: ['allow-once', 'deny'] } } }, 'one')?.message;
    expect(approval).toMatchObject({ role: 'approval', approval: { id: 'a1', kind: 'exec', allowedDecisions: ['allow-once', 'deny'], resolved: false, expiresAtMs: 42 } });
    expect(projectGatewayEvent({ event: 'exec.approval.requested', payload: { id: 'a2', request: { sessionKey: 'two' } } }, 'one')).toBeNull();
  });

  it('summarizes a structured approval request without printing its object braces', () => {
    const approval = projectGatewayEvent({ event: 'plugin.approval.requested', payload: { id: 'a3', request: { sessionKey: 'one', tool: 'browser', arguments: { action: 'open a review page', target: 'https://example.com' } } } }, 'one')?.message;
    expect(approval?.text.split('\n')[0]).toBe('open a review page');
    expect(approval?.text).toContain('"browser"');
    expect(transcriptMessageIsFoldedByDefault(approval!)).toBe(true);
  });

  it('summarizes a structured agent stream error without printing its object braces', () => {
    const failure = projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r9', stream: 'error', data: { code: 'tool_timeout', description: 'read timed out after 120s', toolCallId: 'call-9' } } }, 'one')?.message;
    expect(failure?.text.split('\n')[0]).toBe('read timed out after 120s');
    expect(failure?.text).toContain('"tool_timeout"');
    expect(transcriptMessageIsFoldedByDefault(failure!)).toBe(true);
  });

  it('reports a live tool result carrying isError as a failed row', () => {
    const failed = projectGatewayEvent({ event: 'agent', payload: { sessionKey: 'one', runId: 'r9', stream: 'tool', data: { phase: 'result', name: 'Bash', toolCallId: 'call-10', isError: true, result: 'cat: illegal option -- A' } } }, 'one')?.message;
    expect(failed).toMatchObject({ role: 'tool', state: 'error', tool: { name: 'Bash', summary: 'Bash · failed' } });
    expect(failed?.text).toBe('Bash · failed\ncat: illegal option -- A');
  });

  it('replays only selected-session approvals from the pending registry', () => {
    expect(pendingApprovalMessages([
      { id: 'a1', request: { sessionKey: 'one', title: 'Approve plugin', allowedDecisions: ['allow-once', 'deny'] }, expiresAtMs: 99 },
      { id: 'a2', request: { sessionKey: 'two', command: 'wrong session' } },
    ], 'plugin', 'one')).toEqual([expect.objectContaining({ id: 'live-approval-a1', approval: expect.objectContaining({ kind: 'plugin', expiresAtMs: 99 }) })]);
  });

  it('marks an approval absent from the recovered registry as settled', () => {
    const current = [projectGatewayEvent({ event: 'exec.approval.requested', payload: { id: 'gone', request: { sessionKey: 'one', command: 'pwd' } } }, 'one')!.message];
    expect(reconcilePendingApprovalMessages(current, [], 'one')[0]).toMatchObject({ text: 'approval resolved on another surface · refreshing run outcome', state: 'complete', approval: { resolved: true, outcome: 'resolved-externally', allowedDecisions: [] } });
  });
});
