// Opt-in, read-only inspection of pure installed schemas and normalizers.
// No Gateway, provider, transcript, manager or publication authority is invoked.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const core = process.env.VIMICATE_QUESTION_CORE_SOURCE;
const codex = process.env.VIMICATE_QUESTION_CODEX_SOURCE;
const fixture = JSON.parse(await readFile(new URL('../../fixtures/openclaw/question-support-context.json', import.meta.url), 'utf8'));
async function load(root, prefix, names) {
  const files = (await readdir(root)).filter(name => name.startsWith(prefix) && name.endsWith('.mjs'));
  const matches = [];
  for (const name of files) {
    const source = await readFile(path.join(root, name), 'utf8');
    const exported = source.slice(source.lastIndexOf('\nexport {'));
    if (names.every(name => new RegExp(`\\b${name} as \\w+`).test(exported))) matches.push({ name, source, exported });
  }
  assert.equal(matches.length, 1, `unique audited ${prefix} source`);
  const { name, source, exported } = matches[0];
  const module = await import(pathToFileURL(path.join(root, name)));
  return { source, sha256: createHash('sha256').update(source).digest('hex'),
    exports: Object.fromEntries(names.map(name => [name, module[exported.match(new RegExp(`\\b${name} as (\\w+)`))[1]]])) };
}

test('public question contracts do not publish supporting-content authority', { skip: !core || !codex }, async t => {
  for (const root of [core, codex]) assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, '2026.10.5');
  const schemas = await load(path.join(core, 'dist'), 'src-', ['QuestionRequestParamsSchema', 'QuestionRecordSchema', 'validateQuestionRequestParams']);
  const ask = await load(path.join(core, 'dist'), 'ask-user-tool-normalization-', ['normalizeAskUserParams']);
  const async = await load(path.join(codex, 'dist/.setup'), 'async-questions-', ['readCodexAsyncQuestions']);
  const require = createRequire(path.join(core, 'package.json'));
  const { Value } = await import(pathToFileURL(require.resolve('typebox/value')));
  const { QuestionRequestParamsSchema: requestSchema, QuestionRecordSchema: recordSchema,
    validateQuestionRequestParams: validate } = schemas.exports;
  const ref = fixture.hypotheticalContentReference;
  const { createdAtMs: _created, expiresAtMs: _expiry, status: _status, ...request } = fixture.registry;

  await t.test('closed request and record reject a fabricated content-reference extension', () => {
    assert.equal(validate(request), true);
    assert.equal(Value.Check(recordSchema, fixture.registry), true);
    assert.deepEqual(Object.keys(requestSchema.properties).sort(), ['agentId', 'id', 'questions', 'runId', 'sessionKey', 'timeoutMs']);
    assert.deepEqual(Object.keys(recordSchema.properties).sort(), ['agentId', 'answers', 'createdAtMs', 'expiresAtMs', 'id', 'questions', 'resolvedBy', 'runId', 'sessionKey', 'status']);
    assert.equal(validate({ ...request, supportingContent: ref }), false);
    assert.equal(Value.Check(recordSchema, { ...fixture.registry, supportingContent: ref }), false);
  });
  await t.test('model-facing blocking normalizer cannot smuggle in an anchor', () => {
    const args = { questions: fixture.registry.questions.map(({ questionId, ...q }) => {
      const { isOther: _other, ...rest } = q; return { id: questionId, ...rest };
    }) };
    const normalized = ask.exports.normalizeAskUserParams(args);
    assert.deepEqual(normalized.questions, fixture.registry.questions);
    assert.throws(() => ask.exports.normalizeAskUserParams({ ...args, supportingContent: ref }));
    assert.throws(() => ask.exports.normalizeAskUserParams({ questions: args.questions.map(q => ({ ...q, supportingContent: ref })) }));
  });
  await t.test('native async normalizer retains labels but no semantic content reference', () => {
    const parse = async.exports.readCodexAsyncQuestions;
    assert.deepEqual(parse(fixture.async.questions), fixture.async.questions);
    assert.deepEqual(parse(fixture.async.questions.map(q => ({ ...q, supportingContent: ref }))), fixture.async.questions);
    assert.equal(parse([{ title: '', supportingContent: ref }]), undefined);
    assert.equal(parse([{ title: 'Synthetic?', options: [] }]), undefined);
  });
  // Diagnostics bind the run to exact pure source bytes, without copying runtime files.
  t.diagnostic(JSON.stringify({ schemas: schemas.sha256, blockingNormalizer: ask.sha256, asyncNormalizer: async.sha256 }));
});
