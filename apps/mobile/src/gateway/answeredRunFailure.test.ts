import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { answeredFailureAsCompletion, runAnsweredBeforeFailure } from './answeredRunFailure';
import { projectRunGlyph, projectsWithRunPhases } from '../workspace/runProjectPresentation';
import { SessionRunRegistry } from './sessionRunRegistry';

const sessionKey = 'agent:main:direct:vimicate-ios:project:example-cloud';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const native = (id: string, role: 'user' | 'assistant', text: string, timestamp: number, stopReason = role === 'assistant' ? 'end_turn' : undefined) => ({
  role, timestamp, ...(stopReason ? { stopReason } : {}),
  content: role === 'user' ? text : [{ type: 'text', text }, ...(stopReason === 'tool_use' ? [{ type: 'toolcall', id: `tool-${id}`, name: 'Bash', arguments: {} }] : [])],
  __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id },
});
const history = (...messages: Record<string, unknown>[]) => messagesFromPayload({ sessionKey, sessionId: '11111111-1111-4111-8111-111111111111', messages });
const failed = { sessionKey, runId: 'run-1', phase: 'failed' as const };

describe('a run the Gateway failed after its answer was saved', () => {
  // Physical example-project (7 Oct): answer saved at 12:41, watchdog failure at 12:51.
  it('counts the saved end-turn answer after the latest prompt as answered', () => {
    const answered = history(native('prompt', 'user', 'Ship it.', 1000), native('step', 'assistant', 'Deploying now.', 2000, 'tool_use'), native('answer', 'assistant', 'Everything is on sandbox.', 3000));
    expect(runAnsweredBeforeFailure(answered, 'run-1')).toBe(true);
    expect(answeredFailureAsCompletion(failed, answered)).toEqual({ ...failed, phase: 'completed' });
  });

  it('keeps a real failure: commentary only, or an answer that belongs to an earlier prompt', () => {
    const midTurn = history(native('prompt', 'user', 'Ship it.', 1000), native('step', 'assistant', 'Deploying now.', 2000, 'tool_use'));
    expect(runAnsweredBeforeFailure(midTurn, 'run-1')).toBe(false);
    const earlier = history(native('old', 'user', 'Earlier.', 500), native('old-answer', 'assistant', 'Earlier answer.', 600), native('prompt', 'user', 'Ship it.', 1000));
    expect(runAnsweredBeforeFailure(earlier, 'run-1')).toBe(false);
    expect(answeredFailureAsCompletion(failed, midTurn)).toBe(failed);
    const streaming: WorkspaceMessage[] = [...midTurn, { id: 'live-chat-run-1', role: 'assistant', text: 'Everything is on', source: 'live', sessionKey, runId: 'run-1', state: 'streaming' }];
    expect(runAnsweredBeforeFailure(streaming, 'run-1')).toBe(false);
  });
});

describe('a run this device stopped', () => {
  const dot = (registry: SessionRunRegistry) => projectRunGlyph(projectsWithRunPhases([{ id: 'p', sessionKey, name: 'example-cloud', path: '~', branch: 'main', starred: false, threadCount: 1, state: 'idle' }], registry)[0]!.runPhase);

  it('ends without the red crashed dot through every failure path', () => {
    for (const settle of [
      (registry: SessionRunRegistry) => registry.observePhase(sessionKey, 'failed', 'run-1'),
      (registry: SessionRunRegistry) => registry.markIncompleteRun(sessionKey, 'run-1'),
      (registry: SessionRunRegistry) => registry.finishRun(sessionKey, 'run-1', 'failed'),
    ]) {
      const registry = new SessionRunRegistry();
      registry.registerRun(sessionKey, 'run-1');
      registry.beginStopRequest(sessionKey, 'run-1')(true);
      settle(registry);
      expect(registry.phaseFor(sessionKey)).toBe('completed');
      expect(dot(registry)).toBeNull();
    }
  });

  it('still shows a crash for a run nobody stopped', () => {
    const registry = new SessionRunRegistry();
    registry.registerRun(sessionKey, 'run-1');
    registry.beginStopRequest(sessionKey, 'run-0')(true);
    registry.observePhase(sessionKey, 'failed', 'run-1');
    expect(registry.phaseFor(sessionKey)).toBe('failed');
    expect(dot(registry)).toMatchObject({ label: 'crashed', tone: 'failed' });
  });
});
