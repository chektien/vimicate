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
    const reason = error instanceof Error ? error.message : 'Unexpected send error';
    return { kind: 'failed', detail: `Your draft is kept, but delivery is not verified. Refresh this conversation and check for your message or reply. Do not resend while delivery is unknown. Technical details follow. ${reason.slice(0, 1600)}` };
  }
}
