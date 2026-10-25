import { colonCommandInput } from './colonCommandInput';

export class SessionSubmissionGate {
  private readonly active = new Set<string>();

  acquire(sessionKey: string) {
    if (!sessionKey || this.active.has(sessionKey)) return false;
    this.active.add(sessionKey);
    return true;
  }

  release(sessionKey: string) { this.active.delete(sessionKey); }
  owns(sessionKey: string) { return this.active.has(sessionKey); }
}

const SOURCE_TAIL_NEUTRAL_COMMANDS = new Set([
  ':new-thread', ':close-thread', ':approvals', ':approve', ':deny', ':repair',
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
