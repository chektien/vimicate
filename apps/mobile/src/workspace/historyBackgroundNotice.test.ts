import { expect, it } from 'vitest';
import { messagesFromPayload } from './historyMessageProjection';
import { buildVisibleTranscriptRenderRows } from '../transcript/transcriptVisibleRows';
const generation = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = `codex-undelivered:${generation}:${other}:${generation}`;
const detail = 'Native subagent fixture finished with status succeeded, but its completion could not be delivered. Automatic delivery has stopped.';
const raw = { id: 'notice', role: 'custom', customType: 'openclaw.system-note', display: true, idempotencyKey, __openclaw: { idempotencyKey }, content: detail };
const project = (message: Record<string, unknown>) => messagesFromPayload({ sessionKey: 'route', sessionId: generation, messages: [message] });
it('explains an explicitly identified undelivered background notification without claiming task outcome', () => {
  const [row] = project(raw);
  expect(row?.role).toBe('system');
  const [headline, diagnostic] = row!.text.split('\nTechnical details\n');
  expect(headline!.length).toBeLessThanOrEqual(140);
  expect(headline).toContain('Work may have finished');
  expect(headline).toContain('Refresh and check');
  expect(headline).not.toMatch(/succeeded|still running|message not sent/i);
  expect(diagnostic).toBe(detail);
  const [visible] = buildVisibleTranscriptRenderRows([row!], new Set());
  expect(visible?.compiled.source).toContain(headline);
  expect(visible?.compiled.source).not.toContain('Native subagent');
});
it('leaves authored lookalikes, conflicting keys, malformed identity and foreign scope unchanged', () => {
  for (const patch of [
    { role: 'user' }, { role: 'assistant' }, { customType: 'ordinary' }, { display: false },
    { idempotencyKey: `codex-undelivered:${generation}` }, { __openclaw: { idempotencyKey: 'conflict' } },
    { sessionKey: 'foreign' }, { sessionId: other },
  ]) expect(project({ ...raw, ...patch })[0]?.text).toBe(detail);
});
