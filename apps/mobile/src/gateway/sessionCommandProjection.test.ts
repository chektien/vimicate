import { describe, expect, it } from 'vitest';
import { commandListText, healthcheckText, sessionStatusText, workspaceContextText } from './sessionCommandProjection';

describe('typed command projection', () => {
  it('formats sessions.describe without requiring an admin slash command', () => {
    expect(sessionStatusText({ session: { key: 'one', label: 'Example Thread', status: 'done', modelProvider: 'openai', model: 'gpt-5.6-sol', agentRuntime: { id: 'codex' }, thinkingLevel: 'medium', effectiveFastMode: false, totalTokens: 35169, contextTokens: 372000, estimatedCostUsd: 0.140463 } }, 'fallback')).toContain('state done  model openai/gpt-5.6-sol  runtime codex');
  });
  it('exposes enabled command registry entries as colon commands', () => {
    expect(commandListText([{ name: 'new', description: 'Reset' }, { name: 'status', description: '' }])).toBe(':new  Reset\n:status');
  });
  it('formats local workspace context and typed health without an agent run', () => {
    expect(workspaceContextText({ name: 'notes', id: 'notes', path: '~/notes', group: 'home', sessionKey: 'key' }, 'connected', false, 12)).toContain('gateway=connected run=idle');
    expect(healthcheckText({ ok: true, version: '2026.7.1' })).toBe(':healthcheck — ok\ngateway version 2026.7.1');
  });
});
