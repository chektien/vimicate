import { SQLITE_FAMILY_CONTRACT } from './sqlite-history-family.mjs';

function check(value, message) { if (!value) throw new Error(`vimicate sqlite plugin: ${message}`); }
async function cancellable(promise, signal) {
  let cancel;
  const cancelled = new Promise((_, reject) => {
    cancel = () => reject(signal.reason ?? new Error('cancelled'));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener('abort', cancel); }
}

/** Register through OpenClaw's plugin API, not a compiled Gateway patch.
 * The registry must obtain capabilities from this live service instance.
 * Installation and the other registry/narration RPCs are separate gates. */
export function registerSqliteHistoryPlugin(api, { createFamily, formatError }) {
  check(typeof api?.registerGatewayMethod === 'function' && typeof api?.registerService === 'function'
    && typeof createFamily === 'function' && typeof formatError === 'function', 'missing plugin dependency');
  const lifecycle = new AbortController();
  let family, starting, failure, pending = 0;
  const disposed = new WeakSet();
  function dispose(candidate) {
    if (candidate && typeof candidate.dispose === 'function' && !disposed.has(candidate)) { disposed.add(candidate); candidate.dispose(); }
  }
  function capabilities() {
    return !lifecycle.signal.aborted && family?.isReady()
      ? { archivedSessionFamily: SQLITE_FAMILY_CONTRACT, sessionHistory: 'sqlite-display-v1' } : {};
  }
  async function start() {
    if (lifecycle.signal.aborted || family || failure) return;
    if (!starting) starting = (async () => {
      let candidate;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(new Error('history verification timed out')), 120_000);
      const signal = AbortSignal.any([lifecycle.signal, timeout.signal]);
      try {
        // Bound the wait but retain disposal responsibility for a late factory.
        const creating = Promise.resolve(createFamily({ signal })).then(created => {
          if (signal.aborted) { dispose(created); signal.throwIfAborted(); }
          return created;
        });
        candidate = await cancellable(creating, signal);
        signal.throwIfAborted();
        for (const name of ['start', 'request', 'isReady', 'dispose']) check(typeof candidate?.[name] === 'function', `missing family ${name}`);
        await cancellable(candidate.start({ signal }), signal);
        signal.throwIfAborted();
        check(candidate.isReady(), 'history verification did not become ready');
        family = candidate;
      } catch (error) {
        dispose(candidate);
        failure = error instanceof Error ? error : new Error(String(error));
        api.logger?.error?.(`vimicate SQLite history unavailable: ${failure.message}`);
      } finally { clearTimeout(timer); }
    })().finally(() => { starting = undefined; });
    return starting;
  }
  api.registerGatewayMethod('vimicate.history.family', async ({ params, respond }) => {
    let timer, admitted = false;
    try {
      check(!lifecycle.signal.aborted && family?.isReady(), 'history service is not ready');
      check(pending < 2, 'history service is busy'); pending++; admitted = true;
      const timeout = new AbortController();
      timer = setTimeout(() => timeout.abort(new Error('history request timed out')), 30_000);
      const signal = AbortSignal.any([lifecycle.signal, timeout.signal]);
      const payload = await cancellable(family.request(params, { signal }), signal);
      signal.throwIfAborted();
      respond(true, payload, undefined);
    } catch (error) {
      respond(false, undefined, formatError(error instanceof Error ? error.message : String(error)));
    } finally { if (timer) clearTimeout(timer); if (admitted) pending--; }
  }, { scope: 'operator.read' });
  api.registerService({ id: 'vimicate-sqlite-history', start, stop: async () => {
    lifecycle.abort(new Error('history service stopped'));
    dispose(family); family = undefined;
  } });
  return { capabilities, failure: () => failure };
}
