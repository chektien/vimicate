import { describe, expect, it } from 'vitest';
import { modelCatalogText, modelChoicesFromPayload, modelCommandIntent } from './modelCommandProjection';

describe('Vimicate model command projection', () => {
  it('turns every configured Gateway model into a directly pasteable colon-bar line', () => {
    const payload = { models: [
      { provider: 'openai', id: 'gpt-5.6-sol', available: true },
      { provider: 'anthropic', id: 'claude-opus-5', available: false },
      { provider: 'ignored-by-id', id: 'opencode-go/kimi-k2.6' },
      { provider: 'openai', id: 'gpt-5.6-sol' },
    ] };
    expect(modelChoicesFromPayload(payload)).toEqual([
      'openai/gpt-5.6-sol',
      'anthropic/claude-opus-5',
      'opencode-go/kimi-k2.6',
    ]);
    expect(modelCatalogText(payload)).toBe([
      ':models — configured OpenClaw model choices',
      'Yank a line below and paste it into the colon command bar.',
      '',
      'model default',
      'model openai/gpt-5.6-sol',
      'model anthropic/claude-opus-5',
      'model opencode-go/kimi-k2.6',
    ].join('\n'));
  });

  it('keeps bare models local and aliases an argument to the canonical model wire command', () => {
    expect(modelCommandIntent(':models', '')).toEqual({ type: 'catalog' });
    expect(modelCommandIntent(':models', 'openai/gpt-5.6-sol')).toEqual({
      type: 'switch',
      model: 'openai/gpt-5.6-sol',
      displayText: ':model openai/gpt-5.6-sol — changed this thread to openai/gpt-5.6-sol.',
    });
    expect(modelCommandIntent(':model', 'openai/gpt-5.6-sol')).toEqual({
      type: 'switch',
      model: 'openai/gpt-5.6-sol',
      displayText: ':model openai/gpt-5.6-sol — changed this thread to openai/gpt-5.6-sol.',
    });
    expect(modelCommandIntent(':status', '')).toBeNull();
  });

  it('maps the default keyword to a null wire model so the Gateway resets the thread instead of resolving "<provider>/default"', () => {
    const reset = {
      type: 'switch',
      model: null,
      displayText: ':model default — reset this thread to the configured default model.',
    };
    expect(modelCommandIntent(':model', 'default')).toEqual(reset);
    expect(modelCommandIntent(':models', 'default')).toEqual(reset);
    expect(modelCommandIntent(':model', '  Default ')).toEqual(reset);
    expect(modelCommandIntent(':model', 'openai/default')).toMatchObject({ type: 'switch', model: 'openai/default' });
  });

  it('shows a visible nonblank state when the Gateway returns no configured choices', () => {
    expect(modelCatalogText({ models: [] })).toContain('No configured model choices were returned.');
  });
});
