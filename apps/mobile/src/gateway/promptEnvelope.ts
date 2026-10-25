const USER_PROMPT_MARKER = '\nUser prompt:\n';
const VIMICATE_ENVELOPE_HEADERS = [
  'Vimicate project context:',
  'Vimicate selected project context:',
  'Vimicate chat delivery instruction:',
] as const;

/**
 * Projects transport-only Vimicate prompt scaffolding back to authored text.
 * The marker is ignored unless the preceding text proves this is a known
 * Vimicate envelope, so authored prose containing "User prompt:" is retained.
 */
export function strippedUserPromptEnvelope(text: string) {
  const cron = text.match(/^(?:\[[^\]\n]+\]\s*)?\[cron:\S+\s+([^\]\n]+)\]/i);
  if (cron?.[1]?.trim()) return `⏰ cron: ${cron[1].trim()}`;
  return joinedUserPromptEnvelopes(text)?.join('\n\n') ?? strippedSingleEnvelope(text);
}

// A new envelope starts on its own line, optionally after a native timestamp.
const ENVELOPE_HEADER = '(?:\\[[^\\]\\n]+\\]\\s*)?Vimicate (?:project context|selected project context|chat delivery instruction):\\n';
const ENVELOPE_START = new RegExp(`\\n(?=${ENVELOPE_HEADER})`);
const STARTS_WITH_ENVELOPE = new RegExp(`^${ENVELOPE_HEADER}`);

/**
 * Claude Code joins inputs queued while it works into one user message, each
 * still wrapped in its own envelope. Two steers 23 s apart reproduced a second
 * envelope mid-prompt. Returns the authored prompts, or
 * null when the text is not two or more whole envelopes.
 */
export function joinedUserPromptEnvelopes(text: string): string[] | null {
  const pieces = text.split(ENVELOPE_START);
  if (pieces.length < 2 || !STARTS_WITH_ENVELOPE.test(text)) return null;
  const envelopes: string[] = [];
  let pending: string[] = [];
  for (const piece of pieces) {
    pending.push(piece);
    if (piece.includes(USER_PROMPT_MARKER)) { envelopes.push(pending.join('\n')); pending = []; }
  }
  if (pending.length) { if (!envelopes.length) return null; envelopes[envelopes.length - 1] += `\n${pending.join('\n')}`; }
  const prompts = envelopes.map(strippedSingleEnvelope);
  return prompts.length >= 2 && prompts.every((prompt, index) => prompt !== envelopes[index]) ? prompts : null;
}

function strippedSingleEnvelope(text: string) {
  const marker = text.indexOf(USER_PROMPT_MARKER);
  if (marker < 0) return text;
  const candidate = text.slice(0, marker);
  if (!VIMICATE_ENVELOPE_HEADERS.some((header) => candidate.includes(header))) return text;
  return text.slice(marker + USER_PROMPT_MARKER.length);
}
