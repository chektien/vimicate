import { upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { runLifecycleMessageID } from '../gateway/runCompletionMessage';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const SESSION_KEY = 'fixture-flashlist-terminal-publication';
const RUN_ID = 'terminal-stress-run';
const SETTLE_TICK = 90;
const CANONICAL_TICK = 98;
const LATE_FINAL_TICK = 106;

type ToolShape = readonly [callBytes: number, resultBytes: number, resultLines: number];

// Content-free measurements from the preserved incident. These retain the
// exact projected text lengths and wrapping pressure without storing private
// transcript text in source control. Every call occupied one source line.
const TOOL_SHAPES: readonly ToolShape[] = [
  [216, 1_039, 32], [132, 9_766, 236], [938, 195, 3], [125, 85, 1],
  [125, 936, 5], [125, 85, 1], [170, 1_689, 23], [127, 96, 2],
  [125, 85, 1], [125, 85, 1], [125, 85, 1], [125, 86, 1],
  [125, 86, 1], [125, 86, 1], [125, 86, 1], [125, 86, 1],
  [125, 936, 5], [147, 7_095, 93], [261, 1_602, 17], [491, 4_812, 34],
  [125, 85, 1], [125, 204, 1], [197, 5_263, 42],
];

const TOOL_TIMESTAMPS: readonly (readonly [call: number, result: number])[] = [
  [1_788_156_175_183, 1_788_156_175_186], [1_788_156_181_195, 1_788_156_181_199],
  [1_788_156_190_944, 1_788_156_296_408], [1_788_156_230_296, 1_788_156_230_300],
  [1_788_156_234_655, 1_788_156_234_658], [1_788_156_238_891, 1_788_156_238_895],
  [1_788_156_243_587, 1_788_156_246_575], [1_788_156_252_192, 1_788_156_252_338],
  [1_788_156_259_275, 1_788_156_265_746], [1_788_156_277_525, 1_788_156_277_528],
  [1_788_156_289_330, 1_788_156_289_334], [1_788_156_301_165, 1_788_156_301_168],
  [1_788_156_318_037, 1_788_156_318_043], [1_788_156_329_814, 1_788_156_329_817],
  [1_788_156_341_619, 1_788_156_341_622], [1_788_156_353_411, 1_788_156_353_414],
  [1_788_156_368_017, 1_788_156_368_021], [1_788_156_373_413, 1_788_156_396_302],
  [1_788_156_401_576, 1_788_156_402_177], [1_788_156_412_769, 1_788_156_454_547],
  [1_788_156_449_144, 1_788_156_449_147], [1_788_156_458_915, 1_788_156_458_919],
  [1_788_156_463_458, 1_788_156_463_461],
];

// The durable snapshot was not strictly alternating: two pairs completed out
// of call order. Preserve that exact recycler insertion order.
const SNAPSHOT_ORDER = (
  'c0 r0 c1 r1 c2 c3 r3 c4 r4 c5 r5 c6 r6 c7 r7 c8 r8 c9 r9 c10 r10 r2 '
  + 'c11 r11 c12 r12 c13 r13 c14 r14 c15 r15 c16 r16 c17 r17 c18 r18 '
  + 'c19 c20 r20 r19 c21 r21 c22 r22'
).split(' ');

type PublicationCache = {
  running?: WorkspaceMessage[];
  complete?: WorkspaceMessage[];
  canonical?: WorkspaceMessage[];
  lateFinal?: WorkspaceMessage[];
};

let cachedPressureHistory: WorkspaceMessage[] | null = null;
const currentGenerationCache: PublicationCache = {};
const crossIncidentPressureCache: PublicationCache = {};

function shapedText(length: number, lineCount: number) {
  const separators = Math.max(0, lineCount - 1);
  const characters = Math.max(lineCount, length - separators);
  const width = Math.floor(characters / lineCount);
  const remainder = characters % lineCount;
  return Array.from({ length: lineCount }, (_, index) =>
    'x'.repeat(width + (index < remainder ? 1 : 0))).join('\n');
}

function tool(index: number, source: 'history' | 'live', runId: string, length: number, lines: number): WorkspaceMessage {
  return {
    id: `terminal-stress-${source}-tool-${index}`, role: 'tool',
    text: shapedText(length, lines), source, state: 'complete',
    sessionKey: SESSION_KEY, runId,
    tool: { name: 'bash', summary: `bash · ${'physical transcript audit '.repeat((index % 4) + 1).trim()}` },
    timestamp: `2026-08-29T15:${String(index % 60).padStart(2, '0')}:01Z`,
  };
}

function retainedPressureHistory() {
  // These count/role facts belong to the separate 29 August BUG-230 incident.
  // Its byte/line dimensions were content-free pressure approximations. Keep
  // them useful for stress without presenting them as part of the 31 August
  // generation reconstructed below.
  return cachedPressureHistory ??= [
    { id: 'terminal-stress-old-narration', role: 'narration', text: shapedText(196, 1), source: 'history', state: 'complete', sessionKey: SESSION_KEY, runId: 'retained-run-1', timestamp: '2026-08-29T15:00:00Z' },
    ...Array.from({ length: 37 }, (_, index) => tool(index, 'history', 'retained-run-1', index % 11 === 0 ? 12_023 : 150 + ((index * 613) % 10_400), 5 + ((index * 17) % 177))),
    { id: 'terminal-stress-old-answer-1', role: 'assistant', text: shapedText(256, 6), source: 'history', state: 'complete', sessionKey: SESSION_KEY, runId: 'retained-run-1', timestamp: '2026-08-29T15:38:00Z' },
    { id: 'terminal-stress-old-prompt', role: 'user', text: 'done', source: 'history', state: 'complete', sessionKey: SESSION_KEY, runId: 'retained-run-2', timestamp: '2026-08-29T15:39:00Z' },
    ...Array.from({ length: 40 }, (_, offset) => {
      const index = offset + 37;
      return tool(index, 'history', 'retained-run-2', index % 13 === 0 ? 12_023 : 160 + ((index * 487) % 9_900), 5 + ((index * 19) % 176));
    }),
    { id: 'terminal-stress-old-answer-2', role: 'assistant', text: shapedText(273, 4), source: 'history', state: 'complete', sessionKey: SESSION_KEY, runId: 'retained-run-2', timestamp: '2026-08-29T15:54:00Z' },
    { id: runLifecycleMessageID(SESSION_KEY, 'retained-run-2'), role: 'run', text: '✓ done in 2m 36s', source: 'history', state: 'complete', sessionKey: SESSION_KEY, runId: 'retained-run-2', timestamp: '2026-08-29T15:54:00Z' },
  ];
}

function runningMessages(history: WorkspaceMessage[], cache: PublicationCache) {
  return cache.running ??= [
    ...history,
    { id: 'terminal-stress-current-prompt', role: 'user', text: shapedText(559, 10), source: 'local', state: 'complete', sessionKey: SESSION_KEY, runId: RUN_ID, timestamp: '2026-08-31T06:02:40.268Z' },
    { id: 'terminal-stress-current-narration-1', role: 'narration', text: shapedText(181, 1), source: 'live', state: 'complete', sessionKey: SESSION_KEY, runId: RUN_ID, timestamp: '2026-08-31T06:02:41Z' },
    ...TOOL_SHAPES.slice(0, 7).map(([, resultBytes, resultLines], index): WorkspaceMessage => ({
      ...tool(100 + index, 'live', RUN_ID, resultBytes + 5, resultLines + 1),
      id: `live-tool-${RUN_ID}-exec-fixture-${index}`,
      state: index < TOOL_SHAPES.length - 3 ? 'complete' : 'streaming',
      timestamp: String(TOOL_TIMESTAMPS[index]![0]),
    })),
    { id: 'terminal-stress-current-narration-2', role: 'narration', text: shapedText(273, 1), source: 'live', state: 'complete', sessionKey: SESSION_KEY, runId: RUN_ID, timestamp: '2026-08-31T06:04:00Z' },
    ...TOOL_SHAPES.slice(7).map(([, resultBytes, resultLines], offset): WorkspaceMessage => {
      const index = offset + 7;
      return {
        ...tool(100 + index, 'live', RUN_ID, resultBytes + 5, resultLines + 1),
        id: `live-tool-${RUN_ID}-exec-fixture-${index}`,
        state: index < TOOL_SHAPES.length - 3 ? 'complete' : 'streaming',
        timestamp: String(TOOL_TIMESTAMPS[index]![0]),
      };
    }),
    { id: runLifecycleMessageID(SESSION_KEY, RUN_ID), role: 'run', text: 'start', source: 'live', state: 'streaming', sessionKey: SESSION_KEY, runId: RUN_ID, timestamp: '2026-08-31T06:02:40.803Z' },
  ];
}

function canonicalTools() {
  return SNAPSHOT_ORDER.map((token): WorkspaceMessage => {
    const phase = token[0] === 'c' ? 'call' : 'result';
    const index = Number(token.slice(1));
    const [callBytes, resultBytes, resultLines] = TOOL_SHAPES[index]!;
    const [callTimestamp, resultTimestamp] = TOOL_TIMESTAMPS[index]!;
    return {
      ...tool(200 + index * 2 + (phase === 'result' ? 1 : 0), 'history', RUN_ID,
        phase === 'call' ? callBytes : resultBytes, phase === 'call' ? 1 : resultLines),
      id: `terminal-stress-history-${phase}-${index}`,
      idempotencyKey: `codex:session:run:tool:exec-fixture-${index}:${phase}`,
      timestamp: String(phase === 'call' ? callTimestamp : resultTimestamp),
    };
  });
}

function terminalPublicationFixture(
  streamTick: number,
  history: WorkspaceMessage[],
  cache: PublicationCache,
): WorkspaceMessage[] {
  const running = runningMessages(history, cache);
  if (streamTick < SETTLE_TICK) return running;
  const finalText = shapedText(553, 7);
  const complete = cache.complete ??= running.map((message) => {
    if (message.runId !== RUN_ID) return message;
    if (message.role === 'tool' && message.state === 'streaming') return { ...message, state: 'complete' as const, tool: { ...message.tool!, durationMs: 2_300 } };
    if (message.role === 'run') return { ...message, text: '✓ done in 5m 15s', state: 'complete' as const, timestamp: '2026-08-31T06:07:55.155Z' };
    return message;
  });
  if (streamTick < CANONICAL_TICK) return complete;
  const canonical = cache.canonical ??= mergeLatestHistory([
    ...history,
    { ...running[history.length]!, source: 'history' as const, idempotencyKey: `${RUN_ID}:user` },
    ...canonicalTools(),
    { id: 'terminal-stress-history-final', role: 'assistant', text: finalText, source: 'history', state: 'complete', sessionKey: SESSION_KEY, timestamp: '2026-08-31T06:07:55.155Z', idempotencyKey: 'codex:session:run:assistant' },
  ], complete, SESSION_KEY);
  if (streamTick < LATE_FINAL_TICK) return canonical;
  return cache.lateFinal ??= upsertLiveMessage(canonical, {
    id: `live-chat-${RUN_ID}`, role: 'assistant', text: finalText,
    source: 'live', state: 'complete', sessionKey: SESSION_KEY, runId: RUN_ID,
    timestamp: '2026-08-31T06:07:55.155Z',
  });
}

/** Replays only the preserved 31 August generation, without an inferred tail. */
export function flashListTerminalPublicationFixture(streamTick: number): WorkspaceMessage[] {
  return terminalPublicationFixture(streamTick, [], currentGenerationCache);
}

/** Combines the known generation with the older incident's cache pressure. */
export function flashListTerminalPublicationPressureFixture(streamTick: number): WorkspaceMessage[] {
  return terminalPublicationFixture(streamTick, retainedPressureHistory(), crossIncidentPressureCache);
}
