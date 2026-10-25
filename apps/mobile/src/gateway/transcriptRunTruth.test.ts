import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { withHistoryRunCompletions } from './historyRunCompletion';
import { SessionRunRegistry } from './sessionRunRegistry';
import { reconcileNewerTranscriptCompletion } from './transcriptRunTruth';

const message = (id: string, role: WorkspaceMessage['role'], timestamp: number): WorkspaceMessage => ({
  id, role, text: id, timestamp: String(timestamp), source: 'history', sessionKey: 'dotfiles',
});

describe('canonical transcript run truth', () => {
  it('clears an older red failure after a strictly newer canonical turn completed', () => {
    const epoch = 1_800_000_000_000;
    const registry = new SessionRunRegistry();
    registry.registerRun('dotfiles', 'failed-parent', { startedAtMs: epoch + 1_000 });
    registry.finishRun('dotfiles', 'failed-parent', 'failed', { endedAtMs: epoch + 2_000 });
    const history = withHistoryRunCompletions([
      message('new-prompt', 'user', epoch + 3_000),
      message('new-answer', 'assistant', epoch + 4_000),
    ]);

    expect(reconcileNewerTranscriptCompletion(registry, 'dotfiles', history)).toBe(true);
    expect(registry.phaseFor('dotfiles')).toBe('completed');
    expect(registry.runFor('dotfiles')).toBe('');
  });

  it('does not let an older historical success erase a newer failure', () => {
    const epoch = 1_800_000_000_000;
    const registry = new SessionRunRegistry();
    registry.registerRun('dotfiles', 'failed-parent', { startedAtMs: epoch + 3_000 });
    registry.finishRun('dotfiles', 'failed-parent', 'failed', { endedAtMs: epoch + 4_000 });
    const history = withHistoryRunCompletions([
      message('old-prompt', 'user', epoch + 1_000),
      message('old-answer', 'assistant', epoch + 2_000),
    ]);

    expect(reconcileNewerTranscriptCompletion(registry, 'dotfiles', history)).toBe(false);
    expect(registry.phaseFor('dotfiles')).toBe('failed');
  });

  it('does not settle an unrelated active replacement run', () => {
    const registry = new SessionRunRegistry();
    registry.restore('{"dotfiles":"replacement"}');
    const history = withHistoryRunCompletions([
      message('old-prompt', 'user', Date.now() + 1_000),
      message('old-answer', 'assistant', Date.now() + 2_000),
    ]);

    expect(reconcileNewerTranscriptCompletion(registry, 'dotfiles', history)).toBe(false);
    expect(registry.runFor('dotfiles')).toBe('replacement');
    expect(registry.phaseFor('dotfiles')).toBe('uncertain');
  });
});
