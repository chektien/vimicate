import { SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE, simulatorWorkspaceMediaMessages } from './simulatorWorkspaceMediaFixtures';
import { richTranscriptFixture } from '../transcript/richTranscriptFixture';
import { imageStreamFixture } from '../transcript/imageStreamFixture';
import { lateFinalReplayFixture } from '../transcript/lateFinalReplayFixture';
import { streamingHistoryHandoffFixture } from '../transcript/streamingHistoryHandoffFixture';
import { finalAnswerAuthorityFixture } from '../transcript/finalAnswerAuthorityFixture';
import { agentToolActivityFixture } from '../transcript/agentToolActivityFixture';
import { embeddedToolProtocolFixture } from '../transcript/embeddedToolProtocolFixture';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { mergeLatestHistory, mergeOlderHistory } from '../gateway/historyPagination';
import { appendConversationBoundary } from '../gateway/conversationBoundaries';
import { messagesOwnedBySessionGeneration } from '../gateway/sessionGenerationPublication';
import { upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { reconcileFailedRunWait } from '../gateway/runWaitSettlement';
import { runLifecycleMessageID } from '../gateway/runCompletionMessage';
import {
  flashListTerminalPublicationFixture,
  flashListTerminalPublicationPressureFixture,
} from './terminalPublicationStressFixture';
import { acceptedPromptWindowStressFixture } from './acceptedPromptWindowStressFixture';
import { SIMULATOR_TRANSCRIPT_FIXTURE_MODE, simulatorTranscriptFixtureMessages } from './simulatorTranscriptFixtures';
import { QUESTION_PROMPT_FIXTURE_MODE, questionPromptFixtureMessages } from './questionPromptFixture';

export type VimicateUIFixtureMode =
  | 'qa-transcript-v1'
  | 'qa-workmedia-v1'
  | 'rich-transcript'
  | 'image-stream-limits'
  | 'late-final-replay'
  | 'canonical-first-live'
  | 'streaming-history-handoff'
  | 'final-answer-authority'
  | 'connecting-layout'
  | 'send-latency'
  | 'fold-navigation'
  | 'chronology-merge'
  | 'steering-chronology'
  | 'repeated-steering-chronology'
  | 'gateway-history-chronology'
  | 'gateway-paged-history-chronology'
  | 'session-generation-chronology'
  | 'unmatched-live-chronology'
  | 'restored-orphan-live-chronology'
  | 'authoritative-live-reposition-chronology'
  | 'failed-run-settlement'
  | 'failed-run-settlement-transition'
  | 'qa-failed-v1'
  | 'prompt-attachment-geometry-transition'
  | 'remote-file-link'
  | 'agent-tool-activity'
  | 'embedded-tool-protocol'
  | 'attention-unread'
  | 'streaming-transcript'
  | 'streaming-input-stress'
  | 'physical-transcript-pressure'
  | 'accepted-prompt-window-stress'
  | 'queued-prompt-streaming-stress'
  | 'flashlist-live-publication-stress'
  | 'flashlist-terminal-publication-stress'
  | 'flashlist-terminal-publication-pressure';

type FixtureFactories = {
  longFoldedTool: () => WorkspaceMessage;
  longFoldedConversation: () => WorkspaceMessage;
};

const defaultFactories: FixtureFactories = {
  longFoldedTool: () => ({
    id: 'fixture-long-tool',
    role: 'tool',
    text: Array.from({ length: 20_000 }, (_, index) => `internal tool detail ${index + 1}`).join('\n'),
    state: 'complete',
    tool: { name: 'bash', summary: 'bash · inspect archived transcript' },
    timestamp: '2026-08-25T08:25:00+08:00',
  }),
  longFoldedConversation: () => ({
    id: 'fixture-long-conversation',
    role: 'assistant',
    text: ['# Long response', ...Array.from({ length: 619 }, (_, index) => `Detail ${index + 1}: folded navigation keeps one visible cursor stop.`)].join('\n'),
    state: 'complete',
    timestamp: '2026-08-25T08:26:00+08:00',
  }),
};

let cachedFlashListStableMessages: WorkspaceMessage[] | null = null;
const cachedFlashListCompletedLiveMessages = new Map<number, WorkspaceMessage>();
let cachedPhysicalPressureTool: WorkspaceMessage | null = null;
export const FAILED_WAIT_SETTLEMENT_TICK = 39;

/**
 * Heavy UI fixtures are test-only data and must never be allocated while the
 * ordinary app module is starting. Select the fixture first, then construct
 * only the payload needed by that explicit mode.
 */
export function fixtureMessagesForMode(
  fixtureMode: string | undefined,
  streamTick: number,
  factories: FixtureFactories = defaultFactories,
): WorkspaceMessage[] | undefined {
  if (fixtureMode === SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE) return simulatorWorkspaceMediaMessages(streamTick);
  if (fixtureMode === SIMULATOR_TRANSCRIPT_FIXTURE_MODE) return simulatorTranscriptFixtureMessages();
  if (fixtureMode === QUESTION_PROMPT_FIXTURE_MODE) return questionPromptFixtureMessages();
  if (fixtureMode === 'image-stream-limits') return imageStreamFixture();
  if (fixtureMode === 'late-final-replay') return lateFinalReplayFixture();
  if (fixtureMode === 'canonical-first-live') return lateFinalReplayFixture('canonical-first');
  if (fixtureMode === 'streaming-history-handoff') return streamingHistoryHandoffFixture();
  if (fixtureMode === 'final-answer-authority') return finalAnswerAuthorityFixture();
  if (fixtureMode === 'rich-transcript' || fixtureMode === 'connecting-layout' || fixtureMode === 'interaction-polish' || fixtureMode === 'attention-unread' || fixtureMode === 'prompt-attachment-geometry-transition') return richTranscriptFixture;
  if (fixtureMode === 'send-latency') return [factories.longFoldedTool(), ...richTranscriptFixture];
  if (fixtureMode === 'fold-navigation') return [richTranscriptFixture[0]!, factories.longFoldedConversation(), ...richTranscriptFixture.slice(2)];
  if (fixtureMode === 'chronology-merge') return latePreambleChronologyFixture();
  if (fixtureMode === 'steering-chronology') return steeringChronologyFixture();
  if (fixtureMode === 'repeated-steering-chronology') return repeatedSteeringChronologyFixture();
  if (fixtureMode === 'gateway-history-chronology') return gatewayHistoryChronologyFixture();
  if (fixtureMode === 'gateway-paged-history-chronology') return gatewayPagedHistoryChronologyFixture();
  if (fixtureMode === 'session-generation-chronology') return sessionGenerationChronologyFixture();
  if (fixtureMode === 'unmatched-live-chronology') return unmatchedLiveChronologyFixture();
  if (fixtureMode === 'restored-orphan-live-chronology') return restoredOrphanLiveChronologyFixture();
  if (fixtureMode === 'authoritative-live-reposition-chronology') return authoritativeLiveRepositionChronologyFixture();
  if (fixtureMode === 'failed-run-settlement') return failedRunSettlementFixture(true);
  if ((fixtureMode === 'failed-run-settlement-transition' || fixtureMode === 'qa-failed-v1')) {
    return failedRunSettlementFixture(streamTick >= FAILED_WAIT_SETTLEMENT_TICK);
  }
  if (fixtureMode === 'remote-file-link') return remoteFileLinkFixture();
  if (fixtureMode === 'agent-tool-activity') return agentToolActivityFixture();
  if (fixtureMode === 'embedded-tool-protocol') return embeddedToolProtocolFixture();
  if (fixtureMode === 'physical-transcript-pressure') {
    const tool = factories === defaultFactories
      ? cachedPhysicalPressureTool ??= factories.longFoldedTool()
      : factories.longFoldedTool();
    const rich = streamingRichTranscript(streamTick, true);
    const media = rich.find((message) => message.id === 'fixture-media');
    return [tool, ...(media ? [media] : []), ...rich.filter((message) => message !== media)];
  }
  if (fixtureMode === 'accepted-prompt-window-stress') return acceptedPromptWindowStressFixture(streamTick);
  if (fixtureMode === 'queued-prompt-streaming-stress') return queuedPromptStreamingFixture(streamTick);
  if (fixtureMode === 'flashlist-live-publication-stress') return flashListLivePublicationFixture(streamTick);
  if (fixtureMode === 'flashlist-terminal-publication-stress') return flashListTerminalPublicationFixture(streamTick);
  if (fixtureMode === 'flashlist-terminal-publication-pressure') return flashListTerminalPublicationPressureFixture(streamTick);
  if (!isStreamingUIFixtureMode(fixtureMode)) return undefined;
  return streamingRichTranscript(streamTick);
}

function streamingRichTranscript(streamTick: number, delayedMediaGeometry = false) {
  return richTranscriptFixture.map((message) => {
    if (message.id === 'fixture-answer') return {
      ...message,
      state: 'streaming' as const,
      text: `${message.text.replace('## Transcript structure', `## Transcript structure · update ${streamTick}`)}\n${Array.from({ length: streamTick }, (_, index) => `Streaming response line ${index + 1}: viewport tail ownership remains stable.`).join('\n')}`,
    };
    if (!delayedMediaGeometry || message.id !== 'fixture-media') return message;
    if (!message.attachments) return message;
    return {
      ...message,
      attachments: message.attachments.map((attachment) => {
        const { pixelWidth: _pixelWidth, pixelHeight: _pixelHeight, ...unresolved } = attachment;
        return streamTick < 240
          ? unresolved
          : { ...unresolved, pixelWidth: 2048, pixelHeight: 1536 };
      }),
    };
  });
}

function failedRunSettlementFixture(settled: boolean): WorkspaceMessage[] {
  const sessionKey = 'fixture-failed-wait';
  const runId = 'failed-wait-run';
  const active: WorkspaceMessage[] = [
    {
      id: 'failed-wait-prompt', role: 'user', text: 'Run the guarded verification.',
      source: 'local', state: 'complete', sessionKey, runId,
      timestamp: '2026-08-29T02:40:00+08:00',
    },
    {
      id: 'failed-wait-narration', role: 'narration',
      text: 'I\'ll verify the requested state and retain a visible terminal result.',
      source: 'live', state: 'streaming', sessionKey, runId,
      timestamp: '2026-08-29T02:40:01+08:00',
    },
    {
      id: 'failed-wait-tool', role: 'tool', text: 'verify\nchecking authoritative state',
      source: 'live', state: 'streaming', sessionKey, runId,
      tool: { name: 'verify', summary: 'verify · authoritative state' },
      timestamp: '2026-08-29T02:40:02+08:00',
    },
    {
      id: runLifecycleMessageID(sessionKey, runId), role: 'run', text: 'start',
      source: 'live', state: 'streaming', sessionKey, runId,
      timestamp: '2026-08-29T02:40:00+08:00',
    },
  ];
  if (!settled) return active;
  return reconcileFailedRunWait(active, sessionKey, runId, {
    runId,
    status: 'failed',
    error: 'authoritative verification failed',
    startedAt: Date.parse('2026-08-29T02:40:00+08:00'),
    endedAt: Date.parse('2026-08-29T02:40:07+08:00'),
  }, 7_000);
}

function authoritativeLiveRepositionChronologyFixture() {
  const sessionKey = 'fixture-authoritative-reposition';
  const current: WorkspaceMessage[] = [
    { id: 'first-prompt', role: 'user', text: 'edit the saved file', timestamp: '100000', source: 'local', sessionKey, runId: 'shared-run' },
    { id: 'second-prompt', role: 'user', text: 'also ask ccwork to check the formatting', timestamp: '300000', source: 'local', sessionKey, runId: 'shared-run' },
    { id: 'preamble', role: 'narration', text: "I'll update the document before delegating its review.", source: 'live', sessionKey, runId: 'shared-run', state: 'streaming' },
  ];
  return upsertLiveMessage(current, {
    id: 'preamble', role: 'narration', text: "I'll update the document before delegating its review.",
    timestamp: '200000', source: 'history', sessionKey, runId: 'shared-run',
  });
}

export function isStreamingUIFixtureMode(fixtureMode: string | undefined) {
  return fixtureMode === 'streaming-transcript'
    || fixtureMode === 'streaming-input-stress'
    || fixtureMode === 'physical-transcript-pressure'
    || fixtureMode === 'accepted-prompt-window-stress'
    || fixtureMode === 'queued-prompt-streaming-stress'
    || fixtureMode === 'flashlist-live-publication-stress'
    || fixtureMode === 'flashlist-terminal-publication-stress'
    || fixtureMode === 'flashlist-terminal-publication-pressure'
    || (fixtureMode === 'failed-run-settlement-transition' || fixtureMode === 'qa-failed-v1');
}

export function fixtureTickingForMode(fixtureMode: string | undefined) {
  return isStreamingUIFixtureMode(fixtureMode)
    || fixtureMode === SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE
    || fixtureMode === 'prompt-attachment-geometry-transition';
}

export function fixtureRunActiveForMode(fixtureMode: string | undefined, streamTick: number) {
  if ((fixtureMode === 'failed-run-settlement-transition' || fixtureMode === 'qa-failed-v1')) return streamTick < FAILED_WAIT_SETTLEMENT_TICK;
  return isStreamingUIFixtureMode(fixtureMode);
}

/**
 * Mirrors the physical fatal's list shape without touching a real Gateway
 * session: a heterogeneous 412-row mounted tail receives one fresh live row
 * per display interval. Every item keeps a stable identity while the data
 * array grows, matching the publication pressure that preceded the crash.
 */
function flashListLivePublicationFixture(streamTick: number): WorkspaceMessage[] {
  const sessionKey = 'fixture-flashlist-live-publication';
  const stable = cachedFlashListStableMessages ??= Array.from({ length: 412 }, (_, index): WorkspaceMessage => {
    if (index % 7 === 0) return {
      id: `stable-tool-${index}`,
      role: 'tool',
      text: `bash\ncommand ${index}\nresult ${index}`,
      source: 'history',
      state: 'complete',
      sessionKey,
      runId: `stable-run-${Math.floor(index / 7)}`,
      tool: { name: 'bash', summary: `bash · inspect row ${index}`, durationMs: index + 1 },
      timestamp: `2026-08-28T04:${String(index % 60).padStart(2, '0')}:00Z`,
    };
    const role = index % 5 === 0 ? 'user' as const : 'assistant' as const;
    return {
      id: `stable-${index}`,
      role,
      text: role === 'user'
        ? `Stable prompt ${index}`
        : `Stable response ${index}: ${'heterogeneous wrapped content '.repeat((index % 4) + 1).trim()}`,
      source: 'history',
      state: 'complete',
      sessionKey,
      runId: `stable-run-${Math.floor(index / 7)}`,
      timestamp: `2026-08-28T04:${String(index % 60).padStart(2, '0')}:01Z`,
    };
  });
  // Reach 480 stable keys, then revise fixed-width text every 16 ms.
  // A monotonic label avoids aliasing separate XCTest observations.
  const liveCount = Math.min(streamTick, 68);
  const live = Array.from({ length: liveCount }, (_, index): WorkspaceMessage => {
    const revisingAtBound = liveCount === 68 && index === 67;
    const message = {
      id: `live-${index}`,
      role: index % 3 === 0 ? 'tool' as const : 'narration' as const,
      text: index % 3 === 0
        ? `bash\nlive command ${index}\nlive result ${index}`
        : revisingAtBound
          ? `Live publication ${index}: revision ${String(streamTick).padStart(4, '0')} remains at the stable tail.`
          : `Live publication ${index}: retained at the authoritative tail.`,
      source: 'live' as const,
      state: index === liveCount - 1 ? 'streaming' as const : 'complete' as const,
      sessionKey,
      runId: 'active-live-run',
      ...(index % 3 === 0 ? { tool: { name: 'bash', summary: `bash · live row ${index}`, durationMs: 16 } } : {}),
      timestamp: `2026-08-28T06:45:${String(index % 60).padStart(2, '0')}Z`,
    };
    if (message.state === 'streaming') return message;
    const cached = cachedFlashListCompletedLiveMessages.get(index);
    if (cached) return cached;
    cachedFlashListCompletedLiveMessages.set(index, message);
    return message;
  });
  return [...stable, ...live];
}

function queuedPromptStreamingFixture(streamTick: number): WorkspaceMessage[] {
  const sessionKey = 'fixture-five-queued-prompts';
  const prompt = (index: number): WorkspaceMessage => ({
    id: `queued-prompt-${index}`,
    role: 'user',
    text: `Queued steering prompt ${index}`,
    source: 'local',
    state: 'complete',
    sessionKey,
    runId: 'queued-run',
    timestamp: `2026-08-27T12:4${index}:00+08:00`,
  });
  return [
    prompt(1),
    {
      id: 'queued-running-answer',
      role: 'assistant',
      source: 'live',
      state: 'streaming',
      sessionKey,
      runId: 'queued-run',
      timestamp: '2026-08-27T12:41:01+08:00',
      text: [
        'Processing the first prompt while later steering prompts remain queued.',
        ...Array.from({ length: streamTick }, (_, index) => `Queued stream line ${index + 1}: prompt input must remain responsive.`),
      ].join('\n'),
    },
    prompt(2), prompt(3), prompt(4), prompt(5),
  ];
}

function remoteFileLinkFixture(): WorkspaceMessage[] {
  return [{
    id: 'fixture-remote-file-link',
    role: 'assistant',
    source: 'history',
    state: 'complete',
    timestamp: '2026-08-27T12:23:17+08:00',
    text: 'The latest PDF to read is [Example research manuscript](/Users/fixture/repos/example/papers/manuscript.pdf).',
  }];
}

function sessionGenerationChronologyFixture() {
  const sessionKey = 'agent:main:direct:vimicate-ios:project:notes';
  const generation = {
    sessionId: '00000000-0000-4000-a000-000000000127',
    sessionStartedAtMs: Date.parse('2026-08-27T03:37:59.597Z'),
  };
  const prior: WorkspaceMessage = {
    id: 'morning-brief', role: 'assistant', source: 'history', sessionKey,
    text: 'Morning Brief — Thu 27 Aug 2026', timestamp: '2026-08-27T00:06:15.132Z',
  };
  const current: WorkspaceMessage = {
    id: 'updated-standup', role: 'assistant', source: 'history', sessionKey,
    text: 'Updated standup.md', timestamp: '2026-08-27T03:40:45.195Z',
  };
  const retainedTail = messagesOwnedBySessionGeneration([
    { ...prior, source: 'live' },
    current,
  ], generation);
  return mergeOlderHistory([prior], retainedTail, sessionKey);
}

function unmatchedLiveChronologyFixture() {
  const sessionKey = 'fixture-unmatched-live-chronology';
  const firstPrompt: WorkspaceMessage = {
    id: 'first-prompt', role: 'user', text: 'complete the earlier task',
    source: 'history', sessionKey, timestamp: '1787818147121',
  };
  const olderLiveAnswer: WorkspaceMessage = {
    id: 'older-live-answer', role: 'assistant',
    text: 'The earlier task is complete; the verified draft remains unsent.',
    source: 'live', sessionKey, runId: 'older-run', timestamp: '1787818539801', state: 'complete',
  };
  const firstCanonicalAnswer: WorkspaceMessage = {
    id: 'first-canonical-answer', role: 'assistant',
    text: 'The earlier task is complete. The verified draft remains unsent.',
    source: 'history', sessionKey, timestamp: '1787818539802',
  };
  const latestPrompt: WorkspaceMessage = {
    id: 'latest-prompt', role: 'user', text: 'what did you do last?',
    source: 'history', sessionKey, timestamp: '1787819103353',
  };
  const latestAnswer: WorkspaceMessage = {
    id: 'latest-answer', role: 'assistant', text: 'Last actions: submitted and verified the feedback.',
    source: 'history', sessionKey, timestamp: '1787819112916',
  };
  return mergeLatestHistory(
    [firstPrompt, firstCanonicalAnswer, latestPrompt, latestAnswer],
    // Reproduce the exact persisted corruption left by the preceding build:
    // the older unmatched live answer was already cached after the newest
    // completed response before the corrected merge ever starts.
    [firstPrompt, firstCanonicalAnswer, latestPrompt, latestAnswer, olderLiveAnswer],
    sessionKey,
  );
}

function restoredOrphanLiveChronologyFixture() {
  const sessionKey = 'fixture-restored-orphan-live-chronology';
  const canonical: WorkspaceMessage[] = [
    {
      id: 'old-prompt', role: 'user', source: 'history', sessionKey,
      text: 'prepare the morning brief', timestamp: '1787800000000',
    },
    {
      id: 'old-answer', role: 'assistant', source: 'history', sessionKey,
      text: 'Morning Brief — completed activity', timestamp: '1787800001000',
    },
    {
      id: 'latest-prompt', role: 'user', source: 'history', sessionKey,
      text: 'update standup', timestamp: '1787802045000',
    },
    {
      id: 'latest-answer', role: 'assistant', source: 'history', sessionKey,
      text: 'Updated standup.md', timestamp: '1787802045157',
    },
  ];
  const staleRestoredLiveAnswer: WorkspaceMessage = {
    id: 'stale-live-morning-brief', role: 'assistant', source: 'live', sessionKey,
    runId: 'lost-run-ownership', state: 'complete',
    text: '[Morning brief]\nThis stale restored answer must not move below Updated standup.md.',
  };
  return mergeLatestHistory(canonical, [...canonical, staleRestoredLiveAnswer], sessionKey);
}

function gatewayHistoryChronologyFixture() {
  return messagesFromPayload({ sessionKey: 'fixture-gateway-history-chronology', messages: [
    { id: 'prompt-1', role: 'user', timestamp: 1787764659052, content: 'edit the saved document' },
    { id: 'prompt-2', role: 'user', timestamp: 1787764680778, content: 'ask ccwork to check formatting' },
    { id: 'prompt-3', role: 'user', timestamp: 1787764692019, content: 'use ccwork where possible' },
    { id: 'preamble-1', role: 'assistant', timestamp: 1787764682155, content: "I'll update the saved DOCX." },
    { id: 'tool-1', role: 'toolResult', timestamp: 1787764682159, content: [{ type: 'toolResult', name: 'bash', text: 'instructions loaded' }] },
    { id: 'preamble-2', role: 'assistant', timestamp: 1787764696014, content: "I'll delegate the formatting review." },
  ] });
}

function gatewayPagedHistoryChronologyFixture() {
  const sessionKey = 'fixture-gateway-paged-history-chronology';
  const older = messagesFromPayload({ sessionKey, messages: [
    { id: 'prompt-1', role: 'user', timestamp: 1787764659052, content: 'edit the saved document' },
    { id: 'prompt-2', role: 'user', timestamp: 1787764680778, content: 'ask ccwork to check formatting' },
    { id: 'prompt-3', role: 'user', timestamp: 1787764692019, content: 'use ccwork where possible' },
    { id: 'prompt-4', role: 'user', timestamp: 1787764760235, content: 'insert my signature and create the draft' },
  ] });
  const newer = messagesFromPayload({ sessionKey, messages: [
    { id: 'preamble-1', role: 'assistant', timestamp: 1787764682155, content: "I'll update the saved DOCX." },
    { id: 'tool-1', role: 'toolResult', timestamp: 1787764682159, content: [{ type: 'toolResult', name: 'bash', text: 'instructions loaded' }] },
    { id: 'preamble-2', role: 'assistant', timestamp: 1787764696014, content: "I'll delegate the formatting review." },
  ] });
  return mergeOlderHistory(older, newer, sessionKey);
}

function steeringChronologyFixture() {
  const sessionKey = 'fixture-steering-chronology';
  const old: WorkspaceMessage = { id: 'old', role: 'assistant', text: 'Previous completed answer.', source: 'history', sessionKey };
  const prompt = (id: string, text: string, source: 'history' | 'local', idempotencyKey: string): WorkspaceMessage => ({
    id, role: 'user', text, source, sessionKey, idempotencyKey, runId: 'shared-run',
  });
  const localFirst = prompt('local-first', 'edit the saved document', 'local', 'first');
  const localSecond = prompt('local-second', 'ask ccwork to check formatting', 'local', 'second');
  const localThird = prompt('local-third', 'use ccwork where possible', 'local', 'third');
  const latest = [
    old,
    prompt('history-first', localFirst.text, 'history', 'first:user'),
    prompt('history-second', localSecond.text, 'history', 'second:user'),
    prompt('history-third', localThird.text, 'history', 'third:user'),
  ];
  const firstPreamble: WorkspaceMessage = { id: 'first-preamble', role: 'narration', text: "I'll update the latest saved DOCX.", source: 'live', sessionKey, runId: 'shared-run' };
  const firstTool: WorkspaceMessage = { id: 'first-tool', role: 'tool', text: 'read instructions', source: 'live', sessionKey, runId: 'shared-run', tool: { name: 'bash', summary: 'bash · read instructions' } };
  const secondPreamble: WorkspaceMessage = { id: 'second-preamble', role: 'narration', text: "I'll delegate the formatting review.", source: 'live', sessionKey, runId: 'shared-run' };
  return mergeLatestHistory(latest, [old, localFirst, firstPreamble, firstTool, localSecond, localThird, secondPreamble], sessionKey);
}

function repeatedSteeringChronologyFixture() {
  const sessionKey = 'fixture-repeated-steering-chronology';
  const old: WorkspaceMessage = { id: 'old', role: 'assistant', text: 'Previous completed answer.', source: 'history', sessionKey };
  const prompt = (id: string, source: 'history' | 'local'): WorkspaceMessage => ({
    id, role: 'user', text: 'same steering request', source, sessionKey, runId: 'shared-run',
  });
  const local = [prompt('local-first', 'local'), prompt('local-second', 'local'), prompt('local-third', 'local')];
  const canonical = [prompt('history-first', 'history'), prompt('history-second', 'history'), prompt('history-third', 'history')];
  const firstPreamble: WorkspaceMessage = { id: 'first-preamble', role: 'narration', text: 'First accepted occurrence.', source: 'live', sessionKey, runId: 'shared-run' };
  const secondTool: WorkspaceMessage = { id: 'second-tool', role: 'tool', text: 'second occurrence detail', source: 'live', sessionKey, runId: 'shared-run', tool: { name: 'bash', summary: 'bash · second occurrence' } };
  const thirdPreamble: WorkspaceMessage = { id: 'third-preamble', role: 'narration', text: 'Third accepted occurrence.', source: 'live', sessionKey, runId: 'shared-run' };
  let published: WorkspaceMessage[] = [old, local[0]!, firstPreamble, local[1]!, secondTool, local[2]!, thirdPreamble];
  for (let count = 1; count <= canonical.length; count += 1) {
    published = mergeLatestHistory([old, ...canonical.slice(0, count)], published, sessionKey);
  }
  return published;
}

function latePreambleChronologyFixture() {
  const sessionKey = 'fixture-chronology';
  const old: WorkspaceMessage = { id: 'old', role: 'assistant', text: 'Previous completed answer.', source: 'history', sessionKey };
  const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'find the approved software list', source: 'history', sessionKey, idempotencyKey: 'search:user' };
  const optimistic: WorkspaceMessage = { ...prompt, id: 'local-prompt', source: 'local', idempotencyKey: 'search', runId: 'run-search' };
  const answer: WorkspaceMessage = { id: 'answer', role: 'assistant', text: 'The likely page is the approved tools list.', source: 'history', sessionKey };
  const newerPrompt: WorkspaceMessage = { id: 'newer-prompt', role: 'user', text: 'what did my Mac Studio cost?', source: 'history', sessionKey };
  const newerAnswer: WorkspaceMessage = { id: 'newer-answer', role: 'assistant', text: 'Your Mac Studio cost $2,599.', source: 'history', sessionKey };
  const latePreamble: WorkspaceMessage = { id: 'late-preamble', role: 'narration', text: "I'll search the official site.", source: 'live', sessionKey, runId: 'run-search', state: 'streaming' };
  const restoredOrphan: WorkspaceMessage = { id: 'restored-orphan', role: 'narration', text: "I'll search SIT's official web properties.", source: 'live', sessionKey, runId: 'lost-run' };
  return appendConversationBoundary(mergeLatestHistory(
    [old, prompt, answer, newerPrompt, newerAnswer],
    [old, optimistic, answer, newerPrompt, newerAnswer, latePreamble, restoredOrphan],
    sessionKey,
  ), { id: 'boundary', role: 'boundary', text: '──────  new conversation  ──────', source: 'live', sessionKey, state: 'complete' });
}
