import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { resolvedTranscriptSkillInvocation, transcriptRowSkillInvocation, transcriptSkillInvocation, transcriptSkillInvocationFromFollowingTool, transcriptSkillReference } from './transcriptSkillInvocation';

describe('transcript skill invocation presentation', () => {
  it.each([
    ["I'm using the presentation-editing workflow because this is a slide-notes change.", 'presentation-editing'],
    ["Because this is a student-ranking request, I'm applying the high-stakes review workflow first.", 'high-stakes'],
    ['I am invoking the `frontend-design` skill for this interface treatment.', 'frontend-design'],
    ['I will use skill: "thesis-supervision" before reviewing the draft.', 'thesis-supervision'],
    ["I’ll update the installed Computer Use plugin using the existing OpenClaw/Codex plugin workflow, then re-run the same native-pipe health check and read-only ExampleMail test if Computer Use starts successfully.", 'OpenClaw/Codex'],
    ["I'm using our current frontend-design skill for this panel.", 'frontend-design'],
    ["I'm applying the existing high-stakes review workflow.", 'high-stakes'],
    ['I am using the "existing files" workflow.', 'existing files'],
    ['I will use skill: "current review" before proceeding.', 'current review'],
    ['I am using the existing-file-review skill.', 'existing-file-review'],
    ['I am using the "existing" workflow.', 'existing'],
    ['I am using the "that operating" skill.', 'that operating'],
    ['I am using the that-operating skill.', 'that-operating'],
    ['I am loading that operating skill, then using the frontend-design workflow.', 'frontend-design'],
  ])('finds the invoked semantic name without changing its source text', (source, label) => {
    const invocation = transcriptSkillInvocation(source);
    expect(invocation?.label).toBe(label);
    expect(source.slice(invocation?.start, invocation?.end)).toBe(label);
  });

  it.each([
    ["I'll use the updated SIT-authentication workflow before testing the login.", 'SIT-authentication'],
    ["I'm using the browser-automation recovery workflow to identify that visible page.", 'browser-automation'],
    ["I'm applying the current github:github workflow before reviewing the pull request.", 'github:github'],
    ["I'm using the refreshed computer-use:computer-use skill now.", 'computer-use:computer-use'],
    ["I'm using the frontend-design updated workflow for this panel.", 'frontend-design'],
    ["I'm using the browser-automation review workflow now.", 'browser-automation'],
    ["I'm using the browser-automation plugin workflow now.", 'browser-automation'],
  ])('keeps only the identifier-shaped skill name in unquoted descriptive prose', (source, label) => {
    const invocation = transcriptSkillInvocation(source);
    expect(invocation?.label).toBe(label);
    expect(source.slice(invocation?.start, invocation?.end)).toBe(label);
  });

  it.each([
    'I am using the release recovery workflow before continuing.',
    'I am applying the updated review process workflow now.',
    'I am using the alpha-beta gamma-delta workflow now.',
  ])('does not invent an identity by trimming ambiguous unquoted prose: %s', (source) => {
    expect(transcriptSkillInvocation(source)).toBeNull();
  });

  it('preserves an explicitly quoted multiword skill name', () => {
    expect(transcriptSkillInvocation('I am using the "release recovery" workflow now.')).toMatchObject({ label: 'release recovery' });
  });

  it.each([
    "I'm using the browser to inspect the page.",
    'The workflow is described in the project notes.',
    'These skills are useful for later work.',
    'I will apply the patch now.',
    'To verify “updated responses,” I need to inspect the live ExampleMail/ExampleTracker state, which your request authorizes. The project-specific rules require direct Computer Use for ExampleMail, so I’m loading that operating skill before opening either system.',
    'I am using this operating skill before opening the browser.',
    'I am following the same detailed workflow.',
    'I am loading its standard workflow.',
  ])('does not decorate ordinary progress prose: %s', (source) => {
    expect(transcriptSkillInvocation(source)).toBeNull();
  });

  it('uses only the compact skill chip instead of tinting the whole narration row', () => {
    const source = readFileSync(new URL('./TranscriptSourceRow.tsx', import.meta.url), 'utf8');
    expect(source).toContain('styles.skillTag');
    expect(source).toContain('{skillInvocation.label}');
    expect(source).not.toContain('>SKILL</Text>');
    expect(source).not.toContain('styles.skillInvocation');
    expect(source).not.toContain('skillInvocationRail');
  });

  it('uses the following same-run SKILL.md load as authoritative evidence for domain-facing preambles', () => {
    const messages = [
      { role: 'narration' as const, runId: 'run-1', text: "The repository classifies assessment records as protected student data, so I'm loading its privacy gateway before inspecting any result file." },
      { role: 'tool' as const, runId: 'run-1', text: 'show ~/.example-agent/skills/student-record-privacy/SKILL.md', tool: { name: 'bash', summary: 'show ~/.example-agent/skills/student-record-privacy/SKILL.md' } },
    ];
    expect(transcriptSkillInvocationFromFollowingTool(messages, 0)).toEqual({ label: 'student-record-privacy' });
    const reference = transcriptSkillReference(messages[0]!.text, 'student-record-privacy');
    expect(messages[0]!.text.slice(reference?.start, reference?.end)).toBe('privacy gateway');
  });

  it('proves a skill from a read whose path summary was shortened for display', () => {
    // `read` puts its target under a path key, and the summary shortener keeps
    // only the last two segments — so the `skills/` segment that the proof
    // required is gone by the time the row exists. A `bash` load keeps the
    // whole command and hid this; a real claude-cli turn loads with `read`.
    const messages = [
      { role: 'narration' as const, runId: 'run-9', text: "Before I touch the manuscript I'm loading the high stakes review workflow." },
      {
        role: 'tool' as const,
        runId: 'run-9',
        text: 'read · high-stakes-review/SKILL.md\n---\nname: high-stakes-review',
        tool: { name: 'read', summary: 'read · high-stakes-review/SKILL.md' },
      },
    ];
    expect(transcriptSkillInvocationFromFollowingTool(messages, 0)).toEqual({ label: 'high-stakes-review' });
  });

  it('proves the exact skill identity from an adjacent skill-workshop read', () => {
    const messages = [
      {
        role: 'narration' as const,
        runId: 'run-reported',
        text: "I'll use the updated SIT-authentication workflow before testing the login.",
      },
      {
        role: 'tool' as const,
        runId: 'run-reported',
        text: 'skill_workshop · read\n{\n  "action": "read",\n  "skill_name": "sit-authentication"\n}',
        tool: { name: 'skill_workshop', summary: 'skill_workshop · read' },
      },
    ];

    const evidence = transcriptSkillInvocationFromFollowingTool(messages, 0);
    expect(evidence).toEqual({ label: 'sit-authentication' });
    expect(resolvedTranscriptSkillInvocation(messages[0]!.text, transcriptSkillInvocation(messages[0]!.text), evidence)).toEqual({
      invocation: { label: 'sit-authentication' },
      reference: { start: 21, end: 39 },
    });
  });

  it('lets exact adjacent tool evidence outrank a broader prose parse', () => {
    const source = "I'm using the browser-automation recovery workflow to identify that visible page.";
    expect(transcriptSkillInvocation(source)).toMatchObject({ label: 'browser-automation' });
    expect(resolvedTranscriptSkillInvocation(source, transcriptSkillInvocation(source), { label: 'browser-automation' })).toEqual({
      invocation: { label: 'browser-automation' },
      reference: { start: 14, end: 32 },
    });

    const row = readFileSync(new URL('./TranscriptSourceRow.tsx', import.meta.url), 'utf8');
    expect(row).toContain('resolvedTranscriptSkillInvocation(row.compiled.source, explicitSkillInvocation, row.firstInMessage ? inferredSkillInvocation : null)');
    expect(row).not.toContain('explicitSkillInvocation ?? (row.firstInMessage ? inferredSkillInvocation : null)');
  });

  it('restores a longer machine name only when adjacent evidence proves it', () => {
    const source = "I'm applying the high-stakes review workflow first.";
    const explicit = transcriptSkillInvocation(source);
    expect(explicit).toMatchObject({ label: 'high-stakes' });
    expect(resolvedTranscriptSkillInvocation(source, explicit, { label: 'high-stakes-review' })).toEqual({
      invocation: { label: 'high-stakes-review' },
      reference: { start: 17, end: 35 },
    });
  });

  it('does not tint a demonstrative when the authored skill phrase appears earlier in the same preamble', () => {
    const messages = [
      {
        role: 'narration' as const,
        runId: 'run-privacy',
        text: "The repo’s privacy gateway applies because the results may contain student records. I’m loading that workflow before inspecting any result contents; I’ll analyze only a checked, pseudonymized derivative if raw student-level data is involved.",
      },
      {
        role: 'tool' as const,
        runId: 'run-privacy',
        text: 'show ~/.example-agent/skills/student-record-privacy/SKILL.md',
        tool: { name: 'bash', summary: 'show ~/.example-agent/skills/student-record-privacy/SKILL.md' },
      },
    ];

    expect(transcriptSkillInvocation(messages[0]!.text)).toBeNull();
    const evidence = transcriptSkillInvocationFromFollowingTool(messages, 0);
    expect(evidence).toEqual({ label: 'student-record-privacy' });
    const reference = transcriptSkillReference(messages[0]!.text, evidence!.label);
    expect(messages[0]!.text.slice(reference?.start, reference?.end)).toBe('privacy gateway');
  });

  it('resolves the reported indirect operating-skill reference only from its same-run tool load', () => {
    const source = 'To verify “updated responses,” I need to inspect the live ExampleMail/ExampleTracker state, which your request authorizes. The project-specific rules require direct Computer Use for ExampleMail, so I’m loading that operating skill before opening either system.';
    const messages = [
      { role: 'narration' as const, runId: 'fixture-run', text: source },
      { role: 'tool' as const, runId: 'fixture-run', text: 'print lines 1–320 from /agent/plugins/cache/openclaw-computer-use/1.0.1000919/skills/computer-use/SKILL.md' },
    ];
    expect(transcriptSkillInvocation(source)).toBeNull();
    const evidence = transcriptSkillInvocationFromFollowingTool(messages, 0);
    expect(evidence).toEqual({ label: 'computer-use' });
    const reference = transcriptSkillReference(source, evidence!.label);
    expect(source.slice(reference?.start, reference?.end)).toBe('Computer Use');
  });

  it('matches the full authored separator variant rather than one token of a proven name', () => {
    const source = 'Direct Computer Use is required; I am loading that operating skill.';
    const reference = transcriptSkillReference(source, 'computer-use');
    expect(source.slice(reference?.start, reference?.end)).toBe('Computer Use');
  });

  it('tints an explicit authored skill name without adding a full-row wash', () => {
    const source = "I'm using the frontend-design skill for the transcript treatment.";
    const reference = transcriptSkillReference(source, 'frontend-design');
    expect(source.slice(reference?.start, reference?.end)).toBe('frontend-design');
    const renderer = readFileSync(new URL('./TranscriptMarkdownLine.tsx', import.meta.url), 'utf8');
    expect(renderer).toContain('skillReference: { color: colors.orange');
    expect(renderer).not.toContain("skillReference: { color: colors.inkBright, backgroundColor");
  });

  it('annotates an authored invocation whether the runtime opened the turn as narration or assistant text', () => {
    // codex emits its announcement as its own preamble item, so the row is
    // `narration`. A CLI runtime opens the turn with ordinary assistant text
    // carrying the same authored invocation. The chip follows the invocation,
    // not the row role the runtime happened to use.
    const announcement = 'I\u2019ll regenerate the coding CSV from the corrected participant cohort and audit its membership'
      + ' before handing it over. I\u2019m using the high-stakes review workflow because this dataset correction affects'
      + ' research coding and must be independently checked.';

    expect(transcriptRowSkillInvocation('assistant', announcement)).toMatchObject({ label: 'high-stakes' });
    expect(transcriptRowSkillInvocation('narration', announcement)).toMatchObject({ label: 'high-stakes' });
    expect(transcriptRowSkillInvocation('user', announcement)).toBeNull();
    expect(transcriptRowSkillInvocation('tool', announcement)).toBeNull();
    expect(resolvedTranscriptSkillInvocation(announcement, transcriptRowSkillInvocation('user', announcement), null)).toBeNull();

    const row = readFileSync(new URL('./TranscriptSourceRow.tsx', import.meta.url), 'utf8');
    expect(row).toContain('transcriptRowSkillInvocation(message.role, row.compiled.source)');
    expect(row).not.toContain("message.role === 'narration' ? transcriptSkillInvocation(");
  });

  it('does not borrow skill evidence from another run or a non-adjacent tool', () => {
    const otherRun = [
      { role: 'narration' as const, runId: 'run-1', text: "I'm loading its privacy gateway now." },
      { role: 'tool' as const, runId: 'run-2', text: 'show ~/.example-agent/skills/student-record-privacy/SKILL.md' },
    ];
    const interrupted = [
      { role: 'narration' as const, runId: 'run-1', text: "I'm loading its privacy gateway now." },
      { role: 'narration' as const, runId: 'run-1', text: 'First I will inspect the repository.' },
      { role: 'tool' as const, runId: 'run-1', text: 'show ~/.example-agent/skills/student-record-privacy/SKILL.md' },
    ];
    expect(transcriptSkillInvocationFromFollowingTool(otherRun, 0)).toBeNull();
    expect(transcriptSkillInvocationFromFollowingTool(interrupted, 0)).toBeNull();
  });
});
