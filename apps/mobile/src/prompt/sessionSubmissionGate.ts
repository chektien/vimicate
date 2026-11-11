import { colonCommandInput } from './colonCommandInput';

export const SUBMISSION_ADMISSION_WINDOW_MS = 5_000;

/**
 * One send per thread is inside its admission window at a time, so two Enter
 * presses cannot race. A send that outlives the window keeps its own outcome
 * handling and stops blocking the next: a steer into a Claude CLI turn is
 * acknowledged only when the run reaches its next tool boundary.
 */
export class SessionSubmissionGate {
  private readonly active = new Map<string, object>();

  /** The holder's own release, or null while another send holds the thread.
   * A send that still owns staged draft content, such as attachments kept
   * until acceptance, is not `bounded`: a second send would carry them again. */
  acquire(sessionKey: string, bounded = true): (() => void) | null {
    if (!sessionKey || this.active.has(sessionKey)) return null;
    const hold = {};
    const release = () => { clearTimeout(timer); if (this.active.get(sessionKey) === hold) this.active.delete(sessionKey); };
    const timer = bounded ? setTimeout(release, SUBMISSION_ADMISSION_WINDOW_MS) : undefined;
    this.active.set(sessionKey, hold);
    return release;
  }

  owns(sessionKey: string) { return this.active.has(sessionKey); }
}

const SOURCE_TAIL_NEUTRAL_COMMANDS = new Set([
  ':new-thread', ':close-thread', ':remove-project', ':approvals', ':approve', ':deny', ':repair',
]);

/** Whether this submission publishes a new row into its originating transcript. */
export function submissionOwnsSourceTailReveal(input: string) {
  const command = colonCommandInput(input)?.split(/\s+/, 1)[0]?.toLocaleLowerCase() ?? '';
  return !SOURCE_TAIL_NEUTRAL_COMMANDS.has(command);
}

export class SessionTailRevealRegistry {
  private readonly armed = new Set<string>();

  arm(sessionKey: string) { if (sessionKey) this.armed.add(sessionKey); }
  cancel(sessionKey: string) { this.armed.delete(sessionKey); }
  owns(sessionKey: string) { return this.armed.has(sessionKey); }

  consumeIfAdvanced(
    sessionKey: string,
    previousRowCount: number,
    nextRowCount: number,
    replacementTailPublished = false,
  ) {
    // Accepted ordinary prompts advance the source buffer. An accepted
    // `:new` is different: generation filtering can replace hundreds of old
    // rows with one durable boundary. That boundary is still a newly
    // published tail and must consume the same one-shot ownership.
    if (!this.armed.has(sessionKey)
      || (nextRowCount <= previousRowCount && !replacementTailPublished)) return false;
    this.armed.delete(sessionKey);
    return true;
  }
}
