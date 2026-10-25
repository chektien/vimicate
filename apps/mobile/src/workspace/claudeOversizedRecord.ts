/** OpenClaw's Claude CLI history reader replaces any native record over 1 MiB with this text. */
export const CLAUDE_OVERSIZED_RECORD_PLACEHOLDER = '[Claude CLI history record omitted from context because it exceeded 1 MiB.]';

/**
 * The placeholder drops the record's structure. A native user record that
 * large is tool output (a screenshot or image), and a native assistant record
 * stopped for tool use is a call, so restore those as tool traffic; an
 * oversized final answer keeps the notice. Only records the Claude reader
 * imported qualify: an authored prompt quoting the text keeps its role.
 */
export function claudeOversizedRecordContent(raw: Record<string, unknown>) {
  const content = raw.content ?? raw.text ?? raw.message ?? raw.body;
  if (typeof content !== 'string' || content.trim() !== CLAUDE_OVERSIZED_RECORD_PLACEHOLDER) return content;
  const meta = raw.__openclaw;
  const native = typeof meta === 'object' && meta !== null && (meta as Record<string, unknown>).importedFrom === 'claude-cli'
    && !(meta as Record<string, unknown>).transcriptPosition && !raw.idempotencyKey && !(meta as Record<string, unknown>).idempotencyKey;
  if (!native) return content;
  const stopReason = raw.stopReason ?? raw.stop_reason;
  if (raw.role === 'user') return [{ type: 'tool_result', content: 'output omitted: over 1 MiB, often a screenshot or image' }];
  if (raw.role === 'assistant' && (stopReason === 'tool_use' || stopReason === 'toolUse')) return [{ type: 'toolcall', name: 'tool', arguments: { omitted: 'call over 1 MiB' } }];
  return content;
}
