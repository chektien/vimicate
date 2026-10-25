import { latestHistoryWindow, latestPresentationWindow } from '../gateway/historyWindow';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const sessionKey = 'fixture-accepted-prompt-window';
const runId = 'fixture-accepted-prompt-window-run';

let localPrompt: WorkspaceMessage | undefined;
let liveTools: WorkspaceMessage[] | undefined;
let canonicalWindow: WorkspaceMessage[] | undefined;

function fixturePayload() {
  localPrompt ??= {
    id: 'accepted-window-prompt', role: 'user',
    text: 'BUG052 accepted prompt remains at the turn boundary',
    source: 'local', state: 'complete', sessionKey, runId, timestamp: '1788318000000',
  };
  liveTools ??= Array.from({ length: 480 }, (_, index): WorkspaceMessage => ({
    id: `accepted-window-tool-${index}`, role: 'tool',
    text: `BUG052 live tool detail ${index + 1}`,
    source: 'live', state: index === 479 ? 'streaming' : 'complete',
    sessionKey, runId, timestamp: String(1788318001000 + index),
    tool: { name: 'bash', summary: `bash · BUG052 detail ${index + 1}` },
  }));
  return { prompt: localPrompt, tools: liveTools };
}

/** Exact full-window reproduction: one accepted turn followed by 480 unique
 * live details, then the same run converged through canonical history. */
export function acceptedPromptWindowStressFixture(streamTick: number) {
  const { prompt, tools } = fixturePayload();
  const count = Math.min(Math.max(streamTick, 0), tools.length);
  if (streamTick < 500) return latestPresentationWindow([prompt, ...tools.slice(0, count)]);
  canonicalWindow ??= latestHistoryWindow([
    { ...prompt, source: 'history' },
    ...tools.map((tool) => ({ ...tool, source: 'history' as const, state: 'complete' as const })),
    {
      id: 'accepted-window-final', role: 'assistant',
      text: 'BUG052 canonical final remains with its accepted prompt',
      source: 'history', state: 'complete', sessionKey, runId, timestamp: '1788318002000',
    },
  ], [], sessionKey);
  return canonicalWindow;
}
