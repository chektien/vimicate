// Replay steps for the isolated stacked-fix audit QA entry. Wire shapes and
// timestamps are copied from the lead's regression tests:
// toolBoundaryLiveSeal, steeredPromptMidRunRefresh, steerAfterToolSeal and
// livePreambleChatConvergence. Never imported by the production App entry.

export type AuditDriver = {
  /** Cumulative, untimed chat frame (Claude CLI shape). */
  chat: (text: string, state?: 'delta' | 'final') => void;
  /** Codex/OpenClaw chat frame with a typed content array. */
  typedChat: (text: string, state?: 'delta' | 'final') => void;
  tool: (id: string, ts: number, phase?: 'start' | 'result') => void;
  preamble: (text: string, itemId: string) => void;
  /** The run's end receipt. The Gateway names the terminal reply on it, ahead of the final chat frame. */
  lifecycleEnd: (terminalReply?: string) => void;
  /** Flush the publication buffer as the workspace publication timer would. */
  publish: () => void;
  /** The workspace's terminal publication: settle tools and reconcile the run footer. */
  terminal: () => void;
  prompt: (text: string, idempotencyKey: string, timestamp: number, runId?: string, id?: string) => void;
  steer: (text: string, idempotencyKey: string, timestamp: number) => void;
  refresh: (messages: unknown[]) => Promise<void>;
};
export type AuditStep = { name: string; run: (d: AuditDriver) => void | Promise<void> };
export type AuditScenario = { id: string; runtime: string; runId: string; steps: AuditStep[] };

const at = (offset: number) => 1_700_000_000_000 + offset;
const source = 'fixture-source';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const positioned = (id: string, content: string, timestamp: number, rawSeq: number) => ({ role: 'user', content, timestamp,
  idempotencyKey: `${id}:user`, __openclaw: { id, idempotencyKey: `${id}:user`, transcriptPosition: { source, rawSeq } } });

// Scenario 1, toolBoundaryLiveSeal: commentary, tool, commentary, tool, answer.
const one = 'Checking the live path.';
const two = 'Found the gap. Reading the docs next.';
const answer = 'Both answers are below.';
const s1: AuditScenario = { id: 's1', runtime: 'claude-cli', runId: 'run-claude', steps: [
  { name: 'prompt', run: d => d.prompt('Start.', 'first', at(1000), 'run-claude') },
  { name: 'commentary-one', run: d => { d.chat(one); d.publish(); } },
  { name: 'tool-t0-start', run: d => { d.tool('t0', 1100); d.publish(); } },
  { name: 'tool-t0-result-t1-start', run: d => { d.tool('t0', 1150, 'result'); d.tool('t1', 1200); d.publish(); } },
  { name: 'commentary-two-partial', run: d => { d.chat(`${one}\n\n${two.slice(0, 14)}`); d.publish(); } },
  { name: 'commentary-two', run: d => { d.chat(`${one}\n\n${two}`); d.publish(); } },
  { name: 'tool-t2-start', run: d => { d.tool('t2', 1300); d.publish(); } },
  { name: 'answer-delta', run: d => { d.chat(`${one}\n\n${two}\n\n${answer}`); d.publish(); } },
  { name: 'answer-final', run: d => { d.chat(`${one}\n\n${two}\n\n${answer}`, 'final'); d.publish(); } },
] };

// Scenario 2, steeredPromptMidRunRefresh with untimed chat and a first
// prompt whose history row carries no run identity.
const promptsOnly = [positioned('first', 'First request.', at(1000), 10), positioned('steer', 'Second request.', at(2500), 11)];
const resultTool = (d: AuditDriver, id: string, ts: number) => { d.tool(id, ts, 'result'); d.publish(); };
const s2: AuditScenario = { id: 's2', runtime: 'claude-cli', runId: 'run-claude', steps: [
  { name: 'history-first-prompt', run: d => d.refresh([positioned('first', 'First request.', at(1000), 10)]) },
  { name: 'tools-a', run: d => { resultTool(d, 'a0', 1100); resultTool(d, 'a1', 1200); resultTool(d, 'a2', 1300); } },
  { name: 'commentary', run: d => { d.chat('Still investigating.'); d.publish(); } },
  { name: 'tools-b', run: d => { resultTool(d, 'b0', 2100); resultTool(d, 'b1', 2200); } },
  { name: 'steer', run: d => d.steer('Second request.', 'steer', at(2500)) },
  { name: 'reply-after-steer', run: d => { d.chat('Still investigating.\n\nNoted the second request.'); d.publish(); } },
  { name: 'tools-c', run: d => { resultTool(d, 'c0', 2700); resultTool(d, 'c1', 2800); } },
  { name: 'refresh-prompts-only', run: d => d.refresh(promptsOnly) },
  { name: 'refresh-prompts-only-again', run: d => d.refresh(promptsOnly) },
] };

// Scenarios 3 and 4 use synthetic data for mid-turn steer adoption.
const runId3 = 'fixture-steer-run';
const commentary = 'Inspecting the sample before the queued update.';
const reply = 'The second sample is included in this result.';
const first = { role: 'user', content: 'Inspect the sample.', timestamp: 1700000000257, idempotencyKey: `${runId3}:user`,
  __openclaw: { id: 'p1', idempotencyKey: `${runId3}:user`, recordTimestampMs: 1700000000300, transcriptPosition: { source, rawSeq: 10 }, importedFrom: 'claude-cli', cliSessionId, externalId: 'ext-p1' } };
const step = { role: 'assistant', timestamp: 1700000006433, content: [{ type: 'text', text: commentary }], stopReason: 'tool_use', api: 'anthropic-messages', provider: 'claude-cli',
  __openclaw: { id: 'step-text', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-text' } };
const call = { role: 'assistant', timestamp: 1700000007252, stopReason: 'tool_use', api: 'anthropic-messages', provider: 'claude-cli',
  content: [{ type: 'toolcall', id: 'toolu_1', name: 'exec', arguments: {} }, { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'finished' }], name: 'exec' }],
  __openclaw: { id: 'step-tool', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-tool' } };
const steer = { role: 'user', content: 'Include the second sample.', timestamp: 1700000025909, idempotencyKey: 'fixture-steer-prompt:user',
  __openclaw: { id: 'p2', idempotencyKey: 'fixture-steer-prompt:user', steerTargetRunId: runId3, recordTimestampMs: 1700000025950, transcriptPosition: { source, rawSeq: 11 } } };
const saved = { role: 'assistant', timestamp: 1700000061156, content: [{ type: 'text', text: reply }], stopReason: 'end_turn', api: 'anthropic-messages', provider: 'claude-cli',
  __openclaw: { id: 'step-answer', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-answer' } };
const steerAdoptedSteps: AuditStep[] = [
  { name: 'prompt-and-history', run: async d => { d.prompt('Inspect the sample.', runId3, 1700000000200, runId3); await d.refresh([first]); } },
  { name: 'commentary', run: d => { d.chat(commentary); d.publish(); } },
  { name: 'tool-start', run: d => { d.tool('toolu_1', 1700000007300 - at(0)); d.publish(); } },
  { name: 'steer', run: d => d.steer('Include the second sample.', 'fixture-steer-prompt', 1700000025800) },
  { name: 'tool-result', run: d => { d.tool('toolu_1', 1700000057300 - at(0), 'result'); d.publish(); } },
  { name: 'refresh-mid-turn', run: d => d.refresh([first, step, call, steer]) },
  { name: 'commentary-repeat', run: d => { d.chat(commentary); d.publish(); } },
  { name: 'reply-delta', run: d => { d.chat(`${commentary}\n\n${reply.slice(0, 10)}`); d.publish(); } },
  { name: 'reply-final', run: d => { d.chat(`${commentary}\n\n${reply}`, 'final'); d.publish(); } },
];
const s3: AuditScenario = { id: 's3', runtime: 'claude-cli', runId: runId3, steps: steerAdoptedSteps };
const s4: AuditScenario = { id: 's4', runtime: 'claude-cli', runId: runId3, steps: [...steerAdoptedSteps,
  { name: 'run-footer', run: d => { d.lifecycleEnd(); d.terminal(); } },
  { name: 'refresh-turn-end', run: d => d.refresh([first, step, call, steer, saved]) },
] };

// Scenario 5: Codex-style item preambles, no Claude CLI runtime.
const s5: AuditScenario = { id: 's5', runtime: 'codex', runId: 'run-codex', steps: [
  { name: 'prompt', run: d => d.prompt('Start.', 'first', at(1000), 'run-codex') },
  { name: 'preamble-one', run: d => { d.typedChat(one); d.preamble(one, 'commentary-0'); d.publish(); } },
  { name: 'tool-t0', run: d => { d.tool('t0', 1100); d.tool('t0', 1150, 'result'); d.publish(); } },
  { name: 'preamble-two', run: d => { d.typedChat(`${one}\n\n${two}`); d.preamble(two, 'commentary-1'); d.publish(); } },
  { name: 'tool-t1', run: d => { d.tool('t1', 1200); d.tool('t1', 1250, 'result'); d.publish(); } },
  // Protocol wire order places lifecycle end with its
  // terminal reply, then the final chat frame. The earlier baseline sent no receipt.
  { name: 'answer-final', run: d => { d.lifecycleEnd(answer); d.typedChat(`${one}\n\n${two}\n\n${answer}`, 'final'); d.terminal(); } },
] };

export const auditScenarios: Record<string, AuditScenario> = { s1, s2, s3, s4, s5 };
export const auditEpoch = at(0);
