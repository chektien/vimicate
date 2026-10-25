import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionRunRegistry } from './sessionRunRegistry';

vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'model-command' }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ latestFatalDiagnostic: () => null, recentViewportDiagnostics: () => [] }));
import { useGatewaySubmission } from './useGatewaySubmission';

const project = (sessionKey: string, sessionId: string): WorkspaceProject => ({
  id: sessionKey,
  sessionKey,
  sessionId,
  name: sessionKey,
  path: `~/${sessionKey}`,
  branch: 'main',
  starred: false,
  threadCount: 1,
  state: 'idle',
});

function submission(models = [
  { provider: 'opencode-go', id: 'kimi-k3' },
  { provider: 'openai', id: 'gpt-6-astra', name: 'GPT Astra', aliases: ['flagship'] },
]) {
  const projects = [project('work-one', 'generation-one'), project('work-two', 'generation-two')];
  const client = {
    status: 'connected',
    listModels: vi.fn(async () => ({ models })),
    patchSessionModel: vi.fn(async () => ({})),
    send: vi.fn(async () => ({ runId: 'should-not-run' })),
  };
  const loadSessions = vi.fn(async () => {});
  const recordLocalInteraction = vi.fn();
  const setDetail = vi.fn();
  const submit = useGatewaySubmission({
      client: client as never,
      status: 'connected',
      commands: [],
      projects,
      messages: [],
      selectedRef: { current: 'work-one' },
      registrySnapshot: { current: null },
      runRegistry: { current: new SessionRunRegistry() },
      setDetail,
      updateSessionMessages: vi.fn(),
      preparePromptSubmission: vi.fn(),
      publishSelectedRun: vi.fn(),
      persistRuns: vi.fn(),
      loadHistory: vi.fn(async () => []),
      loadPendingApprovals: vi.fn(async () => {}),
      decideApproval: vi.fn(async () => false),
      loadSessions,
      acceptThreadRegistryMutation: vi.fn(),
      startRunMonitor: vi.fn(),
      reconnect: vi.fn(async () => {}),
      repair: vi.fn(async () => {}),
      recordLocalInteraction,
      scenePublicationAuthority: { current: new HistoryPublicationAuthority() },
  });
  return { submit, client, loadSessions, recordLocalInteraction, setDetail };
}

describe('model selection scope', () => {
  it('patches only the selected concrete session and never sends the global /model command', async () => {
    const { submit, client, loadSessions, recordLocalInteraction } = submission();

    await expect(submit(':model opencode-go/kimi-k3')).resolves.toBe(true);
    expect(client.patchSessionModel).toHaveBeenCalledExactlyOnceWith('work-one', 'opencode-go/kimi-k3', 'generation-one');
    expect(client.send).not.toHaveBeenCalled();
    expect(loadSessions).toHaveBeenCalledExactlyOnceWith(false, 'work-one', false);
    expect(recordLocalInteraction).not.toHaveBeenCalled();
  });

  it('resets the selected session with a null model instead of sending the literal "default"', async () => {
    const { submit, client, loadSessions } = submission();

    await expect(submit(':models default')).resolves.toBe(true);
    expect(client.patchSessionModel).toHaveBeenCalledExactlyOnceWith('work-one', null, 'generation-one');
    expect(client.send).not.toHaveBeenCalled();
    expect(loadSessions).toHaveBeenCalledExactlyOnceWith(false, 'work-one', false);
  });
});


describe('fuzzy model submission', () => {
  it.each(['astra', 'ASTRA', 'g6ast', 'GPT Astra', 'flagship', 'openai/astra'])('resolves %s to the canonical model for this session only', async input => {
    const { submit, client } = submission();
    await expect(submit(`:model ${input}`)).resolves.toBe(true);
    expect(client.patchSessionModel).toHaveBeenCalledExactlyOnceWith('work-one', 'openai/gpt-6-astra', 'generation-one');
    expect(client.send).not.toHaveBeenCalled();
  });
  it('does not mutate a session or ask the agent when shorthand is ambiguous', async () => {
    const { submit, client, setDetail } = submission([
      { provider: 'openai', id: 'gpt-6-astra' },
      { provider: 'openai', id: 'gpt-5-astra' },
    ]);
    await expect(submit(':model astra')).resolves.toBe(false);
    expect(client.patchSessionModel).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    expect(setDetail).toHaveBeenCalledWith(expect.stringContaining('Multiple models match astra:'));
  });
  it('rejects no match without changing the model', async () => {
    const { submit, client, setDetail } = submission();
    await expect(submit(':model zzz')).resolves.toBe(false);
    expect(client.patchSessionModel).not.toHaveBeenCalled();
    expect(setDetail).toHaveBeenCalledWith(expect.stringContaining('No model matches zzz.'));
  });
});
