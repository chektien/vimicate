/** Invocation arguments are evidence. Prose, summaries and result bodies are not. */
export function validSkillName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,191}$/.test(value);
}

function normalizedToolName(name: string): string {
  return name.toLowerCase().replace(/^openclaw__/, '');
}

export function skillNameFromArguments(toolName: string, value: unknown): string | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const args = value as Record<string, unknown>;
  const name = normalizedToolName(toolName);
  let candidate: unknown;
  if (name === 'skill') candidate = args.skill;
  else if (name === 'skills_read' || name === 'skills.read') candidate = args.name;
  else if (name === 'skill_workshop' && args.action === 'read') candidate = args.skill_name;
  else if (['read', 'read_file'].includes(name)) candidate = skillFromPath(args.path ?? args.file_path ?? args.filePath);
  else if (['bash', 'exec', 'exec_command'].includes(name)) candidate = skillFromReadCommand(args.command ?? args.cmd);
  return validSkillName(candidate) ? candidate : undefined;
}

function skillFromPath(value: unknown): string | undefined {
  return typeof value === 'string' ? /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/.exec(value)?.[1] : undefined;
}

function skillFromReadCommand(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[;&|`$<>\n\r]/.test(value)) return undefined;
  // Deliberately recognize only simple reads. Compound scripts stay ordinary
  // tool calls rather than claiming that a mentioned path was read.
  const path = '(?:"([^"\\n]+)"|\'([^\'\\n]+)\'|(\\S+))';
  const match = new RegExp(`^(?:cat|head(?: -n \\d+)?|tail(?: -n \\d+)?|sed -n ['"]\\d+(?:,\\d+)?p['"]) ${path}\\s*$`).exec(value.trim());
  return match ? skillFromPath(match[1] ?? match[2] ?? match[3]) : undefined;
}

/** Inspect protocol outcome fields only. Shell reads need a witnessed zero exit. */
export function successfulSkillReadResult(toolName: string, value: unknown): boolean {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* Opaque result. */ } }
  const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const root = record(value);
  const envelopes = [root, record(root.details), record(root.structuredContent)];
  if (Array.isArray(root.content)) {
    for (const part of root.content) {
      const text = record(part).text;
      if (typeof text === 'string') { try { envelopes.push(record(JSON.parse(text))); } catch { /* Instruction text is not protocol. */ } }
    }
  }
  const exitCodes = envelopes.flatMap(item => [item.exit_code, item.exitCode].filter(code => typeof code === 'number'));
  if (envelopes.some(item => item.isError === true || item.is_error === true || ['failed', 'error', 'cancelled', 'aborted'].includes(String(item.status)))
    || exitCodes.some(code => code !== 0)) return false;
  return !['bash', 'exec', 'exec_command'].includes(normalizedToolName(toolName)) || exitCodes.includes(0);
}
