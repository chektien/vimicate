// Test-only lifecycle owner. Cold native capture is not archive read latency.
export function awaitArchiveFixture(child, {
  label, startupMs, operationMs = 30_000, closedEvent, stop,
}) {
  return new Promise((resolve, reject) => {
    let phase = 'initialization';
    let failure;
    let ready = false;
    let stdout = '', stderr = '';
    let timer;
    const started = performance.now();
    let initialized;
    const fail = error => {
      if (failure) return;
      failure = error;
      clearTimeout(timer);
      // Settlement belongs to close/exit, not to the request to terminate.
      // The caller must not remove the fixture while a worker still uses it.
      try {
        Promise.resolve(stop()).catch(error => { failure = new AggregateError([failure, error]); });
      } catch (error) { failure = new AggregateError([failure, error]); }
    };
    const arm = ms => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error(`${label} ${phase} timed out after ${ms}ms`)), ms);
    };
    const append = (stream, data) => {
      if (failure) return;
      if (stream === 'stdout') stdout += data;
      else stderr += data;
      if (stdout.length + stderr.length > 4 * 1024 * 1024) fail(new Error(`${label} output limit exceeded`));
    };
    const out = data => append('stdout', data);
    const err = data => append('stderr', data);
    const message = value => {
      if (failure || value?.type !== 'archive-reader-ready') return;
      if (ready) return fail(new Error(`${label} duplicate reader readiness`));
      ready = true;
      initialized = performance.now();
      phase = 'paging/disposal';
      arm(operationMs);
    };
    const error = value => fail(value);
    child.stdout?.on('data', out);
    child.stderr?.on('data', err);
    child.on('message', message);
    child.once('error', error);
    child.once(closedEvent, (code, signal) => {
      clearTimeout(timer);
      child.off('message', message);
      child.off('error', error);
      child.stdout?.off('data', out);
      child.stderr?.off('data', err);
      if (failure || code !== 0 || signal || !ready) {
        reject(new Error(`${failure?.message ?? `${label} exited before successful completion (${code}, ${signal ?? 'no signal'}, ready=${ready})`}\n${stderr}`, { cause: failure }));
      } else resolve({ stdout, stderr, initializationMs: initialized - started,
        operationMs: performance.now() - initialized });
    });
    arm(startupMs);
  });
}
