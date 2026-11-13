/** Presentation only. Delivery facts come from receipts, never error prose.
 * Keep the explanation and next step on the first source line so the normal
 * machine-row fold hides technical details, not the recovery guidance. */
export const disconnectedSendNotice = 'Message not sent. Your draft is kept and is not queued. Pair or reconnect, then send when connected.';
export const activeCommandBlockedNotice = 'Command not sent. Your draft is kept. Wait for this task to finish, or send ordinary text to update it. Use :interrupt <prompt> only if you want to stop it and start a new turn.';

export function runFailureNoticeText(detail: string, options: { recorded?: boolean; background?: boolean; label?: string } = {}) {
  const saved = options.recorded ? 'Message saved. ' : 'This error does not confirm whether your message was saved. ';
  const label = options.label ?? 'Assistant could not complete this turn';
  const headline = options.background
    ? 'Background result delivery failed. This does not undo completed work. Refresh this conversation and check the result before requesting it again.'
    : `${label}. ${saved}${failureNextStep(detail)}`;
  return `${headline}\nTechnical details\n${detail.trim().slice(0, 1600) || 'OpenClaw did not provide an error detail.'}`;
}

/** Unwrap only our exact generated snapshot/live envelopes. Plain provider
 * text containing the same separator is not a generated notice. */
export function runFailureDetail(value: string) {
  const separator = '\nTechnical details\n';
  const offset = value.indexOf(separator);
  if (offset < 0) return value;
  const detail = value.slice(offset + separator.length);
  for (const label of ['Run failed', 'Run timed out', 'Assistant could not complete this turn', 'The assistant reported an error']) {
    if (runFailureNoticeText(detail, { label }) === value) return detail;
  }
  return runFailureNoticeText(detail, { background: true }) === value ? detail : value;
}

function failureNextStep(detail: string) {
  if (/Protected Codex continuation|parent-local inference relay|native thread is claimed by active work/i.test(detail)) {
    return 'Conversation recovery is required. Refresh and use :status to check earlier work, then ask for Gateway recovery if it stays blocked. Do not resend or reset this conversation.';
  }
  if (/rate.?limit|quota|usage limit|cooldown|\b429\b/i.test(detail)) {
    return 'The model usage limit is blocking progress. Check the model usage indicator for availability. No automatic retry is confirmed. When available, check the latest response before asking to continue. Do not resend the original prompt.';
  }
  if (/unauthorized|authentication|invalid.*(?:token|api.?key)|expired.*(?:token|credential)|\b401\b|\b403\b/i.test(detail)) {
    return 'Access needs attention. Ask the Gateway owner to restore access, then refresh this conversation before asking to continue. Do not resend the original prompt.';
  }
  if (/context.{0,20}(?:limit|length|window|full)|too many tokens/i.test(detail)) {
    return 'The conversation reached a model context limit. Ask for a continuation handoff. Do not reset the conversation or resend the original prompt.';
  }
  return 'Refresh this conversation and use :status to check the latest result before asking to continue. This error does not promise an automatic retry. Do not resend the original prompt.';
}

export function promptSendFailureText(detail: string, delivery: 'not-sent' | 'unconfirmed') {
  return delivery === 'unconfirmed'
    ? 'Delivery unconfirmed. Your message may already be saved or running. Reconnect, then refresh this conversation before taking further action. Do not resend while delivery is unknown.'
    : `Message not sent. Your draft is kept and is not queued. ${unsentNextStep(detail)}`;
}

export function promptSubmissionFailure(error: unknown, unconfirmed: boolean) {
  const raw = error instanceof Error ? error.message : 'send failed';
  const detail = promptSendFailureText(raw, unconfirmed ? 'unconfirmed' : 'not-sent');
  return { raw, detail, text: `${detail}\nTechnical details\n${raw.slice(0, 1600)}` };
}

function unsentNextStep(detail: string) {
  if (/active.run.changed|no.active.run/i.test(detail)) return 'Refresh this conversation, check the current task, then send the draft when ready.';
  if (/runtime update required|safe active-run controls/i.test(detail)) return 'Ask the Gateway owner to update active-task messaging support, then send the draft.';
  if (/not connected|disconnect|socket|connection/i.test(detail)) return 'Reconnect, then send the draft when connected.';
  if (/image|attachment|upload|encode/i.test(detail)) return 'Check or reattach the affected file, then send the draft.';
  if (/cannot accept steering|cannot receive|run.not.ready/i.test(detail)) return 'Wait for the current task to finish, then send the draft.';
  if (/rate.?limit|quota|usage limit|cooldown|\b429\b/i.test(detail)) return 'Check the model usage indicator, then send the draft when the limit clears.';
  if (/unauthorized|authentication|permission|forbidden|\b401\b|\b403\b/i.test(detail)) return 'Restore the required access, then send the draft. Ask the Gateway owner if access remains blocked.';
  return 'Check the details, resolve the problem, then send the draft when ready.';
}
