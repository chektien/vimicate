import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// These private read ports are the actual session-visibility and steering
// owners in this audited runtime, not projections or reconstructed run IDs.
const PROFILES = {
  '2026.10.4': { pins: {
    'sessions-read-DziXtPpO.mjs': '02d60e4771037b8cf246f0aa83a5570b5ad717f8c4ecceb1b68c3d443f7fcbfe',
    'reply-run-registry.registry-5e3UVXZS.mjs': '4d141908a0b6f903581f2e953dc8d38446e03c3455d4eeaba41adeecdf18a939',
    'reply-run-registry.state-DhKeZ1Xr.mjs': '4fe110843b0469adb58c55f2fe326fc03a179fcc15af15c5f0451ad68ff63b93',
    'run-state-BmDkKYBf.mjs': '6b21928883f520ec96d050fdc6f451b227ae245f6e9a9955084a49be6157e31c',
    'agent-run-registry-BaxMDLZF.mjs': 'ea569b02f30cc28f27dfe56458d47c60bd8b2b693ea896056769cd2db65ec5c3',
  }, names: ['sessions-read-DziXtPpO.mjs', 'reply-run-registry.registry-5e3UVXZS.mjs', 'agent-run-registry-BaxMDLZF.mjs'], contextKeys: ['l', 'p'] },
  '2026.10.5': { pins: {
    'sessions-read-DNOkgOd5.mjs': '44bff1e02592f0242ff345490adc4bb1fcdf9308a8fae278cceed218ddf2d268',
    // Stock or independently reproduced final composed strict-steer/CLI-handoff owner.
    // Both retain the native read target; unknown repairs still fail closed.
    'reply-run-registry.registry-BswPq0Xd.mjs': ['7ab8196cf3cddf96eab5765b1dde3c686c5085d916942f46f9a76d49b5ccf011',
      'a69b2d162f752ea30f041e4f69257d3b6dd287d87db04f25f3ce5c88d2d188f2'],
    'reply-run-registry.state-DS4CE9I7.mjs': 'c27af03874d14da4a6951b4326c69aa628c3872a961cefa82345cdf369c41984',
    'run-state-BXApJNXC.mjs': 'ca4fbd6c14101308a3f580092ae6df0d8faebcdcca2134a77c58476128f710a2',
    'agent-run-registry-zReSioYT.mjs': '044e05d84430cbf03f2229374ab2e1b755f2f9819817185db2c0e002f0e48db9',
  }, names: ['sessions-read-DNOkgOd5.mjs', 'reply-run-registry.registry-BswPq0Xd.mjs', 'agent-run-registry-zReSioYT.mjs'], contextKeys: ['u', 'm'] },
  // Exact stock and independently composed 10.6 native read owners.
  '2026.10.6': { pins: {
    'sessions-read-CLHMalI8.mjs': '78a3acefe7675edd60490fb15460821470a5174adc215e784866f6387d0835ff',
    'reply-run-registry.registry-BzgREenr.mjs': ['97fa852990fad79952a412b5d2b060545b1d8d090277e1a73fe9194c029d006f', '58b1acc4f8247f49db508c8dfd82a1480d3f1249cb60488446a982427c1c1acd'],
    'reply-run-registry.state-D1xBAHhE.mjs': '1a600e0c7e377af3b98505e353bb4150ce15951deed95a163d6009c3da5f27ed',
    'run-state-CteOnHdg.mjs': '88c5dbaca2efe6b7d81a8639fbee10bd68cf4ed7bdd73cd3f1d444fc8caa00f0',
    'agent-run-registry-B2Kia58i.mjs': 'c9f4f4f212243869e6139a2a4e164ea91d5c7d7e9e841cd2b0e2657cb6b4ab47',
  }, names: ['sessions-read-CLHMalI8.mjs', 'reply-run-registry.registry-BzgREenr.mjs', 'agent-run-registry-B2Kia58i.mjs'], contextKeys: ['u', 'm'] },
  // Exact stock and independently composed 10.7 native read owners.
  '2026.10.7': { pins: {
    'sessions-read-BXwTspcX.mjs': '99177eb84c5f83e9ec139265a82d74a7b40b87dc65c79fb453b77310c29bb5e1',
    'reply-run-registry.registry-CLWEwkqe.mjs': ['37065df16b88723461726b15c9c8a35fb58495a27e0427512c12610a86464cea',
      '3821fc29255382ef3442e001b1369c6eaa08e3a9b41956a7aa7eeea36cb6f941'],
    'reply-run-registry.state-BRc2hVR0.mjs': 'c95ff55271d25e7c177b43c4f08226a7e0a1a44f4f27824e25314fb05decfb0f',
    'run-state-BoegaeAc.mjs': '3c41fa35671a7751674613db4580fb0b70efa47b115dd28ef2280a39bbd3c99d',
    'agent-run-registry-B2Kia58i.mjs': 'c9f4f4f212243869e6139a2a4e164ea91d5c7d7e9e841cd2b0e2657cb6b4ab47',
  }, names: ['sessions-read-BXwTspcX.mjs', 'reply-run-registry.registry-CLWEwkqe.mjs', 'agent-run-registry-B2Kia58i.mjs'], contextKeys: ['u', 'm'] },
};
export async function loadSessionRunTruthRuntime(packageRoot) {
  const root = await fs.realpath(packageRoot);
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const profile = Object.hasOwn(PROFILES, metadata.version) ? PROFILES[metadata.version] : undefined;
  if (metadata.name !== 'openclaw' || !profile) throw new Error('Active-run identity requires an audited Gateway runtime.');
  for (const [name, hash] of Object.entries(profile.pins)) {
    const bytes = await fs.readFile(path.join(root, 'dist', name));
    const allowed = Array.isArray(hash) ? hash : [hash];
    if (!allowed.includes(crypto.createHash('sha256').update(bytes).digest('hex'))) throw new Error('Active-run identity runtime integrity mismatch.');
  }
  // Plugin capture imports duplicate module-local WeakMaps while retaining the
  // shared operation census. Load from the native package's parent identity so
  // the resolver sees the same attached backend as chat.send, not a captured
  // registry that mistakes that backend for unavailable. Node's ESM/require
  // cache is shared; this does not reconstruct or expose a different run ID.
  const nativeRequire = createRequire(path.join(root, 'package.json'));
  const load = name => nativeRequire(path.join(root, 'dist', name));
  const [{ t: handlers }, { g: registry }, contexts] = await Promise.all(profile.names.map(load));
  const [getAgentRunContext, hasLiveAgentRunContext] = profile.contextKeys.map(key => contexts[key]);
  if (typeof handlers?.['sessions.describe'] !== 'function' || typeof registry?.resolveCurrentMessageInjectionTarget !== 'function'
    || typeof getAgentRunContext !== 'function' || typeof hasLiveAgentRunContext !== 'function') throw new Error('Active-run identity read ports unavailable.');
  return { describe: handlers['sessions.describe'], registry, runContexts: { getAgentRunContext, hasLiveAgentRunContext } };
}

/**
 * Positive scheduled-origin proof for the exact steering target only. The
 * isolated cron runner claims its run context with a job map; announcements,
 * agent RPC continuations and interactive turns never do. Any missing, stale
 * or differently scoped fact is unknown, never "not scheduled".
 */
export function scheduledRunOrigin(runContexts, runId, sessionKey, sessionId) {
  if (!runContexts || !runId || typeof sessionId !== 'string' || !sessionId) return undefined;
  const context = runContexts.getAgentRunContext(runId);
  if (!context || !runContexts.hasLiveAgentRunContext(runId) || context.sessionKey !== sessionKey || context.sessionId !== sessionId) return undefined;
  const jobs = context.cronRunsByJobId;
  return jobs instanceof Map && jobs.size > 0 ? { kind: 'scheduled', runId, sessionId } : undefined;
}

/**
 * The attached owner that native strict steering names in run_not_ready. It is
 * current, open, not aborting and owned by the described concrete generation.
 * It is never a steering target and never replaces activeRunId.
 */
export function attachedCurrentRunId(registry, key, sessionId) {
  if (typeof registry?.resolveCurrentInterruptTarget !== 'function' || typeof registry.get !== 'function'
    || typeof sessionId !== 'string' || !sessionId.trim()) return '';
  const operation = registry.get(key);
  const target = registry.resolveCurrentInterruptTarget(key);
  const runId = typeof target?.runId === 'string' ? target.runId.trim() : '';
  if (!operation || !runId || target.isCurrent?.() !== true || registry.get(key) !== operation
    || operation.sessionId !== sessionId || operation.result != null || operation.abortSignal?.aborted !== false) return '';
  return runId;
}

export function createSessionRunTruthReader({ describe, registry, runContexts }) {
  return async options => {
    const { params, respond } = options;
    const key = params?.sessionKey;
    if (typeof key !== 'string' || !/^agent:[A-Za-z0-9_-]+:.+$/u.test(key) || key.length > 1024 || /[\r\n]/u.test(key) || Object.keys(params).some(name => name !== 'sessionKey')) {
      respond(false, undefined, { code: 'INVALID_REQUEST', message: 'One canonical session route is required.' }); return;
    }
    // Native describe retains the caller, visibility, incognito and sharing
    // checks. A hidden/denied route is never looked up in the live registry.
    await describe({ ...options, params: { key }, respond: (ok, payload, error) => {
      if (!ok || !payload?.session) { respond(ok, payload, error); return; }
      const session = payload.session;
      if (session.key !== key) { respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Use the canonical session route.' }); return; }
      options.signal?.throwIfAborted();
      if (options.hasCurrentClientAuthority && !options.hasCurrentClientAuthority()) throw new Error('Gateway read authority retired.');
      const target = registry.resolveCurrentMessageInjectionTarget(key);
      const runId = typeof target?.runId === 'string' ? target.runId.trim() : '';
      const origin = scheduledRunOrigin(runContexts, runId, key, session.sessionId);
      const attachedRunId = attachedCurrentRunId(registry, key, session.sessionId);
      // No injection target is not proof of idle. The runtime may be active
      // but not currently steerable, so never erase its busy state in that case.
      respond(true, { session: { key, ...(typeof session.sessionId === 'string' && session.sessionId.trim() ? { sessionId: session.sessionId } : {}), hasActiveRun: runId ? true : session.hasActiveRun,
        ...(runId ? { activeRunId: runId } : {}), ...(attachedRunId ? { attachedRunId } : {}), ...(origin ? { activeRunOrigin: origin } : {}), status: runId ? 'running' : session.status } });
    } });
  };
}

export function registerSessionRunTruth(api, { packageRoot }) {
  let pending;
  api.registerGatewayMethod('vimicate.runs.read', async options => {
    try {
      pending ??= loadSessionRunTruthRuntime(packageRoot).then(createSessionRunTruthReader);
      await (await pending)(options);
    } catch (error) {
      options.respond(false, undefined, { code: 'UNAVAILABLE', message: error instanceof Error ? error.message : 'Active-run identity unavailable.' });
    }
  }, { scope: 'operator.read' });
}
