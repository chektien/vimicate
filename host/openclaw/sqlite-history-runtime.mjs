import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SQLITE_HISTORY_RUNTIME = '2026.10.6';
import { PROFILES } from './sqlite-history-profiles.mjs';

export const SQLITE_HISTORY_SUPPORTED_RUNTIMES = Object.freeze(Object.keys(PROFILES));
export function sqliteHistoryCheck(condition, message) {
  if (!condition) throw new Error(`vimicate sqlite history: ${message}`);
}
export function sqliteHistoryRevision(value) {
  sqliteHistoryCheck(value && (value.generation === null || (typeof value.generation === 'string'
    && value.generation.length > 0 && value.generation.length <= 256))
    && (value.maxSeq === null || (Number.isSafeInteger(value.maxSeq) && value.maxSeq >= 0)), 'invalid transcript watermark');
  return JSON.stringify([value.generation, value.maxSeq]);
}
function neverReplayOldestChatHistoryRecord() {
  return false;
}
export async function loadSqliteHistoryRuntime(packageRoot) {
  sqliteHistoryCheck(typeof packageRoot === 'string' && path.isAbsolute(packageRoot), 'absolute package root required');
  const info = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const profile = Object.hasOwn(PROFILES, info.version) ? PROFILES[info.version] : undefined;
  sqliteHistoryCheck(info.name === 'openclaw' && profile, 'unsupported OpenClaw runtime');
  for (const [filename, expected] of Object.entries(profile.pins)) {
    const bytes = await fs.readFile(path.join(packageRoot, 'dist', filename));
    const allowed = Array.isArray(expected) ? expected : [expected];
    sqliteHistoryCheck(allowed.includes(crypto.createHash('sha256').update(bytes).digest('hex')), 'private native reader fingerprint mismatch');
  }
  const load = relative => import(pathToFileURL(path.join(packageRoot, 'dist', relative)).href);
  if (profile.entrypoints) {
    // 9.6+ runs plugin imports from a private capture copy that omits worker
    // files. Pin this copy's workers to the installed package before any
    // reader module resolves its worker URL at evaluation.
    const [filename, key] = profile.entrypoints;
    const entrypoints = (await load(filename))[key];
    const transcript = entrypoints?.sessionTranscript;
    sqliteHistoryCheck(transcript?.distWorkerPath === 'config/sessions/session-transcript.worker.js',
      'native worker entrypoints differ');
    await fs.access(path.join(packageRoot, 'dist', transcript.distWorkerPath));
    for (const entry of Object.values(entrypoints)) {
      if (entry.root === undefined && entry.package === undefined) entry.root = packageRoot;
    }
  }
  const filenames = Object.keys(profile.pins);
  const [loaded, store] = await Promise.all([
    Promise.all(filenames.map(async filename => [filename, await load(filename)])),
    load('plugin-sdk/session-store-runtime.js'),
  ]);
  const modules = Object.fromEntries(loaded);
  // Normalize minified aliases at this versioned boundary, not in consumers.
  let mappedChat;
  let mappedReaders;
  let mappedDisplay;
  let readRevision;
  let preparePage;
  if (profile.bindings) {
    const select = ([filename, key]) => modules[filename][key];
    mappedChat = Object.fromEntries(Object.entries(profile.bindings.chat)
      .map(([stable, binding]) => [stable, select(binding)]));
    if (profile.bindings.preparePage) preparePage = select(profile.bindings.preparePage);
    mappedChat.o = neverReplayOldestChatHistoryRecord;
    mappedReaders = { _: select(profile.bindings.readers) };
    mappedDisplay = { t: select(profile.bindings.display) };
    readRevision = select(profile.bindings.accessor);
  } else {
    const [chatName, readersName, displayName, accessorName] = filenames;
    const stableKeys = ['i', 'r', 'c', 'a', 'o'];
    mappedChat = Object.fromEntries(stableKeys.map((key, i) => [key, modules[chatName][profile.chatKeys[i]]]));
    mappedReaders = { _: modules[readersName][profile.readersKey ?? '_'] };
    mappedDisplay = modules[displayName];
    readRevision = modules[accessorName][profile.accessorKey ?? 't'];
  }
  sqliteHistoryCheck([...Object.values(mappedChat), mappedReaders._, mappedDisplay.t, readRevision,
    store.getSessionEntry, store.listSessionEntries, store.resolveTranscriptSessionKeyBySessionId,
    ...(profile.bindings?.preparePage ? [preparePage] : [])]
    .every(value => typeof value === 'function'), 'native reader exports differ');
  return { chat: mappedChat, readers: mappedReaders, display: mappedDisplay, store, readRevision, preparePage };
}
