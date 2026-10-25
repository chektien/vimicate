import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export type TranscriptSkillInvocation = {
  label: string;
  start: number;
  end: number;
};

export type TranscriptSkillEvidence = Pick<TranscriptSkillInvocation, 'label'>;

const skillReferenceNouns = new Set(['gateway', 'process', 'protocol', 'review', 'skill', 'workflow']);

/**
 * Finds the authored name for a proven skill without rewriting transcript
 * source. Exact names win. Domain-facing aliases such as "privacy gateway"
 * are then derived only from meaningful tokens in the proven skill id.
 */
export function transcriptSkillReference(source: string, skillLabel: string): Pick<TranscriptSkillInvocation, 'start' | 'end'> | null {
  const exactStart = source.toLocaleLowerCase().indexOf(skillLabel.toLocaleLowerCase());
  if (exactStart >= 0) return { start: exactStart, end: exactStart + skillLabel.length };

  // A proven machine id may be authored with spaces: computer-use must tint
  // the whole "Computer Use" name, not just its longest individual token.
  const words = skillLabel.split(/[-_\s]+/).filter(Boolean);
  if (words.length > 1) {
    const namedPhrase = new RegExp(`\\b${words.map(escapePattern).join('[-_\\s]+')}\\b`, 'i').exec(source);
    if (namedPhrase) return { start: namedPhrase.index, end: namedPhrase.index + namedPhrase[0].length };
  }

  const tokens = skillLabel.split(/[^A-Za-z0-9]+/).filter((token) => token.length >= 4);
  const candidates: Array<{ start: number; end: number; score: number }> = [];
  for (const token of tokens) {
    const escaped = escapePattern(token);
    const pattern = new RegExp(`\\b${escaped}\\b(?:\\s+(gateway|process|protocol|review|skill|workflow))?`, 'ig');
    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const noun = match[1]?.toLocaleLowerCase();
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        score: (noun && skillReferenceNouns.has(noun) ? 1000 : 0) + match[0].length,
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.start - left.start);
  return candidates[0] ? { start: candidates[0].start, end: candidates[0].end } : null;
}

// Preambles are authored prose, so the detector deliberately requires an
// invocation verb plus an explicit "skill"/"workflow" noun. That keeps an
// ordinary sentence such as "I'm using the browser" visually ordinary.
const invocationVerb = '(?:use|using|apply|applying|invoke|invoking|follow|following|load|loading|run|running|adopt|adopting)';
const nameToken = '[A-Za-z0-9][A-Za-z0-9._/+:-]*';
const plainName = `${nameToken}(?:\\s+${nameToken}){0,4}`;
const unnamedInvocationWords = new Set([
  'a', 'an', 'current', 'existing', 'it', 'its', 'my', 'our', 'same',
  'that', 'the', 'their', 'these', 'this', 'those', 'your',
]);
const indirectInvocationWords = new Set(['it', 'its', 'same', 'that', 'these', 'this', 'those']);
const unquotedInvocationPattern = new RegExp(`\\b${invocationVerb}\\s+(?:the\\s+)?(${plainName})\\s+(?:skill|workflow)\\b`, 'ig');

const invocationPatterns = [
  new RegExp(`\\b${invocationVerb}\\s+(?:the\\s+)?(?:skill|workflow)\\s*[:=]?\\s*[\u0060"“'‘](${plainName})[\u0060"”'’]`, 'ig'),
  new RegExp(`\\b${invocationVerb}\\s+(?:the\\s+)?[\u0060"“'‘](${plainName})[\u0060"”'’]\\s+(?:skill|workflow)\\b`, 'ig'),
  unquotedInvocationPattern,
] as const;

/**
 * Runtimes disagree about which row carries a turn's announcement: one emits
 * it as its own preamble item, another opens the turn with ordinary assistant
 * text. The authored invocation is the same either way, so the annotation
 * follows the invocation rather than the role the runtime happened to use.
 */
export function transcriptRowSkillInvocation(role: WorkspaceMessage['role'], source: string) {
  return role === 'narration' || role === 'assistant' ? transcriptSkillInvocation(source) : null;
}

export function transcriptSkillInvocation(source: string): TranscriptSkillInvocation | null {
  for (const pattern of invocationPatterns) {
    for (const match of source.matchAll(pattern)) {
      let label = match[1]?.trim();
      if (!label) continue;
      // Qualifiers may precede a name, but "that operating skill" refers back
      // to a skill; removing "that" does not make "operating" its name.
      // Indirect references defer to the same-run tool evidence instead.
      let nameOffset = 0;
      if (pattern === unquotedInvocationPattern) {
        const tokens = [...label.matchAll(/\S+/g)];
        const firstNamedIndex = tokens.findIndex((token) => !unnamedInvocationWords.has(token[0].toLocaleLowerCase()));
        if (firstNamedIndex < 0 || tokens.slice(0, firstNamedIndex).some((token) => indirectInvocationWords.has(token[0].toLocaleLowerCase()))) continue;
        const namedTokens = tokens.slice(firstNamedIndex);
        const identifierTokens = namedTokens.filter((token) => /[._/+:-]/.test(token[0]));
        if (identifierTokens.length > 1) continue;
        if (identifierTokens.length === 1) {
          const identifier = identifierTokens[0]!;
          const identifierIndex = tokens.indexOf(identifier);
          if (tokens.slice(0, identifierIndex).some((token) => indirectInvocationWords.has(token[0].toLocaleLowerCase()))) continue;
          // Generic trailing nouns such as "review", "plugin", and
          // "recovery" are not identity evidence. Only an adjacent tool can
          // prove that a longer authored phrase belongs to the machine name.
          nameOffset = identifier.index!;
          label = identifier[0];
        } else {
          // A multiword plain phrase has no machine-name boundary. Without
          // quotes or tool metadata, trimming either edge would invent an
          // identity, so leave it unbadged.
          if (namedTokens.length !== 1) continue;
          nameOffset = namedTokens[0]!.index!;
          label = namedTokens[0]![0];
        }
      }
      const relativeStart = match[0].indexOf(match[1]!);
      if (relativeStart < 0) continue;
      const start = match.index! + relativeStart + nameOffset;
      return { label, start, end: start + label.length };
    }
  }
  return null;
}

export function resolvedTranscriptSkillInvocation(
  source: string,
  explicit: TranscriptSkillInvocation | null,
  evidence: TranscriptSkillEvidence | null | undefined,
): { invocation: TranscriptSkillEvidence; reference: Pick<TranscriptSkillInvocation, 'start' | 'end'> | null } | null {
  if (evidence) return { invocation: evidence, reference: transcriptSkillReference(source, evidence.label) };
  return explicit ? { invocation: { label: explicit.label }, reference: { start: explicit.start, end: explicit.end } } : null;
}

function escapePattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const skillLoadIntent = /\b(?:use|using|apply|applying|invoke|invoking|follow|following|load|loading|read|reading|inspect|inspecting|run|running|adopt|adopting)\b/i;
// The `skills/` segment is optional because the row this reads is a display
// string: a tool that takes its target under a path key has its summary
// shortened to the last two segments, which drops `skills/` and leaves only
// `<name>/SKILL.md`. The `SKILL.md` filename is the convention that proves
// the load; the preceding narration intent and same-run pairing are what keep
// this from tinting an ordinary file read.
const skillPathPattern = /(?:^|[\s\\/])(?:skills[\\/])?([A-Za-z0-9][A-Za-z0-9._+-]*)[\\/]SKILL\.md\b/i;
const skillNamePropertyPattern = /["'](?:skill_name|skillName|skill)["']\s*:\s*["']([A-Za-z0-9][A-Za-z0-9._/+:-]*)["']/i;
const skillToolNames = new Set(['skill', 'skill_workshop', 'skills.read']);

/**
 * Some agents describe a skill by its domain-facing name (for example,
 * "privacy gateway") rather than spelling out "skill" or "workflow". In
 * that case, the immediately following same-run tool load is authoritative:
 * an exact `skills/<name>/SKILL.md` path proves the invocation without
 * guessing from ordinary prose.
 */
export function transcriptSkillInvocationFromFollowingTool(
  messages: ReadonlyArray<Pick<WorkspaceMessage, 'role' | 'text' | 'tool' | 'runId' | 'toolGroup'>>,
  messageIndex: number,
): TranscriptSkillEvidence | null {
  const narration = messages[messageIndex];
  if (!narration || narration.role !== 'narration' || !skillLoadIntent.test(narration.text)) return null;
  const adjacent = messages[messageIndex + 1];
  // The display pipeline inserts a presentation-only tool-group header before
  // its canonical members. Preserve the same adjacency proof by reading only
  // that group's first member; never scan through ordinary prose or another
  // group for evidence.
  const following = adjacent?.toolGroup ? messages[messageIndex + 2] : adjacent;
  if (!following || following.role !== 'tool') return null;
  if (narration.runId && following.runId && narration.runId !== following.runId) return null;
  const evidence = `${following.tool?.summary ?? ''}\n${following.text}`;
  const pathLabel = skillPathPattern.exec(evidence)?.[1]?.trim();
  const toolName = following.tool?.name.trim().toLocaleLowerCase();
  const toolLabel = toolName && skillToolNames.has(toolName)
    ? skillNamePropertyPattern.exec(evidence)?.[1]?.trim()
    : undefined;
  const label = pathLabel ?? toolLabel;
  return label ? { label: shortSkillName(label) } : null;
}

/**
 * A Skill tool call proves which skill loaded even when no narration line
 * precedes it (Claude often calls Skill directly). Read it from the tool rows
 * the transcript shows: one standalone tool row, or a group's members.
 */
export function transcriptSkillInvocationFromToolRows(
  messages: ReadonlyArray<Pick<WorkspaceMessage, 'role' | 'text' | 'tool'>>,
  first: number,
  last: number,
): TranscriptSkillEvidence | null {
  for (let index = first; index <= last; index += 1) {
    const row = messages[index];
    const toolName = row?.role === 'tool' ? row.tool?.name.trim().toLocaleLowerCase() : undefined;
    if (!toolName || !skillToolNames.has(toolName)) continue;
    const label = skillNamePropertyPattern.exec(`${row!.tool?.summary ?? ''}\n${row!.text}`)?.[1]?.trim();
    if (label) return { label: shortSkillName(label) };
  }
  return null;
}

// Claude Code names plugin skills `<plugin>:<skill>`; the chip shows the skill.
function shortSkillName(label: string) { return label.split(':').pop() || label; }
