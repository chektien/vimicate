import { projectGatewayEvent, upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

const SESSION = 'agent:fixture:dashboard:embedded-tool-protocol';
const RUN = 'fixture-embedded-protocol-run';
const START_MS = 1_788_411_120_000;
const PROMPT = 'Did the contributions trim land?';
const PROMPT_KEY = 'fixture-embedded-protocol-prompt-key';

/**
 * Synthetic reconstruction of an external-CLI turn whose runtime lost the
 * structure of its own tool traffic: the executed call, its result and the
 * protocol's framing all arrive inside one assistant `text` part, and the
 * canonical page stores no tool row for the turn at all. The framing survives
 * only as single-character marker lines and a bare `function results` token,
 * so the reader used to receive the invocation JSON and the raw result body as
 * assistant prose. All values are invented. The protocol grammar retains the regression boundary.
 */
export const PROTOCOL_ANSWER = "The watcher couldn't run — it had no shell access, so the sequencing I set up never happened. Picking it up directly.";

export const INTERLEAVED_PROTOCOL_TURN = [
  PROTOCOL_ANSWER,
  '',
  '',
  '˚',
  '=',
  '±',
  '±',
  'Ë',
  '{"command":"~/scripts/runner.sh poll 20260102-090000-0001 2>&1 | head -40","description":"Poll contributions trim run"}',
  '±',
  '±',
  'Ë',
  '',
  'functionresults',
  '',
  ' ',
  '±',
  '±',
  'Ë',
  'ID: 20260102-090000-0001',
  'account: secondary',
  'status: done',
  'started: 2026-01-02T09:00:00+08:00',
  'ended: 2026-01-02T09:17:13+08:00',
  'elapsed: 1033s',
  'exit: 0',
  'cwd: /Users/operator/repos/example',
].join('\n');

/** The same shape from the same route with no answer prose in front of it. */
export const PROTOCOL_ONLY_TURN = [
  '˚',
  '=',
  '±',
  '±',
  'Ë',
  '{"command":"~/scripts/runner.sh poll 20260102-080000-0002 2>&1 | head -60","description":"Poll runner status"}',
  '',
  'functionresults',
  '',
  ' ',
  '±',
  '±',
  'Ë',
  'ID: 20260102-080000-0002',
  'account: secondary',
  'status: running',
  'started: 2026-01-02T08:00:00+08:00',
  'elapsed: 1802s',
  'pid: 41287 (alive)',
  'cwd: /Users/operator/repos/example',
].join('\n');

/**
 * A control answer that deliberately quotes the same protocol inside a fenced
 * block and names its tokens inline. Quoted evidence is authored prose and
 * must keep every character, its fence and its prominence.
 */
export const QUOTED_PROTOCOL_ANSWER = [
  'Here is the leak you reported, exactly as the runtime emitted it:',
  '',
  '```text',
  '±',
  'functionresults',
  '{"command":"echo quoted","description":"Quoted example"}',
  '```',
  '',
  'The `functionresults` marker is the giveaway.',
].join('\n');

/** Every artifact that must never reach the reader as assistant prose. */
export const PROTOCOL_ARTIFACTS = [
  'functionresults',
  '{"command":"~/scripts/runner.sh',
  'account: secondary',
  'elapsed: 1033s',
  'pid: 41287 (alive)',
] as const;

export const PROTOCOL_GLYPH_LINES = ['˚', '=', '±', 'Ë'] as const;

/**
 * The transcript a reader gets for that route once the page reloads: the
 * answer intact, one bounded tool row per recovered execution, the quoted
 * control answer untouched.
 */
export function embeddedToolProtocolFixture(): WorkspaceMessage[] {
  const history = messagesFromPayload({
    sessionKey: SESSION,
    messages: [
      { id: 'fixture-protocol-prompt', role: 'user', content: PROMPT, idempotencyKey: PROMPT_KEY, runId: RUN, timestamp: START_MS },
      { id: 'fixture-protocol-turn', role: 'assistant', content: [{ type: 'text', text: INTERLEAVED_PROTOCOL_TURN }], timestamp: START_MS + 60_000 },
      { id: 'fixture-protocol-earlier-prompt', role: 'user', content: 'And the run before it?', timestamp: START_MS + 120_000 },
      { id: 'fixture-protocol-only-turn', role: 'assistant', content: [{ type: 'text', text: PROTOCOL_ONLY_TURN }], timestamp: START_MS + 180_000 },
      { id: 'fixture-protocol-quoted', role: 'assistant', content: [{ type: 'text', text: QUOTED_PROTOCOL_ANSWER }], timestamp: START_MS + 240_000 },
    ],
  });
  const live = liveProtocolMessages();
  return mergeLatestHistory(history, live, SESSION);
}

/**
 * The same interleaved turn as it arrives live, behind the optimistic prompt
 * the client published for its run, before any history page.
 */
export function liveProtocolMessages(): WorkspaceMessage[] {
  const optimistic: WorkspaceMessage[] = [{
    id: 'fixture-protocol-local-prompt', role: 'user', source: 'local', sessionKey: SESSION,
    runId: RUN, idempotencyKey: PROMPT_KEY, text: PROMPT, timestamp: String(START_MS),
  }];
  const projected = projectGatewayEvent({
    event: 'chat',
    payload: {
      sessionKey: SESSION, runId: RUN, seq: 1, ts: START_MS + 60_000, state: 'final',
      message: { role: 'assistant', content: [{ type: 'text', text: INTERLEAVED_PROTOCOL_TURN }] },
    },
  }, SESSION);
  return projected ? upsertLiveMessage(optimistic, projected.message) : optimistic;
}
