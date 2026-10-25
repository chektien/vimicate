export type SessionStatusProblem = { phase: 'failed'; detail: string };

export function sessionStatusProblem(payload: Record<string, unknown>, runId: string): SessionStatusProblem | null {
  if (!runId) return null;
  const searchable = printable(payload).replace(/\s+/g, ' ');
  const status = firstText(record(payload.session).status, record(payload.session).state, payload.status, payload.state).toLocaleLowerCase();
  const elapsedMs = firstDuration(payload, record(payload.session));
  const timedOut = /(?:time[ -]?out|timed out)/i.test(status) || /(?:time[ -]?out|timed out)/i.test(searchable);
  if (timedOut) return { phase: 'failed', detail: `Run ${runId} failed before assistant text: session timeout.` };
  const silentTail = /(?:tail has not produced useful progress|no useful (?:tail )?progress|beyond the prompt header)/i.test(searchable);
  if (/(?:^|\b)(?:running|active|processing)(?:\b|$)/i.test(status) && silentTail && elapsedMs >= 180_000) {
    return { phase: 'failed', detail: `Run ${runId} is still running in OpenClaw but silent after ${elapsedDescription(elapsedMs)}. Use :stop or :new before sending more.` };
  }
  return null;
}

export function sessionStatusSupplement(payload: Record<string, unknown>) {
  const session = record(payload.session);
  const elapsedMs = firstDuration(payload, session);
  const searchable = printable(payload).replace(/\s+/g, ' ');
  const silentTail = /(?:tail has not produced useful progress|no useful (?:tail )?progress|beyond the prompt header)/i.test(searchable);
  return [elapsedMs ? `elapsed ${elapsedDescription(elapsedMs)}` : '', silentTail ? 'tail has not produced useful progress beyond the prompt header' : ''].filter(Boolean);
}

function firstDuration(...records: Record<string, unknown>[]) {
  for (const value of records) {
    for (const key of ['elapsedMs', 'runtimeMs', 'activeForMs', 'durationMs']) {
      const duration = value[key]; if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) return duration;
    }
  }
  const source = printable(records);
  const minutes = source.match(/(?:about\s+)?(\d+(?:\.\d+)?)\s*minutes?/i); if (minutes) return Number(minutes[1]) * 60_000;
  const seconds = source.match(/(\d+(?:\.\d+)?)\s*seconds?/i); if (seconds) return Number(seconds[1]) * 1_000;
  return 0;
}

function elapsedDescription(elapsedMs: number) { const minutes = elapsedMs / 60_000; return minutes >= 1 ? `${Number(minutes.toFixed(1))}m` : `${Math.floor(elapsedMs / 1_000)}s`; }
function firstText(...values: unknown[]) { return values.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))?.trim() ?? ''; }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function printable(value: unknown) { try { return JSON.stringify(value); } catch { return String(value); } }
