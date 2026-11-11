import { describe, expect, it, vi } from 'vitest';
import { SessionSubmissionGate, SessionTailRevealRegistry, SUBMISSION_ADMISSION_WINDOW_MS, submissionOwnsSourceTailReveal } from './sessionSubmissionGate';
import { shouldRunTranscriptViewportWriter } from '../transcript/transcriptViewportPolicy';

describe('session-keyed submission UI ownership', () => {
  it('blocks duplicate submits only inside the same session', () => {
    const gate = new SessionSubmissionGate();
    const release = gate.acquire('a');
    expect(release).toBeTypeOf('function');
    expect(gate.acquire('a')).toBeNull();
    expect(gate.acquire('b')).toBeTypeOf('function');
    release!();
    expect(gate.acquire('a')).toBeTypeOf('function');
    expect(gate.owns('b')).toBe(true);
  });

  // Physical iPad (10 Nov): a steer into a Claude CLI turn settles only when
  // the run reaches its next tool boundary. Holding the thread for the whole
  // send made Enter do nothing until then.
  it('stops blocking the thread once a send outlives its admission window, without ending that send', () => {
    vi.useFakeTimers();
    try {
      const gate = new SessionSubmissionGate();
      const steer = gate.acquire('a')!;
      vi.advanceTimersByTime(SUBMISSION_ADMISSION_WINDOW_MS - 1);
      expect(gate.acquire('a')).toBeNull();
      vi.advanceTimersByTime(1);
      expect(gate.owns('a')).toBe(false);
      const next = gate.acquire('a')!;
      expect(next).toBeTypeOf('function');
      // The earlier send settling late must not release the newer holder.
      steer();
      expect(gate.acquire('a')).toBeNull();
      next();
      expect(gate.owns('a')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  // Independent review (10 Nov): attachments stay staged until acceptance, so a
  // second send inside a still-pending one would carry them again.
  it('holds the thread until settlement for a send that still owns staged attachments', () => {
    vi.useFakeTimers();
    try {
      const gate = new SessionSubmissionGate();
      const withAttachments = gate.acquire('a', false)!;
      vi.advanceTimersByTime(SUBMISSION_ADMISSION_WINDOW_MS * 200);
      expect(gate.acquire('a')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      withAttachments();
      expect(gate.acquire('a')).toBeTypeOf('function');
    } finally { vi.useRealTimers(); }
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
