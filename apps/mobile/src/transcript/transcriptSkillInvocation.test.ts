import { describe, expect, it } from 'vitest';
import { skillNameFromArguments } from '../tooling/skillReadEvidence';
import { transcriptReadSkills } from './transcriptSkillInvocation';
import { toolActivityFromContent, toolActivityPairedWithCall, toolSkillEvidence } from '../tooling/toolActivity';

describe('skill read evidence', () => {
  it.each([
    ['skills_read', { name: 'example-document-review' }, 'example-document-review'],
    ['openclaw__skills_read', { name: 'example-document-review' }, 'example-document-review'],
    ['skills.read', { name: 'browser-automation' }, 'browser-automation'],
    ['Skill', { skill: 'plugin:skill-name' }, 'plugin:skill-name'],
    ['skill_workshop', { action: 'read', skill_name: 'public-design' }, 'public-design'],
    ['Read', { file_path: '/agent/skills/ios-dev/SKILL.md' }, 'ios-dev'],
    ['exec_command', { cmd: 'cat /agent/skills/ios-dev/SKILL.md' }, 'ios-dev'],
    ['bash', { command: 'sed -n \'1,240p\' "/agent/skills/ios-dev/SKILL.md"' }, 'ios-dev'],
    ['read', '{"path":"/agent/skills/ios-dev/SKILL.md"}', 'ios-dev'],
  ])('reads exact identity from %s invocation arguments', (tool, args, expected) => {
    expect(skillNameFromArguments(tool, args)).toBe(expected);
  });
  it.each([
    ['skills_read', { name: 'unsafe\nname' }],
    ['Skill', '{broken'],
    ['skill_workshop', { action: 'update', skill_name: 'public-design' }],
    ['skill_workshop', { skill_name: 'public-design' }],
    ['web_search', { name: 'public-design' }],
    ['mcp__mail__read', { path: '/agent/skills/ios-dev/SKILL.md' }],
    ['exec_command', { cmd: 'echo /agent/skills/ios-dev/SKILL.md' }],
    ['bash', { command: 'cat /agent/skills/ios-dev/SKILL.md && false' }],
    ['bash', { command: 'cat /agent/skills/ios-dev/SKILL.md > /tmp/copy' }],
    ['read', { path: '/ordinary/public-design/SKILL.md' }],
  ])('does not infer skill reads from ambiguous or non-read %s arguments', (tool, args) => {
    expect(skillNameFromArguments(tool, args)).toBeUndefined();
  });
  it('does not extract identity from a result quoting another skill', () => {
    const call = toolActivityFromContent([{ type: 'toolCall', name: 'skills_read', id: 'a', arguments: { name: 'right' } }])!;
    const result = toolActivityFromContent([{ type: 'toolResult', name: 'skills_read', toolCallId: 'a', content: '{"name":"wrong"} /skills/wrong/SKILL.md' }])!;
    expect(toolSkillEvidence(result)).not.toHaveProperty('skillName');
    expect(toolSkillEvidence(toolActivityPairedWithCall(result, new Map([['a', call]])))).toEqual({ skillName: 'right', resultSucceeded: true });
  });
  it('shows only completed successful reads, deduped in source order, never narration', () => {
    const tool = (id: string, skillName: string) => ({ id, role: 'tool' as const, text: 'raw', tool: { name: 'Skill', summary: 'Skill', skillName, resultSucceeded: true as const } });
    const messages = [tool('one', 'plugin:first'), { ...tool('running', 'pending'), state: 'streaming' as const },
      { ...tool('failed', 'broken'), state: 'error' as const }, tool('repeat', 'plugin:first'), tool('two', 'second'),
      { ...tool('prose', 'claimed'), role: 'narration' as const },
      { ...tool('request', 'unconfirmed'), tool: { name: 'Skill', summary: 'Skill', skillName: 'unconfirmed' } }];
    expect(transcriptReadSkills(messages, 0, messages.length - 1)).toEqual(['plugin:first', 'second']);
  });
});
