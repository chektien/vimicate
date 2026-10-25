import { describe, expect, it } from 'vitest';
import { promptWithProjectContext } from './projectPromptContext';
import { strippedUserPromptEnvelope } from './promptEnvelope';

describe('Vimicate prompt envelope projection', () => {
  it('round-trips the RN transport envelope to the exact authored prompt', () => {
    const authored = 'first line\n\nsecond line';
    const envelope = promptWithProjectContext(authored, {
      id: 'notes', sessionKey: 'agent:main:notes', name: 'notes', path: '~/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle',
    });
    expect(strippedUserPromptEnvelope(envelope)).toBe(authored);
  });

  it.each([
    'Vimicate project context:',
    'Vimicate selected project context:',
    'Vimicate chat delivery instruction:',
  ])('strips %s including a timestamp-prefixed native envelope', (header) => {
    expect(strippedUserPromptEnvelope(`[Wed 2026-05-20 11:30 GMT+8] ${header}\n- Project: notes (notes)\nUser prompt:\nhello`)).toBe('hello');
  });

  it('fails closed for ordinary authored text', () => {
    const authored = 'Notes\nUser prompt:\nthis is part of my message';
    expect(strippedUserPromptEnvelope(authored)).toBe(authored);
    expect(strippedUserPromptEnvelope('Vimicate project context without a marker')).toBe('Vimicate project context without a marker');
  });

  it('collapses a machine-generated cron trigger to its job marker', () => {
    expect(strippedUserPromptEnvelope('[cron:blc33058-5355-495b-88e9-e75d16edbf82 Morning Email Triage] You are running Morning Email Triage from a cron session.\n\n## Goal\nInternal steps')).toBe('⏰ cron: Morning Email Triage');
    expect(strippedUserPromptEnvelope('[Wed 2026-06-12 10:00 GMT+8] [cron:id Weekly Review] internal body')).toBe('⏰ cron: Weekly Review');
  });
});
