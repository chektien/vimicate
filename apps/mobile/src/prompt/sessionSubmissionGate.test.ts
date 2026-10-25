import { describe, expect, it } from 'vitest';
import { SessionSubmissionGate, SessionTailRevealRegistry, submissionOwnsSourceTailReveal } from './sessionSubmissionGate';
import { shouldRunTranscriptViewportWriter } from '../transcript/transcriptViewportPolicy';

describe('session-keyed submission UI ownership', () => {
  it('blocks duplicate submits only inside the same session', () => {
    const gate = new SessionSubmissionGate();
    expect(gate.acquire('a')).toBe(true);
    expect(gate.acquire('a')).toBe(false);
    expect(gate.acquire('b')).toBe(true);
    gate.release('a');
    expect(gate.acquire('a')).toBe(true);
    expect(gate.owns('b')).toBe(true);
  });

  it('consumes a transcript tail reveal only for the session whose rows advanced', () => {
    const registry = new SessionTailRevealRegistry(); registry.arm('a');
    expect(registry.consumeIfAdvanced('b', 2, 3)).toBe(false);
    expect(registry.owns('a')).toBe(true);
    expect(registry.consumeIfAdvanced('a', 2, 2)).toBe(false);
    expect(registry.consumeIfAdvanced('a', 2, 3)).toBe(true);
    expect(registry.owns('a')).toBe(false);
  });

  it('consumes the accepted tail reveal when new-conversation publication contracts the buffer', () => {
    const registry = new SessionTailRevealRegistry(); registry.arm('reset-thread');

    // A real `/new` can replace hundreds of preceding-generation rows with a
    // single durable boundary. That is a newly published tail even though the
    // source-row count decreases.
    expect(registry.consumeIfAdvanced('reset-thread', 480, 1, true)).toBe(true);
    expect(registry.owns('reset-thread')).toBe(false);
  });

  it('drops a queued optimistic-tail writer if another transcript owns the next paint', () => {
    const registry = new SessionTailRevealRegistry(); registry.arm('fixture-other-project');
    expect(registry.consumeIfAdvanced('fixture-other-project', 120, 121)).toBe(true);
    expect(shouldRunTranscriptViewportWriter('fixture-other-project', 'example-slides')).toBe(false);
  });

  it.each([':new-thread child', ':close-thread', ':approvals', ':approve request-1', ':deny request-1', ':repair'])(
    'does not leave source-tail ownership behind for %s',
    (input) => expect(submissionOwnsSourceTailReveal(input)).toBe(false),
  );

  it.each(['ordinary prompt', ':status', ':reload-projects', ':model gpt-5.6-sol', ':repair\nquoted diagnostic output', ':new-thread\nquoted command'])(
    'keeps source-tail ownership for a submission that publishes %s',
    (input) => expect(submissionOwnsSourceTailReveal(input)).toBe(true),
  );
});
