import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { pruneUnownedRestoredLiveRows } from './transcriptChronology';

const row = (overrides: Partial<WorkspaceMessage>): WorkspaceMessage => ({
  id: 'row', role: 'assistant', text: 'row', sessionKey: 'one', source: 'history', ...overrides,
});

describe('restored transcript chronology', () => {
  it('removes only a restored orphan preamble whose turn identity is unrecoverable', () => {
    const messages = [
      row({ id: 'answer', text: 'newer completed answer' }),
      row({ id: 'orphan', role: 'narration', text: "I'll search the official site.", source: 'live', runId: 'old-run' }),
      row({ id: 'boundary', role: 'boundary', text: 'new conversation', source: 'live', state: 'complete' }),
    ];
    expect(pruneUnownedRestoredLiveRows(messages).map((message) => message.id)).toEqual(['answer', 'boundary']);
  });

  it('keeps fresh streaming and prompt-owned preambles', () => {
    const fresh = row({ id: 'fresh', role: 'narration', source: 'live', runId: 'fresh-run', state: 'streaming' });
    const prompt = row({ id: 'prompt', role: 'user', source: 'history', runId: 'owned-run' });
    const owned = row({ id: 'owned', role: 'narration', source: 'live', runId: 'owned-run' });
    expect(pruneUnownedRestoredLiveRows([fresh, prompt, owned]).map((message) => message.id)).toEqual(['fresh', 'prompt', 'owned']);
  });

  it('keeps a restored preamble whose nearest conversation row is its old unscoped prompt', () => {
    const prompt = row({ id: 'prompt', role: 'user', source: 'history' });
    const tool = row({ id: 'tool', role: 'tool', source: 'live', runId: 'old-run' });
    const preamble = row({ id: 'preamble', role: 'narration', source: 'live', runId: 'old-run' });
    expect(pruneUnownedRestoredLiveRows([prompt, tool, preamble]).map((message) => message.id)).toEqual(['prompt', 'tool', 'preamble']);
  });

  it('keeps timestamped, actively streaming and externally run-owned live rows', () => {
    const prompt = row({ id: 'prompt', role: 'user', source: 'history', runId: 'owned-run' });
    const ownedAnswer = row({ id: 'owned-answer', source: 'live', runId: 'owned-run', state: 'complete' });
    const timestamped = row({ id: 'timestamped', source: 'live', runId: 'old-run', timestamp: '1787801000000', state: 'complete' });
    const streaming = row({ id: 'streaming', source: 'live', runId: 'fresh-run', state: 'streaming' });
    expect(pruneUnownedRestoredLiveRows([prompt, ownedAnswer, timestamped, streaming]).map((message) => message.id)).toEqual([
      'prompt', 'owned-answer', 'timestamped', 'streaming',
    ]);
  });

});
