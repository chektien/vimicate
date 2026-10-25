import { describe, expect, it } from 'vitest';
import { createTranscriptBuffer } from './transcriptVim';
import { captureSessionTranscriptViewportPosition, resolveSessionTranscriptViewportPosition } from './sessionTranscriptViewportPosition';

const answer = { id: 'answer', role: 'assistant' as const, text: 'one\ntwo\nthree' };
const buffer = createTranscriptBuffer([answer]);
describe('session viewport anchor identity', () => {
  it('captures source identity and distinguishes viewport review from cursor-only capture', () => {
    expect(captureSessionTranscriptViewportPosition(buffer, 1, 0.4, true)).toEqual({ messageId: 'answer', lineInMessage: 1, viewPosition: 0.4, viewportOwned: true });
    expect(captureSessionTranscriptViewportPosition(buffer, 1, 0.4, false)?.viewportOwned).toBe(false);
  });
  it('finds the same source line after older messages are prepended', () => {
    const anchor = captureSessionTranscriptViewportPosition(buffer, 1, 0.4, true)!;
    const next = createTranscriptBuffer([{ id: 'older', role: 'user', text: 'old' }, answer]);
    expect(resolveSessionTranscriptViewportPosition(next, anchor)).toBe(2);
  });
  it('does not restore an unrelated replacement or a line truncated out of the message', () => {
    const anchor = captureSessionTranscriptViewportPosition(buffer, 2, 0.4, true)!;
    expect(resolveSessionTranscriptViewportPosition(createTranscriptBuffer([{ ...answer, id: 'replacement' }]), anchor)).toBeNull();
    expect(resolveSessionTranscriptViewportPosition(createTranscriptBuffer([{ ...answer, text: 'one' }]), anchor)).toBeNull();
  });
  it.each([null, undefined, NaN, Infinity])('rejects an unavailable/nonfinite position: %s', position => {
    expect(captureSessionTranscriptViewportPosition(buffer, 1, position, true)).toBeNull();
  });
  it('rejects absent rows and bounds a finite position', () => {
    expect(captureSessionTranscriptViewportPosition(buffer, 100, 0.4, true)).toBeNull();
    expect(captureSessionTranscriptViewportPosition(buffer, 1, 3, true)?.viewPosition).toBe(1);
    expect(resolveSessionTranscriptViewportPosition(buffer, undefined)).toBeNull();
  });
});
