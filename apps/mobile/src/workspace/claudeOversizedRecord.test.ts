import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from './historyMessageProjection';
import { CLAUDE_OVERSIZED_RECORD_PLACEHOLDER } from './claudeOversizedRecord';

const native = (id: string) => ({ id, importedFrom: 'claude-cli', cliSessionId: 'cli', externalId: id });
function project(role: string, extra: Record<string, unknown> = {}) {
  return messagesFromPayload({ sessionKey: 'k', sessionId: '33333333-3333-4333-8333-333333333333', messages: [
    { role: 'assistant', content: [{ type: 'toolcall', id: 'shot', name: 'Bash', arguments: { command: 'screenshot' } }], timestamp: 1, __openclaw: native('call') },
    { role, content: CLAUDE_OVERSIZED_RECORD_PLACEHOLDER, timestamp: 2, __openclaw: native('big'), ...extra },
  ] }).find(candidate => candidate.id === 'big');
}

describe('Claude CLI oversized native record', () => {
  it('projects an oversized native user record as tool output, not a prompt', () => {
    const row = project('user');
    expect(row?.role).toBe('tool');
    expect(row?.text).toContain('output omitted: over 1 MiB');
  });

  it('projects an oversized assistant record stopped for tool use as a tool call', () => {
    expect(project('assistant', { stopReason: 'tool_use' })?.role).toBe('tool');
  });

  it('keeps an oversized final answer as an assistant notice', () => {
    const row = project('assistant', { stopReason: 'end_turn' });
    expect(row?.role).toBe('assistant');
    expect(row?.text).toBe(CLAUDE_OVERSIZED_RECORD_PLACEHOLDER);
  });

  it('keeps an authored prompt that is exactly the placeholder text', () => {
    expect(project('user', { idempotencyKey: 'typed:user' })?.role).toBe('user');
    expect(messagesFromPayload({ sessionKey: 'k', messages: [{ role: 'user', content: CLAUDE_OVERSIZED_RECORD_PLACEHOLDER, timestamp: 3 }] })[0]?.role).toBe('user');
  });
});
