import { describe, expect, it } from 'vitest';
import { beginCommandOperation, settleCommandOperation } from './commandOperation';

describe('causal command operation', () => {
  it('settles one stable row in its invocation slot while later rows arrive', () => {
    const started = beginCommandOperation([{ id: 'before', role: 'assistant', text: 'before' }], 'op', 'one', ':status');
    const withLater = [...started, { id: 'later', role: 'assistant' as const, text: 'later' }];
    expect(settleCommandOperation(withLater, 'op', ':status — done').map((message) => message.id)).toEqual(['before', 'op', 'later']);
    expect(settleCommandOperation(withLater, 'op', ':status — done')[1]).toMatchObject({ text: ':status — done', state: 'complete' });
  });
});
