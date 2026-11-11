import { describe, expect, it } from 'vitest';
import { createTranscriptBuffer } from './transcriptVim';
import { captureSessionTranscriptViewportPosition, resolveSessionTranscriptViewportPosition } from './sessionTranscriptViewportPosition';

const answer = { id: 'answer', role: 'assistant' as const, text: 'one\ntwo\nthree' };
const buffer = createTranscriptBuffer([answer]);
describe('session viewport anchor identity', () => {
  it('captures viewport source identity without cursor-fallback policy', () => {
    expect(captureSessionTranscriptViewportPosition(buffer, 1, 0.4)).toEqual({ messageId: 'answer', lineInMessage: 1, rowOffset: 0.4 });
  });
  it('finds the same source line after older messages are prepended', () => {
    const anchor = captureSessionTranscriptViewportPosition(buffer, 1, 0.4)!;
    const next = createTranscriptBuffer([{ id: 'older', role: 'user', text: 'old' }, answer]);
    expect(resolveSessionTranscriptViewportPosition(next, anchor)).toBe(2);
  });
  it('does not restore an unrelated replacement or a line truncated out of the message', () => {
    const anchor = captureSessionTranscriptViewportPosition(buffer, 2, 0.4)!;
    expect(resolveSessionTranscriptViewportPosition(createTranscriptBuffer([{ ...answer, id: 'replacement' }]), anchor)).toBeNull();
    expect(resolveSessionTranscriptViewportPosition(createTranscriptBuffer([{ ...answer, text: 'one' }]), anchor)).toBeNull();
  });
  it.each([null, undefined, NaN, Infinity])('rejects an unavailable/nonfinite position: %s', position => {
    expect(captureSessionTranscriptViewportPosition(buffer, 1, position)).toBeNull();
  });
  it('rejects absent rows and preserves a signed pixel displacement', () => {
    expect(captureSessionTranscriptViewportPosition(buffer, 100, 0.4)).toBeNull();
    expect(captureSessionTranscriptViewportPosition(buffer, 1, -10.5)?.rowOffset).toBe(-10.5);
    expect(resolveSessionTranscriptViewportPosition(buffer, undefined)).toBeNull();
  });
});
