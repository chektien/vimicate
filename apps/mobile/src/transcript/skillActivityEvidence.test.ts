import { expect, it } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectTranscriptToolGroups } from './transcriptToolGroups';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';
import { projectGatewayEvent, upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { transcriptReadSkills } from './transcriptSkillInvocation';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
it('keeps the sample commentary plain and identifies the completed read on tool activity', () => {
  const messages = messagesFromPayload({ messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'I’m reading the sample document and its review notes.' }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'skills_read', arguments: { name: 'example-document-review' } }] },
    { role: 'tool', content: [{ type: 'toolResult', toolCallId: 'read', content: 'Skill instructions' }] },
  ] });
  const result = messages.find(row => row.tool?.name === 'skills_read' && row.text.includes('Skill instructions'))!;
  expect(result.tool).toMatchObject({ skillName: 'example-document-review', resultSucceeded: true });
  const rows = buildVisibleTranscriptRenderRows(projectTranscriptToolGroups(messages), new Set());
  expect(rows[0]?.compiled.source).toBe(messages[0]?.text);
  expect(rows[0]).not.toHaveProperty('inferredSkillInvocation');
});


it('retains live call identity through completion and cache without treating settlement or failure as a skill read', () => {
  const frame = (phase: string, extra: Record<string, unknown> = {}) => projectGatewayEvent({ event: 'agent', payload: {
    sessionKey: 'one', runId: 'run', stream: 'tool', data: { name: 'skills_read', toolCallId: 'skill', phase, ...extra },
  } }, 'one')!.message;
  let rows: WorkspaceMessage[] = upsertLiveMessage([], frame('start', { args: { name: 'example-document-review' } }));
  expect(transcriptReadSkills(rows, 0, 0)).toEqual([]);
  expect(transcriptReadSkills(rows.map(row => ({ ...row, state: 'complete' })), 0, 0)).toEqual([]);
  const failed = upsertLiveMessage(rows, frame('result', { isError: true, result: 'failed' }));
  expect(transcriptReadSkills(failed, 0, 0)).toEqual([]);
  rows = upsertLiveMessage(rows, frame('result', { result: 'Instructions mentioning /skills/wrong/SKILL.md' }));
  expect(transcriptReadSkills(rows, 0, 0)).toEqual(['example-document-review']);
  expect(transcriptReadSkills(parsedTranscriptCache(serializedTranscriptCache(rows)), 0, 0)).toEqual(['example-document-review']);
});

it.each([
  ['cancelled', {}], ['aborted', {}], ['end', {}],
  ['result', { result: { isError: true } }],
  ['result', { result: { structuredContent: { isError: true } } }],
])('never confirms %s after ordinary run settlement', (phase, extra) => {
  const frame = (phase: string, extra: Record<string, unknown>) => projectGatewayEvent({ event: 'agent', payload: {
    sessionKey: 'one', runId: 'run', stream: 'tool', data: { name: 'skills_read', toolCallId: 'skill', phase, ...extra },
  } }, 'one')!.message;
  const start = frame('start', { args: { name: 'skill-name' } });
  const rows = upsertLiveMessage([start], frame(phase, extra));
  expect(transcriptReadSkills(rows.map(row => ({ ...row, state: 'complete' })), 0, 0)).toEqual([]);
});

it.each(['exec_command', 'openclaw__exec', 'openclaw__bash', 'openclaw__exec_command'])('requires a successful shell exit for %s, not merely a tool result', (toolName) => {
  for (const output of [{ exit_code: 1 }, { exit_code: 0 }, 'cat: no such file']) {
    const rows = messagesFromPayload({ messages: [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'cat', name: toolName, arguments: { cmd: 'cat /agent/skills/right/SKILL.md' } }] },
      { role: 'tool', content: [{ type: 'toolResult', toolCallId: 'cat', content: output }] },
    ] });
    expect(transcriptReadSkills(rows, 0, rows.length - 1)).toEqual(typeof output === 'object' && output.exit_code === 0 ? ['right'] : []);
  }
});

it('honors history envelope failure even when its instruction payload looks successful', () => {
  const rows = messagesFromPayload({ messages: [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'skills_read', arguments: { name: 'wrong' } }] },
    { role: 'tool', isError: true, content: [{ type: 'toolResult', toolCallId: 'read', content: 'partial instructions' }] },
  ] });
  expect(transcriptReadSkills(rows, 0, rows.length - 1)).toEqual([]);
});

it('does not drop a confirmed live read on a late update or result-before-start ordering', () => {
  const frame = (phase: string, extra: Record<string, unknown> = {}) => projectGatewayEvent({ event: 'agent', payload: {
    sessionKey: 'one', runId: 'run', stream: 'tool', data: { name: 'skills_read', toolCallId: 'skill', phase, ...extra },
  } }, 'one')!.message;
  const start = frame('start', { args: { name: 'right' } });
  const result = frame('result', { result: 'instructions' });
  for (const events of [[start, result, frame('update')], [result, start]]) {
    const rows = events.reduce(upsertLiveMessage, [] as WorkspaceMessage[]);
    expect(transcriptReadSkills(rows, 0, 0)).toEqual(['right']);
    expect(rows[0]?.state).toBe('complete');
  }
});
