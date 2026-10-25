import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { approvalCommandResolution } from './approvalCommand';

const approval = (id: string, allowedDecisions: ('allow-once' | 'allow-always' | 'deny')[] = ['allow-once', 'allow-always', 'deny']): WorkspaceMessage => ({ id: `row-${id}`, role: 'approval', text: id, sessionKey: 'one', approval: { id, kind: 'exec', allowedDecisions, resolved: false } });

describe('approval colon commands', () => {
  it('uses a sole pending item or an exact/unique id prefix', () => {
    expect(approvalCommandResolution(':approve', '', [approval('abc')], 'one').decision).toBe('allow-once');
    expect(approvalCommandResolution(':approve', 'abc always', [approval('abcdef'), approval('other')], 'one')).toMatchObject({ message: { id: 'row-abcdef' }, decision: 'allow-always' });
    expect(approvalCommandResolution(':deny', 'oth', [approval('abcdef'), approval('other')], 'one').decision).toBe('deny');
  });
  it('rejects ambiguity, absence, and a decision the request does not allow', () => {
    expect(() => approvalCommandResolution(':approve', 'a', [approval('abc'), approval('abd')], 'one')).toThrow(/more than one/);
    expect(() => approvalCommandResolution(':deny', '', [], 'one')).toThrow(/No pending/);
    expect(() => approvalCommandResolution(':approve', 'abc always', [approval('abc', ['allow-once'])], 'one')).toThrow(/not allowed/);
  });
  it('matches only explicit approval owners in the command target session', () => {
    const current = approval('abc'); const foreign = { ...approval('abd'), sessionKey: 'two' };
    expect(approvalCommandResolution(':approve', 'a', [current, foreign], 'one').message).toBe(current);
    expect(() => approvalCommandResolution(':approve', 'abd', [current, foreign], 'one')).toThrow(/No pending/);
    const unscoped = { ...current }; delete unscoped.sessionKey;
    expect(() => approvalCommandResolution(':approve', '', [unscoped], 'one')).toThrow(/No pending/);
    expect(() => approvalCommandResolution(':approve', '', [current], '')).toThrow(/No pending/);
  });
});
