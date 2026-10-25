export type FinalAnswerPollingResult<T> =
  | { status: 'found'; value: T }
  | { status: 'cancelled' };

type FinalAnswerPollingOptions<T> = {
  fastDelaysMs: readonly number[];
  steadyDelayMs: number;
  wait: (delayMs: number) => Promise<void>;
  shouldContinue: () => boolean;
  load: () => Promise<T | undefined>;
  isFinal: (value: T) => boolean;
  onFastPathExhausted: () => void;
  onLoadFailure?: (error: unknown) => void;
};

/**
 * Canonical final answers can lag the run's terminal signal by longer than the
 * fast recovery window. Keep one slow confirmation owner alive until source
 * authority appears or lifecycle/session ownership cancels it; otherwise an
 * answer arriving without a parallel live frame can remain hidden forever.
 */
export async function pollForFinalAnswer<T>(options: FinalAnswerPollingOptions<T>): Promise<FinalAnswerPollingResult<T>> {
  let attempt = 0;
  let fastPathExhausted = options.fastDelaysMs.length === 0;
  if (fastPathExhausted) options.onFastPathExhausted();

  for (;;) {
    const delayMs = attempt < options.fastDelaysMs.length
      ? options.fastDelaysMs[attempt]!
      : options.steadyDelayMs;
    await options.wait(delayMs);
    if (!options.shouldContinue()) return { status: 'cancelled' };

    let value: T | undefined;
    try { value = await options.load(); }
    catch (error) { options.onLoadFailure?.(error); }
    if (!options.shouldContinue()) return { status: 'cancelled' };
    if (value !== undefined && options.isFinal(value)) return { status: 'found', value };

    attempt += 1;
    if (!fastPathExhausted && attempt >= options.fastDelaysMs.length) {
      fastPathExhausted = true;
      options.onFastPathExhausted();
    }
  }
}
