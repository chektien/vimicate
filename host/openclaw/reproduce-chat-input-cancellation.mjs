// Isolated investigation harness, not a runtime patch or live Gateway test.
// Usage: node host/openclaw/reproduce-chat-input-cancellation.mjs <package-root>
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const [root, scenario, observer] = process.argv.slice(2);
if (!root) throw new Error('Pass an audited OpenClaw package root; no default live target.');
const scenarios = ['cancel-during-save', 'cancel-before-save', 'upload-revoked',
  'authorization-changed', 'success', 'text-only'];
if (!scenario) {
  const results = [];
  for (const name of scenarios) for (const mode of ['stock', 'observe-input']) {
    const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), root, name, mode],
      { encoding: 'utf8', timeout: 10000 });
    results.push(JSON.parse(output));
  }
  console.log(JSON.stringify({ kind: 'isolated-function-reproduction', results }, null, 2));
} else {
  assert.ok(scenarios.includes(scenario));
  assert.ok(['stock', 'observe-input'].includes(observer));
  const dist = path.join(root, 'dist');
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.version, '2026.10.4', 'only the audited release is supported');
  const files = await readdir(dist);
  const source = async (prefix, marker) => {
    const names = files.filter(name => name.startsWith(prefix) && name.endsWith('.mjs'));
    const candidates = await Promise.all(names.map(name => readFile(path.join(dist, name), 'utf8')));
    const matching = candidates.filter(text => text.includes(marker));
    assert.equal(matching.length, 1, `unique ${prefix} implementation`);
    return matching[0];
  };
  const region = (text, name) => {
    const marker = `//#region ${name}\n`;
    assert.equal(text.split(marker).length, 2, `unique ${name} region`);
    return text.split(marker)[1].split('//#endregion')[0];
  };
  const handler = await source('chat-send-handler-', 'function prepareChatSendUserTurn(');
  const preparation = region(handler, 'src/gateway/server-methods/chat-send-user-turn.ts');
  const stockController = region(handler, 'src/gateway/server-methods/chat-user-turn-recorder.ts');
  const attachmentSource = await source('chat-attachments-', 'function persistInboundImagesForTranscript(');
  const persistence = attachmentSource.slice(attachmentSource.indexOf('async function persistInboundImagesForTranscript('),
    attachmentSource.indexOf('\nvar UnsupportedAttachmentError'));
  assert.ok(persistence.startsWith('async function'));
  // Candidate experiment only. Attach an observer without replacing the promise,
  // so consumers still reject with exactly the original error.
  const anchor = '\t\t\t\t...next\n\t\t\t}));';
  assert.equal(stockController.split(anchor).length, 2);
  const controller = observer === 'stock' ? stockController
    : stockController.replace(anchor, `${anchor}\n\t\t\tinputPromise.catch(() => void 0);`);
  const hash = text => createHash('sha256').update(text).digest('hex');
  const events = [];
  const handled = [];
  process.on('unhandledRejection', (reason, promise) => events.push({ reason, promise }));
  process.on('rejectionHandled', promise => handled.push(promise));
  const tick = () => new Promise(resolve => setImmediate(resolve));
  let releaseCreation;
  const creationGate = new Promise(resolve => { releaseCreation = resolve; });
  let admissionCurrent = scenario !== 'cancel-before-save';
  let uploadCurrent = true;
  let saveCalls = 0;
  let guardChecks = 0;
  let recorderOptions;
  class AuthorizationChanged extends Error {}
  const fault = scenario === 'authorization-changed' ? new AuthorizationChanged('synthetic authorization changed')
    : new Error(scenario === 'upload-revoked' ? 'synthetic upload revoked'
      : 'Chat admission ended or was cancelled; submit a new turn.');
  const admission = {
    originatingRoute: {}, sessionBinding: { sessionId: 'synthetic' },
    assertWorkAdmissionCurrent() { guardChecks++; if (!admissionCurrent) throw fault; },
    assertClientUploadAllowed() { if (!uploadCurrent) throw fault; },
  };
  const context = vm.createContext({
    Promise, Buffer, Set,
    isAcpBridgeClient: () => false,
    saveMediaBuffer: async (_bytes, _type, _dir, _max, _name, _extra, options) => {
      saveCalls++;
      await tick();
      if (scenario === 'cancel-during-save') admissionCurrent = false;
      if (scenario === 'upload-revoked') uploadCurrent = false;
      if (scenario === 'authorization-changed') throw fault;
      options.assertCommitAllowed();
      return { id: 'synthetic-image', path: 'synthetic-image', size: 1, contentType: 'image/png' };
    },
    discardPreparedInboundMedia: async entries => assert.equal(entries.length, 0),
    SessionMutationAuthorizationChangedError: AuthorizationChanged,
    buildManagedInboundMediaRef: id => `media:${id}`,
    formatErrorMessage: String,
    normalizeOptionalString: value => value,
    captureGatewayUiCommandTarget: () => undefined,
    resolveOperatorSessionCreation: () => ({}),
    prepareSkillLibrarySessionCreation: () => creationGate,
    isProgressCardRefreshInputProvenance: () => false,
    resolveChatSendCallerContext: () => ({}),
    resolveGatewayInputParticipant: () => undefined,
    gatewayClientSenderFields: () => ({}),
    buildRunUserTurnIdempotencyKey: id => id,
    normalizeMessageClientSources: () => [],
    hasGatewayAdminScope: () => false,
    createUserTurnTranscriptRecorder: options => { recorderOptions = options; return {}; },
    INLINE_IMAGE_DURABLE_OMISSION_MARKER: 'synthetic omitted image',
  });
  vm.runInContext(`${persistence}\n${preparation}\n${controller}`, context);
  const request = { p: {}, inboundMessage: 'synthetic input', rawMessage: 'synthetic input' };
  const session = { now: 0, clientRunId: 'synthetic', sessionKey: 'synthetic' };
  const userTurn = context.createGatewayChatUserTurnController({ admission, request, session });
  // The recorder lazily consumes resolveInput in stock. Hold session creation to
  // expose the interval before that consumer is reached, without any real I/O.
  const prepared = context.prepareChatSendUserTurn({ admission, request, session, userTurn,
    logGateway: { warn() { throw new Error('unexpected omission warning'); } },
    attachments: { parsedImages: scenario === 'text-only' ? [] : [{ data: 'AA==', mimeType: 'image/png' }],
      offloadedRefs: [], mediaPathOffloads: [], imageOrder: [], parsedMessage: 'synthetic input' } });
  const preparationResult = prepared.then(value => ({ value }), error => ({ error }));
  for (let i = 0; i < 8; i++) await tick();
  const beforeConsumption = events.length;
  const input = recorderOptions.resolveInput();
  const inputResult = input.then(value => ({ value }), error => ({ error }));
  releaseCreation({});
  const result = await inputResult;
  await preparationResult;
  await tick();
  const fails = !['success', 'text-only'].includes(scenario);
  assert.equal(beforeConsumption, fails && observer === 'stock' ? 1 : 0);
  assert.equal(events.length, beforeConsumption);
  if (fails) {
    assert.equal(result.error, fault, 'the native cancellation/authority error must still reject');
    if (observer === 'stock') {
      assert.equal(events[0].promise, input, 'unobserved promise belongs to transcript-input owner');
      assert.equal(events[0].reason, fault);
      assert.ok(handled.includes(input), 'later consumer is too late for process-level rejection');
    }
  } else {
    assert.equal(result.error, undefined);
    assert.equal(result.value.text, 'synthetic input');
    assert.equal(result.value.media?.length ?? 0, scenario === 'success' ? 1 : 0);
  }
  assert.equal(saveCalls, ['cancel-before-save', 'text-only'].includes(scenario) ? 0 : 1);
  console.log(JSON.stringify({ scenario, observer, unhandledRejections: beforeConsumption,
    consumerRejectedWithOriginalError: fails, saveCalls, guardChecks,
    hashes: { preparation: hash(preparation), controller: hash(stockController), persistence: hash(persistence) } }));
}
