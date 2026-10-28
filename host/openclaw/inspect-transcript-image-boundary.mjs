/** Read-only, synthetic investigation of an exact audited runtime. Not repair acceptance. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [flag, directory, ...extra] = process.argv.slice(2);
assert(flag === '--package' && directory && !extra.length, 'usage: --package <trusted-installed-package>');
const audit = JSON.parse(await readFile(new URL('./transcript-image-boundary-20261006.json', import.meta.url)));
const root = resolve(directory);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json')));
assert(pkg.name === 'openclaw' && pkg.version === audit.runtime, 'unaudited runtime');
const sources = new Map();
for (const [name, digest] of Object.entries(audit.pins)) {
  const bytes = await readFile(resolve(root, 'dist', name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, `unaudited owner ${name}`);
  sources.set(name, bytes.toString('utf8'));
}
const load = name => import(pathToFileURL(resolve(root, 'dist', name)).href);
const { _: redact } = await load('redact-BeXveACv.mjs');
const { n: split } = await load('reply-directives-s-Q6bOJ0.mjs');
const { n: project, r: resolveBlock } = await load('transcript-image-artifacts-BNfLH5hX.mjs');
const { h: redactMessage } = await load('session-accessor.sqlite-transcript-store-DZB3Lw_U.mjs');
const { o: redactCliMessage } = await load('cli-session-history.claude-D2IdibKv.mjs');
const { t: createHookRunner } = await load('hooks-Cydhx3JC.mjs');
const image = '/workspace/GeneratedImages/aaaaaaaaaaaaa.png';
const markdown = `![Image](${image})`;
const results = [];
const check = (name, predicate) => { assert(predicate, name); results.push(name); };

check('ordinary-local-path-is-changed-by-tools-redaction', redact(markdown, { mode: 'tools' }) !== markdown);
check('custom-secret-pattern-is-still-applied', redact('fixture-secret-value', {
  mode: 'tools', patterns: ['fixture-secret-value'],
}) !== 'fixture-secret-value');
check('default-parser-does-not-admit-local-markdown', !split(markdown).mediaUrls?.length);
check('markdown-opt-in-alone-does-not-admit-local-path', !split(markdown, { extractMarkdownImages: true }).mediaUrls?.length);
check('explicit-local-allowlist-admits-exact-path', split(markdown, { markdownImageAllowlist: [image] }).mediaUrls?.[0] === image);
check('media-directive-path-is-not-an-opaque-reference', split(`MEDIA:${image}`).mediaUrls?.[0] === image
  && redact(image, { mode: 'tools' }) !== image);

const message = {
  role: 'assistant',
  __openclaw: { id: 'fixture-message', seq: 1, transcriptPosition: { source: 'fixture-generation', rawSeq: 0 } },
  content: [{ type: 'text', text: markdown }],
};
check('markdown-block-does-not-receive-native-image-artifact', project(message) === message);
// Exercise the real transcript envelope owner, not just the string helper.
const config = { logging: { redactPatterns: [] } };
const redactedMessage = redactMessage(message, config);
const redactedMarkdown = redactedMessage.content[0].text;
check('transcript-envelope-damages-the-same-markdown-destination', redactedMarkdown === redact(markdown, { mode: 'tools' }));
check('damaged-destination-no-longer-matches-original-media-allowlist',
  !split(redactedMarkdown, { markdownImageAllowlist: [image] }).mediaUrls?.length);
const colliding = { ...message, content: [{ type: 'text', text: markdown.replace('aaaaaaaaaaaaa', 'bbbbbbbbbaaaa') }] };
check('different-original-paths-collapse-to-the-same-redacted-destination',
  redactMessage(colliding, config).content[0].text === redactedMarkdown);
const structuredPath = { ...message, content: [{ type: 'image', url: image, mimeType: 'image/png' }] };
check('structured-local-url-alone-does-not-preserve-source-identity', redactMessage(structuredPath, config).content[0].url !== image);
check('cli-history-redaction-damages-the-same-markdown-destination', redactCliMessage(message).content[0].text === redactedMarkdown);
check('cli-private-action-link-overlay-does-not-restore-local-image', redactCliMessage(message, true).content[0].text === redactedMarkdown);
check('transcript-envelope-still-enforces-custom-patterns',
  redactMessage({ ...message, content: [{ type: 'text', text: 'fixture-secret-value' }] },
    { logging: { redactPatterns: ['fixture-secret-value'] } }).content[0].text !== 'fixture-secret-value');
// The supported plugin hook cannot await managed-media admission. This probe
// registers only an in-memory synthetic handler, never a live Gateway plugin.
const warnings = [];
const runner = createHookRunner({ typedHooks: [{ hookName: 'before_message_write', pluginId: 'synthetic-media-probe',
  handler: async () => ({ message: { ...message, content: [{ type: 'text', text: 'prepared' }] } }),
}] }, { logger: { warn: value => warnings.push(value) } });
check('async-plugin-transcript-hook-is-ignored', runner.runBeforeMessageWrite({ message }, { sessionKey: 'fixture' }) === undefined
  && warnings.length === 1 && warnings[0].includes('this hook is synchronous'));

const inline = { ...message, content: [{ type: 'image', data: 'AQ==', mimeType: 'image/png' }] };
const artifact = project(inline).content[0].artifactId;
check('native-image-artifact-binds-inline-content-and-generation', typeof artifact === 'string'
  && resolveBlock(inline, artifact) === inline.content[0]
  && resolveBlock({ ...inline, __openclaw: { ...inline.__openclaw, transcriptPosition: {
    source: 'replacement-generation', rawSeq: 0,
  } } }, artifact) === undefined);

const commit = sources.get('transcript-commit.runtime-ULhd5Zdu.mjs');
const redactAt = commit.indexOf('const redactedMessages = params.messages.map');
const prepareAt = commit.indexOf('Object.assign(message, prepareWorkerTurnTranscriptMessage');
check('native-worker-redacts-before-host-prepare', redactAt >= 0 && prepareAt > redactAt);
const custody = sources.get('chat-send-commentary-media-B-iib9_2.mjs');
check('managed-custody-materializes-only-after-update', custody.indexOf('onInternalSessionTranscriptUpdate((update)')
  < custody.indexOf('const blocks = await createManagedOutgoingMediaBlocks'));
console.log(JSON.stringify({ runtime: audit.runtime, status: audit.status, syntheticChecks: results }, null, 2));
