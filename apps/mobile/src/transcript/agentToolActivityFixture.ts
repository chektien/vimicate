import { projectGatewayEvent, upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

const SESSION = 'agent:fixture:direct:tool-activity';
const RUN = 'fixture-tool-activity-run';
const START_MS = 1_788_359_872_003;
const PROMPT = 'Add the new provider model to the selector.';
const PROMPT_KEY = 'fixture-tool-activity-prompt-key';

type FixtureCall = { name: string; callId: string; args: Record<string, unknown>; result: unknown; isError?: boolean };

/**
 * Synthetic reconstruction of one external-CLI turn: the runtime carries
 * every tool as a live `agent` tool frame and persists the whole turn as a
 * single assistant text message, so the transcript's tool identity exists only
 * in the live frames. Configuration dumps, shell stderr, usage text and the
 * runtime's working-directory notice all arrive inside tool results.
 */
const calls: FixtureCall[] = [
  {
    name: 'Read', callId: 'toolu_fixture_read',
    args: { file_path: '/Users/operator/.agent/projects/example/memory/register-newer-provider-model.md' },
    result: '1\t---\n2\tname: register-newer-provider-model\n3\t---\n4\tAdd the catalog entry first, then the allowlist.',
  },
  {
    name: 'Bash', callId: 'toolu_fixture_inspect',
    args: { command: "cd ~/.agent && head -c 400 agent.json; echo; sed -n '2,4p' agent.json | cat -A | cut -c1-60", description: 'Check config formatting before editing' },
    result: '{\n  "meta": {\n    "lastTouchedVersion": "2026.8.1",\n    "migrations": {\n      "modelPolicyAllowlist": true\n    }\n  },\n  "logging": {\n    "level": "debug"\n  }\n}\ncat: illegal option -- A\nusage: cat [-belnstuv] [file ...]\nShell cwd was reset to /Users/operator/.agent',
    isError: true,
  },
  {
    name: 'Bash', callId: 'toolu_fixture_backup',
    args: { command: 'cd ~/.agent && cp -p agent.json "agent.json.pre-edit-$(date +%Y%m%d-%H%M%S)"', description: 'Back up config before edit' },
    result: 'agent.json.pre-edit-20260102-090000\nShell cwd was reset to /Users/operator/.agent',
  },
  {
    name: 'Bash', callId: 'toolu_fixture_edit',
    args: { command: "python3 - <<'EOF'\nimport json, os\np = os.path.expanduser('~/.agent/agent.json')\nd = json.load(open(p))\nd['models']['providers']['example']['models'].append({'id': 'example-5-1'})\njson.dump(d, open(p, 'w'), indent=2)\nEOF", description: 'Add the model to the catalog and allowlist' },
    result: 'added catalog entry\nadded runtime binding\nadded to allowlist\nwritten',
  },
  {
    name: 'Grep', callId: 'toolu_fixture_search',
    args: { pattern: 'modelPolicy\\.allow', path: '~/.agent', output_mode: 'files_with_matches' },
    result: ['/Users/operator/.agent/agent.json'],
  },
  {
    name: 'Skill', callId: 'toolu_fixture_skill',
    args: { skill: 'provider-catalog' },
    result: 'Launching skill: provider-catalog',
  },
];

const answer = [
  'Done — the model is live in the selector.',
  '',
  '**What changed** in `~/.agent/agent.json` (backup: `agent.json.pre-edit-20260102-090000`):',
  '',
  '1. a catalog entry for the new model id',
  '2. a runtime binding matching its sibling',
  '3. the allowlist entry that actually drives the picker',
  '',
  'The catalog entry alone would have been invisible; the allowlist is the selector list.',
].join('\n');

/**
 * Synthetic reconstruction of one structured turn: this producer keeps
 * prose and its tool calls in a single canonical assistant message, and
 * persists each result as its own row. Both shapes reach the reader through
 * the same page, so both must resolve to bounded tool rows.
 */
const INTERLEAVED_PROSE = 'Checking the live config before I touch it.';
const interleavedContent = [
  { type: 'text', text: INTERLEAVED_PROSE },
  {
    type: 'toolCall', id: 'call_fixture_inspect', name: 'exec',
    arguments: {
      command: "ssh -i ~/.agent/keys/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new operator@192.0.2.4 'cd ~/.agent && cat -A agent.json | head -20'",
      workdir: '/Users/operator/.agent', timeout: 120,
    },
  },
  {
    type: 'toolCall', id: 'call_fixture_backup', name: 'exec',
    arguments: {
      command: "ssh -i ~/.agent/keys/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new operator@192.0.2.4 'cd ~/.agent && cp -p agent.json agent.json.pre-edit'",
      workdir: '/Users/operator/.agent', timeout: 120,
    },
  },
];
const interleavedResult = {
  type: 'toolResult', toolCallId: 'call_fixture_inspect', isError: true,
  content: '{\n  "meta": {\n    "lastTouchedVersion": "2026.8.1"\n  }\n}\ncat: illegal option -- A\nusage: cat [-belnstuv] [file ...]\nShell cwd was reset to /Users/operator/.agent',
};

/**
 * The transcript a reader gets after that turn converges and its history page
 * reloads: one bounded semantic row per tool, the answer intact, nothing raw
 * on screen until a tool is deliberately expanded.
 */
export function agentToolActivityFixture(): WorkspaceMessage[] {
  // The optimistic prompt the client published before the run started; the
  // canonical page reconciles it by its transport idempotency key.
  let live: WorkspaceMessage[] = [{
    id: 'fixture-tool-activity-local-prompt', role: 'user', source: 'local', sessionKey: SESSION,
    runId: RUN, idempotencyKey: PROMPT_KEY, text: PROMPT, timestamp: String(START_MS - 12_000),
  }];
  let seq = 0;
  let ts = START_MS;
  for (const call of calls) {
    live = publish(live, { seq: (seq += 1), ts: (ts += 1_000), stream: 'tool', data: { phase: 'start', name: call.name, toolCallId: call.callId, args: call.args } });
    live = publish(live, { seq: (seq += 1), ts: (ts += 4_000), stream: 'tool', data: { phase: 'result', name: call.name, toolCallId: call.callId, result: call.result, ...(call.isError ? { isError: true } : {}) } });
  }
  const answerTs = ts + 5_000;
  const chat = projectGatewayEvent({ event: 'chat', payload: { sessionKey: SESSION, runId: RUN, seq: (seq += 1), ts: answerTs, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: answer }] } } }, SESSION);
  if (chat) live = upsertLiveMessage(live, chat.message);
  live = publish(live, { seq: (seq += 1), ts: answerTs + 1_000, stream: 'lifecycle', data: { phase: 'end' } });

  const history = messagesFromPayload({
    sessionKey: SESSION,
    messages: [
      { id: 'fixture-tool-activity-prompt', role: 'user', content: PROMPT, idempotencyKey: PROMPT_KEY, runId: RUN, timestamp: START_MS - 12_000 },
      { id: 'fixture-tool-activity-answer', role: 'assistant', content: [{ type: 'text', text: answer }], timestamp: answerTs },
      { id: 'fixture-interleaved-prompt', role: 'user', content: 'Check the config before editing it.', timestamp: answerTs + 60_000 },
      { id: 'fixture-interleaved-turn', role: 'assistant', content: interleavedContent, timestamp: answerTs + 90_000 },
      { id: 'fixture-interleaved-result', role: 'toolResult', content: [interleavedResult], timestamp: answerTs + 120_000 },
      { id: 'fixture-interleaved-answer', role: 'assistant', content: [{ type: 'text', text: 'The config is intact; the inspection flag was wrong, not the file.' }], timestamp: answerTs + 150_000 },
    ],
  });
  return mergeLatestHistory(history, live, SESSION);
}

function publish(messages: WorkspaceMessage[], payload: Record<string, unknown>) {
  const projected = projectGatewayEvent({ event: 'agent', payload: { sessionKey: SESSION, runId: RUN, ...payload } }, SESSION);
  return projected ? upsertLiveMessage(messages, projected.message) : messages;
}
