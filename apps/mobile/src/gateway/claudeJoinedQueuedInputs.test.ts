import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { promptWithProjectContext } from './projectPromptContext';
import { joinedUserPromptEnvelopes, strippedUserPromptEnvelope } from './promptEnvelope';

const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const project = { id: 'example-cloud', sessionKey, name: 'example-cloud', path: '~/repos/example-cloud', branch: 'main', starred: false, threadCount: 1, state: 'idle' as const };
const wrap = (text: string) => promptWithProjectContext(text, project);
const first = 'also check whether the example package includes the listed feature.';
const second = 'and compare the optional features in the second example package.';
// Claude Code joins inputs queued during a turn with a newline.
const joined = `${wrap(first)}\n${wrap(second)}`;

const steer = (id: string, text: string, timestamp: number, rawSeq: number) => ({ role: 'user', content: wrap(text), timestamp,
  idempotencyKey: `${id}:user`, __openclaw: { id, idempotencyKey: `${id}:user`, transcriptPosition: { source: 'fixture-source', rawSeq } } });
const nativeJoined = { role: 'user', content: joined, timestamp: 3000, __openclaw: { id: 'joined', importedFrom: 'claude-cli', cliSessionId, externalId: 'joined' } };
const users = (messages: Record<string, unknown>[]) => messagesFromPayload({ sessionKey, sessionId, messages })
  .filter(row => row.role === 'user').map(row => `${row.id}:${row.text}`);

describe('Claude Code joined queued inputs', () => {
  it('splits a joined message into the authored prompts and never shows an envelope', () => {
    expect(joinedUserPromptEnvelopes(joined)).toEqual([first, second]);
    expect(strippedUserPromptEnvelope(joined)).toBe(`${first}\n\n${second}`);
    expect(joinedUserPromptEnvelopes(`${wrap(first)}\n[Tue 2026-10-06 16:41 GMT+8] ${wrap(second)}`)).toEqual([first, second]);
    expect(joinedUserPromptEnvelopes(wrap(first))).toBeNull();
    expect(joinedUserPromptEnvelopes(`hello\n${wrap(first)}`)).toBeNull();
  });

  // Physical example-project (6 Oct): two steers 23 s apart were joined by Claude and
  // imported as one native prompt with the second envelope mid-text, beside the
  // two positioned steer rows.
  it('drops the joined copy when each prompt already has its positioned row', () => {
    expect(users([steer('a', first, 1000, 11), steer('b', second, 2000, 12), nativeJoined]))
      .toEqual([`a:${first}`, `b:${second}`]);
  });

  it('keeps the joined copy, without envelopes, when a prompt has no positioned row', () => {
    expect(users([steer('a', first, 1000, 11), nativeJoined])).toEqual([`a:${first}`, `joined:${first}\n\n${second}`]);
    // A matching steer sent after the joined message is not one of its inputs.
    expect(users([steer('a', first, 1000, 11), steer('b', second, 4000, 12), nativeJoined]))
      .toContain(`joined:${first}\n\n${second}`);
  });
});
