import { expect, it } from 'vitest';
import { messagesFromPayload } from './historyMessageProjection';

const staged = '@/Users/example/.vimicate/agent/.openclaw-cli-images/3575f153ee3973be5029342ef2def1db7be336c249bb1fbc93335c99c858993c.png';
const imported = (content: unknown, id = 'imported') => ({ id, role: 'user', content, timestamp: 1_793_583_949_125, __openclaw: { id, importedFrom: 'claude-cli', cliSessionId: 'cli', externalId: id } });

it('drops a Claude import whose prompt is only a staged image reference, leaving the Gateway attachment row', () => {
  const rows = messagesFromPayload({ sessionKey: 's', messages: [
    { id: 'native', role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'media://inbound/shot.png' }, mimeType: 'image/png' }], timestamp: 1_793_583_945_709 },
    imported(staged),
  ] });
  expect(rows.filter(row => row.role === 'user').map(row => row.id)).toEqual(['native']);
  expect(rows.some(row => row.text.includes('.openclaw-cli-images'))).toBe(false);
});

it('keeps authored text around a staged reference and creates no unavailable attachment', () => {
  const [row] = messagesFromPayload({ sessionKey: 's', messages: [imported(`and then I noticed this bug\n\n${staged}`)] });
  expect(row).toMatchObject({ role: 'user', text: 'and then I noticed this bug' });
  expect(row?.attachments).toBeUndefined();
  const [parts] = messagesFromPayload({ sessionKey: 's', messages: [imported([{ type: 'text', text: `look ${staged}` }])] });
  expect(parts).toMatchObject({ text: 'look' });
});

it('leaves ordinary prompts, other paths and non-imported rows unchanged', () => {
  const plain = '@/Users/example/repo/README.md and screenshots/foo.png';
  expect(messagesFromPayload({ sessionKey: 's', messages: [imported(plain)] })[0]?.text).toBe(plain);
  const native = messagesFromPayload({ sessionKey: 's', messages: [{ id: 'n', role: 'user', content: staged }] });
  expect(native[0]?.text).toContain('.openclaw-cli-images');
});
