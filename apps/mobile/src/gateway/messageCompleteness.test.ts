import { describe, expect, it } from 'vitest';
import { assistantHistoryOmissionIsRecoverable, assistantTextIsGatewayIncomplete, assistantTextIsGatewayTruncated, concreteGatewayMessageID } from './messageCompleteness';

describe('gateway message completeness', () => {
  it('recognizes the authoritative clipped-answer marker', () => {
    expect(assistantTextIsGatewayTruncated(`${'x'.repeat(8_000)}...(truncated)...`)).toBe(true);
    expect(assistantTextIsGatewayTruncated('The word (truncated) appears here, but the answer continues.')).toBe(false);
  });

  it('requires the exact Gateway oversized descriptor before offering omission recovery', () => {
    const placeholder = '[chat.history omitted: message too large]';
    expect(assistantHistoryOmissionIsRecoverable(placeholder, { truncated: true, reason: 'oversized' })).toBe(true);
    expect(assistantTextIsGatewayIncomplete(placeholder)).toBe(true);
    expect(assistantHistoryOmissionIsRecoverable(placeholder, { truncated: true, reason: 'budget' })).toBe(false);
    expect(assistantHistoryOmissionIsRecoverable(`quoted ${placeholder}`, { truncated: true, reason: 'oversized' })).toBe(false);
    expect(assistantHistoryOmissionIsRecoverable(` ${placeholder}`, { truncated: true, reason: 'oversized' })).toBe(false);
    expect(assistantHistoryOmissionIsRecoverable(placeholder, null)).toBe(false);
  });

  it('does not treat synthesized display ids as retrievable source ids', () => {
    expect(concreteGatewayMessageID('msg_018xyz')).toBe('msg_018xyz');
    expect(concreteGatewayMessageID('history-offset')).toBe('');
    expect(concreteGatewayMessageID('history-1abc')).toBe('');
  });
});
