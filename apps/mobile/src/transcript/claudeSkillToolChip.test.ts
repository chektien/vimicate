import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectTranscriptToolGroups } from './transcriptToolGroups';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';

// Physical notes turn: Claude called Skill with no preceding text, so no row
// carried the chip. A dotfiles turn announced "so I'll load it." first.
const native = (id: string) => ({ id, importedFrom: 'claude-cli', cliSessionId: 'cli', externalId: id });
const skillCall = (id: string, at: number, skill = 'paper-writing') => ({ role: 'assistant', stopReason: 'tool_use', timestamp: at, __openclaw: native(id),
  content: [{ type: 'toolcall', id: `${id}-call`, name: 'Skill', arguments: { skill: `openclaw-skills:${skill}` } },
    { type: 'tool_result', tool_use_id: `${id}-call`, name: 'Skill', content: `Launching skill: openclaw-skills:${skill}` }] });
const bash = (id: string, at: number) => ({ role: 'assistant', stopReason: 'tool_use', timestamp: at, __openclaw: native(id),
  content: [{ type: 'toolcall', id: `${id}-call`, name: 'Bash', arguments: { command: 'ls' } },
    { type: 'tool_result', tool_use_id: `${id}-call`, name: 'Bash', content: 'ok' }] });
const text = (id: string, body: string, at: number, stopReason = 'tool_use') => ({ role: 'assistant', stopReason, timestamp: at,
  __openclaw: native(id), content: [{ type: 'text', text: body }] });

function chips(raw: Record<string, unknown>[]) {
  const rows = projectTranscriptToolGroups(messagesFromPayload({ sessionKey: 'k', sessionId: '33333333-3333-4333-8333-333333333333', messages: raw }));
  return buildVisibleTranscriptRenderRows(rows, new Set()).filter(row => row.readSkills)
    .map(row => `${row.message.role}:${row.readSkills!.join(',')}`);
}

describe('Claude Skill tool chip', () => {
  it('shows the skill on the tool activity group when no narration precedes the Skill call', () => {
    expect(chips([
      { role: 'user', content: 'Tighten the abstract.', timestamp: 1 },
      skillCall('skill', 2), bash('read', 3), text('answer', 'Done.', 4, 'end_turn'),
    ])).toEqual(['tool:openclaw-skills:paper-writing']);
  });

  it('keeps the announcement plain and identifies skill reads on the group', () => {
    expect(chips([
      { role: 'user', content: 'Tighten the abstract.', timestamp: 1 },
      text('say', "The writing skill has the procedure, so I'll load it.", 2),
      skillCall('skill', 3), bash('read', 4), text('answer', 'Done.', 5, 'end_turn'),
    ])).toEqual(['tool:openclaw-skills:paper-writing']);
  });

  it('does not chip a tool group without a Skill call', () => {
    expect(chips([{ role: 'user', content: 'List files.', timestamp: 1 }, bash('a', 2), bash('b', 3)])).toEqual([]);
  });

  it('summarizes distinct skills on the header and names each expanded read', () => {
    const raw = [skillCall('first', 1), bash('between', 2), skillCall('second', 3, 'literature-review')];
    const messages = projectTranscriptToolGroups(messagesFromPayload({ sessionKey: 'k', sessionId: '33333333-3333-4333-8333-333333333333', messages: raw }));
    const header = messages.find(message => message.toolGroup)!;
    const collapsed = buildVisibleTranscriptRenderRows(messages, new Set());
    expect(collapsed.filter(row => row.readSkills).map(row => row.readSkills!.join(','))).toEqual(['openclaw-skills:paper-writing,openclaw-skills:literature-review']);
    const expanded = buildVisibleTranscriptRenderRows(messages, new Set([header.id]));
    expect(expanded.filter(row => row.readSkills).map(row => [row.message.id, row.readSkills!.join(',')])).toEqual([
      [header.id, 'openclaw-skills:paper-writing,openclaw-skills:literature-review'],
      ['first#tool-1', 'openclaw-skills:paper-writing'],
      ['second#tool-1', 'openclaw-skills:literature-review'],
    ]);
  });
});
