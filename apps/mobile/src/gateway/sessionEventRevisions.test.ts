import { expect, it } from 'vitest';
import { SessionEventRevisions } from './sessionEventRevisions';

it('advances only the named session, including payload.key, and ignores responses', () => {
  const owner = new SessionEventRevisions();
  const a0 = owner.revision('a'); const b0 = owner.revision('b');
  owner.note({ type: 'event', event: 'session.message', payload: { sessionKey: 'a' } });
  expect(owner.revision('a')).not.toBe(a0); expect(owner.revision('b')).toBe(b0);
  owner.note({ type: 'event', event: 'sessions.changed', payload: { key: 'b', reason: 'activity-summary' } });
  expect(owner.revision('b')).not.toBe(b0);
  const a1 = owner.revision('a');
  owner.note({ type: 'res', id: 'x', payload: { sessionKey: 'a' } });
  expect(owner.revision('a')).toBe(a1);
});
