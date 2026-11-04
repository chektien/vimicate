import { expect, it } from 'vitest';
import { messagesFromPayload } from './historyMessageProjection';
import { coalesceTranscriptIdentities } from '../gateway/transcriptIdentityWall';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { mergeLatestHistory } from '../gateway/historyPagination';

const staged = '@/Users/example/.vimicate/agent/.openclaw-cli-images/3575f153ee3973be5029342ef2def1db7be336c249bb1fbc93335c99c858993c.png';
const imported = (content: unknown, id = 'imported') => ({ id, role: 'user', content, timestamp: 1_793_583_949_125, __openclaw: { id, importedFrom: 'claude-cli', cliSessionId: '738173ed-b516-4427-9176-ca5c9ad75784', externalId: id } });

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

it('keeps an image-only imported prompt as a placeholder when no Gateway image row exists', () => {
  const rows = messagesFromPayload({ sessionKey: 's', messages: [imported(staged)] });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ role: 'user', text: 'Image attached' });
});

it('never rewrites a staged path the author put in code', () => {
  const fenced = `why does this path show?\n\n\`\`\`\n${staged}\n\`\`\``;
  expect(messagesFromPayload({ sessionKey: 's', messages: [imported(fenced)] })[0]?.text).toContain('.openclaw-cli-images');
  const inline = `this path \`${staged}\` leaks`;
  expect(messagesFromPayload({ sessionKey: 's', messages: [imported(inline)] })[0]?.text).toContain('.openclaw-cli-images');
});

it('treats a Gateway row carrying native image media as the counterpart', () => {
  const rows = messagesFromPayload({ sessionKey: 's', messages: [
    { id: 'native', role: 'user', content: '', timestamp: 1_793_583_945_709, __openclaw: { id: 'native', media: [{ kind: 'image', contentType: 'image/png', url: 'media://inbound/shot.png' }] } },
    imported(staged),
  ] });
  expect(rows.some(row => row.text === 'Image attached')).toBe(false);
});

it('respects CommonMark fence length and character when deciding what is authored code', () => {
  const text = `~~~~\n\`\`\`\n${staged}\n~~~~`;
  expect(messagesFromPayload({ sessionKey: 's', messages: [imported(text)] })[0]?.text).toContain('.openclaw-cli-images');
});

it('drops a placeholder once the Gateway image row arrives on another history page', () => {
  const importedPage = messagesFromPayload({ sessionKey: 's', messages: [imported(staged)] });
  const nativePage = messagesFromPayload({ sessionKey: 's', messages: [
    { id: 'native', role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'media://inbound/shot.png' }, mimeType: 'image/png' }], timestamp: 1_793_583_945_709 },
  ] });
  expect(importedPage[0]?.text).toBe('Image attached');
  const merged = coalesceTranscriptIdentities([...nativePage, ...importedPage]);
  expect(merged.filter(row => row.role === 'user').map(row => row.id)).toEqual(['native']);
});

const nativeImage = { id: 'native', role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'media://inbound/shot.png' }, mimeType: 'image/png' }], timestamp: 1_793_583_945_709 };
const generation = '11111111-1111-4111-8111-111111111111';

it.each(['Image attached', `Image attached ${staged}`])('preserves authored placeholder wording %s across page merges and cache restoration', (content) => {
  const importedPage = messagesFromPayload({ sessionKey: 's', sessionId: generation, messages: [imported(content)] });
  const nativePage = messagesFromPayload({ sessionKey: 's', sessionId: generation, messages: [nativeImage] });
  expect(coalesceTranscriptIdentities([...nativePage, ...importedPage]).map(row => row.id)).toEqual(['native', 'imported']);
  expect(coalesceTranscriptIdentities([...nativePage, ...parsedTranscriptCache(serializedTranscriptCache(importedPage))]).map(row => row.id)).toEqual(['native', 'imported']);
});

it('retains synthesized placeholder provenance across cache restoration and both merge orders', () => {
  const importedPage = messagesFromPayload({ sessionKey: 's', sessionId: generation, messages: [imported(staged)] });
  const restored = parsedTranscriptCache(serializedTranscriptCache(importedPage));
  expect(restored[0]?.stagedImagePlaceholder).toBe(true);
  const nativePage = messagesFromPayload({ sessionKey: 's', sessionId: generation, messages: [nativeImage] });
  for (const rows of [[...nativePage, ...restored], [...restored, ...nativePage]]) {
    expect(coalesceTranscriptIdentities(rows).map(row => row.id)).toEqual(['native']);
  }
});

it('preserves newly authored text replacing a synthesized placeholder with the same identity', () => {
  const payload = (content: string) => messagesFromPayload({ sessionKey: 's', sessionId: generation, messages: [imported(content)] });
  const nativePage = messagesFromPayload({ sessionKey: 's', sessionId: generation, messages: [nativeImage] });
  expect(coalesceTranscriptIdentities([...payload(staged), ...payload('Image attached'), ...nativePage]).map(row => row.id)).toContain('imported');
  const refreshed = mergeLatestHistory(payload('Image attached'), payload(staged), 's');
  expect(coalesceTranscriptIdentities([...refreshed, ...nativePage]).map(row => row.id)).toContain('imported');
});

it('keeps ambiguous imports and never uses one image to hide a second prompt on a later page', () => {
  const payload = (messages: unknown[]) => messagesFromPayload({ sessionKey: 's', sessionId: generation, messages });
  const first = imported(staged, 'first');
  const second = { ...imported(staged, 'second'), timestamp: first.timestamp + 30_000 };
  expect(payload([nativeImage, first, second]).map(row => row.id)).toEqual(['native', 'first', 'second']);
  const onceMatched = payload([nativeImage, first]);
  expect(onceMatched.map(row => row.id)).toEqual(['native']);
  const restored = parsedTranscriptCache(serializedTranscriptCache(onceMatched));
  expect(coalesceTranscriptIdentities([...restored, ...payload([second])]).map(row => row.id)).toEqual(['native', 'second']);
  expect(coalesceTranscriptIdentities([...restored, ...payload([first])]).map(row => row.id)).toEqual(['native']);
});

it.each([
  ['other-session', generation],
  ['s', '22222222-2222-4222-8222-222222222222'],
  ['s', undefined],
])('does not match a placeholder to an image outside its route/generation %s %s', (sessionKey, sessionId) => {
  const importedPage = messagesFromPayload({ sessionKey: 's', sessionId: generation, messages: [imported(staged)] });
  const nativePage = messagesFromPayload({ sessionKey, sessionId, messages: [nativeImage] });
  expect(coalesceTranscriptIdentities([...nativePage, ...importedPage]).map(row => row.id)).toEqual(['native', 'imported']);
});
