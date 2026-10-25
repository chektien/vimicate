export type GuardedSubmissionOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected' }
  | { kind: 'failed'; detail: string };

/**
 * AppShell launches submission from touch and hardware handlers without
 * awaiting the returned task. Keep an unexpected bridge/payload failure from
 * becoming an unhandled fatal exception at that fire-and-forget boundary.
 */
export async function guardedPromptSubmission(submit: () => Promise<boolean>): Promise<GuardedSubmissionOutcome> {
  try {
    return await submit() ? { kind: 'accepted' } : { kind: 'rejected' };
  } catch (error) {
    return { kind: 'failed', detail: error instanceof Error ? error.message : 'send failed' };
  }
}
