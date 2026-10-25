import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

describe('bounded prompt-draft lifetime', () => {
  it('queues the outgoing authoritative draft durably before bounded memory can evict it', () => {
    const source = readFileSync(new URL('../prompt/usePromptHistoryController.ts', import.meta.url), 'utf8');
    const persistence = 'launchGuardedBackgroundTask(() => saveDraft(outgoingSessionKey, outgoingText));';
    const staging = 'draftMemory.current.enter(sessionKey, outgoingText, outgoingAuthoritative, promptRef.current);';

    expect(source).toContain(persistence);
    expect(source.indexOf(persistence)).toBeLessThan(source.indexOf(staging));
  });
});
