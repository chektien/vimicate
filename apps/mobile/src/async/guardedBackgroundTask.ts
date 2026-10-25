export function guardedBackgroundTaskDetail(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/**
 * React Native touch/key callbacks intentionally do not await background work.
 * Own both synchronous bridge throws and asynchronous rejections so neither
 * can escape as an unhandled JavaScript fatal.
 */
export function launchGuardedBackgroundTask(
  task: () => unknown | Promise<unknown>,
  onFailure: (error: unknown) => void = () => undefined,
) {
  const report = (error: unknown) => {
    try { onFailure(error); } catch { /* A diagnostic callback cannot revive the original failure. */ }
  };
  try { void Promise.resolve(task()).catch(report); }
  catch (error) { report(error); }
}
