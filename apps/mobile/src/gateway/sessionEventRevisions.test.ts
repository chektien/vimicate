import { expect, it } from 'vitest';
import { SessionEventRevisions } from './sessionEventRevisions';

it('advances only the named session and counts catalog changes separately', () => {
  const owner = new SessionEventRevisions();
  const a0 = owner.revision('a'); const b0 = owner.revision('b');
  owner.note({ type: 'event', event: 'session.message', payload: { sessionKey: 'a' } });
  expect(owner.revision('a')).not.toBe(a0); expect(owner.revision('b')).toBe(b0); expect(owner.catalogRevision).toBe(0);
  owner.note({ type: 'event', event: 'sessions.changed', payload: { sessionKey: 'b', reason: 'activity-summary' } });
  expect(owner.catalogRevision).toBe(0);
  owner.note({ type: 'event', event: 'sessions.changed', payload: { sessionKey: 'b', reason: 'create' } });
  expect(owner.catalogRevision).toBe(1);
  owner.note({ type: 'res', id: 'x', payload: { sessionKey: 'a' } });
  expect(owner.catalogRevision).toBe(1);
});
