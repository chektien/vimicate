import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

import { commandMessage } from '../gateway/submissionMessages';

const commandRows = readFileSync(new URL('../gateway/submissionMessages.ts', import.meta.url), 'utf8');
const history = readFileSync(new URL('../gateway/useGatewayHistory.ts', import.meta.url), 'utf8');
const submission = readFileSync(new URL('../gateway/useGatewaySubmission.ts', import.meta.url), 'utf8');

describe('submission history ownership', () => {
  it('returns an older-history reader to the live tail before optimistic publication', () => {
    const prepare = submission.indexOf('if (selectedRef.current === sessionKey) preparePromptSubmission(sessionKey);');
    const publish = submission.indexOf('updateSessionMessages(sessionKey, (current) => current.some');
    expect(prepare).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(prepare);
    expect(history).toContain('promptSubmissionHistoryPublication(');
    expect(history).toContain('windowMode.current = prepared.windowMode;');
    expect(history).toContain('olderRequest.current.retire();');
    expect(history).toContain('setMessageState(prepared.visible);');
  });

  it('also exits review before locally handled reset commands establish a new generation', () => {
    const prepare = submission.indexOf('if (selectedRef.current === sessionKey) preparePromptSubmission(sessionKey);');
    const reset = submission.indexOf("if (typedCommand === ':stop')");
    expect(prepare).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(prepare);
    expect(commandRows).toContain('const timestamp = String(Date.now());');
  });

  it('timestamps local command rows at creation so later commands retain chronology', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_800_000_000_000);
      const first = commandMessage('session', 'first');
      vi.advanceTimersByTime(10);
      const second = commandMessage('session', 'second');
      expect(first.timestamp).toBe('1800000000000');
      expect(second.timestamp).toBe('1800000000010');
      expect(Number(second.timestamp)).toBeGreaterThan(Number(first.timestamp));
    } finally { vi.useRealTimers(); }
  });
});
