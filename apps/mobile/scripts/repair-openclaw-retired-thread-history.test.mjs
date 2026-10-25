import { describe, expect, it } from 'vitest';

import {
  parseArguments,
  transcriptHeader,
} from './repair-openclaw-retired-thread-history.mjs';

const retiredSessionId = '00000000-0000-4000-a000-000000000148';
const currentSessionId = '00000000-0000-4000-9000-000000000108';

function requiredArguments() {
  return [
    '--state-dir', '/tmp/openclaw',
    '--vimicate-dir', '/tmp/vimicate',
    '--stable-session-key', 'agent:main:dashboard:thread',
    '--retired-session-file', `/tmp/openclaw/${retiredSessionId}.jsonl.deleted.2026-08-27T11-07-01.146Z`,
    '--retired-session-id', retiredSessionId,
    '--current-session-id', currentSessionId,
    '--session-accessor', '/tmp/session-accessor.js',
    '--bootstrap-script', '/tmp/bootstrap.mjs',
  ];
}

describe('retired-thread history recovery', () => {
it('is dry-run unless explicitly applied', () => {
  const dryRun = parseArguments(requiredArguments());
  const apply = parseArguments([...requiredArguments(), '--apply']);
  expect(dryRun.apply).toBe(false);
  expect(apply.apply).toBe(true);
  expect(apply.stableSessionKey).toBe('agent:main:dashboard:thread');
});

it('rejects identical concrete generations', () => {
  const argumentsValue = requiredArguments();
  const currentIndex = argumentsValue.indexOf('--current-session-id') + 1;
  argumentsValue[currentIndex] = retiredSessionId;
  expect(
    () => parseArguments(argumentsValue),
  ).toThrow(/retired and current session ids must differ/);
});

it('returns a transcript header immutable epoch', () => {
  const bytes = Buffer.from(`${JSON.stringify({
    type: 'session',
    version: 3,
    id: currentSessionId,
    timestamp: '2026-08-28T00:59:11.359Z',
  })}\n`);
  expect(transcriptHeader(bytes, currentSessionId, 'current')).toEqual({
    startedAtMs: 1787878751359,
    timestamp: '2026-08-28T00:59:11.359Z',
  });
});

it('rejects a transcript header with a mismatched session id', () => {
  const bytes = Buffer.from(`${JSON.stringify({
    type: 'session',
    version: 3,
    id: retiredSessionId,
    timestamp: '2026-08-28T00:59:11.359Z',
  })}\n`);
  expect(
    () => transcriptHeader(bytes, currentSessionId, 'current'),
  ).toThrow(/header disagrees with declared authority/);
});
});
