import { describe, expect, it } from 'vitest';
import { messagesFromPayload, authoritativeHistoryChronology } from './historyMessageProjection';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { transcriptMessageIsFoldedByDefault } from '../transcript/transcriptRowBudget';
import { buildVisibleTranscriptRenderRows } from '../transcript/transcriptVisibleRows';
import { projectTranscriptToolGroups } from '../transcript/transcriptToolGroups';

const sessionId = '00000000-0000-4000-8000-000000000001';
const notice = 'Exec failed (sample-id, code 0) :: worker started\n\nThe command was terminated, but external side effects may already have completed.';
const drift = 'OpenClaw resumed this CLI session after prompt content changed. Follow the current turn\'s instructions; changed=system-prompt,prompt-tools.\n\n';
const event = { id: 'event', role: 'user', content: notice, timestamp: 1000,
  provenance: { kind: 'internal_system', sourceTool: 'exec' } };
const mirror = { role: 'user', content: drift + notice, timestamp: 2000,
  __openclaw: { id: 'mirror', importedFrom: 'claude-cli', cliSessionId: sessionId, externalId: 'mirror' } };
const project = (messages: unknown[], id = sessionId) => messagesFromPayload({ sessionKey: 'route', sessionId: id, messages });

describe('background execution notices', () => {
  it('labels notice groups as updates, not newly running commands or calls', () => {
    const rows = project([event, mirror]);
    expect(projectTranscriptToolGroups(rows.slice(0, 1))[0]?.text).toBe('Background command status · 1 update');
    expect(projectTranscriptToolGroups(rows)[0]?.text).toBe('Background command status · 2 updates');
    const command = { id: 'command', role: 'tool' as const, text: 'exec\nchecking', state: 'streaming' as const,
      tool: { name: 'exec', summary: 'exec · echo checking' } };
    expect(projectTranscriptToolGroups([...rows, command])[0]?.text).toBe('Tool activity · 3 items · 1 running');
    expect(projectTranscriptToolGroups([command])[0]?.text).toBe('Running commands · 1 call · 1 running');
  });

  it('keeps internal execution details in folded tool activity, not ordinary chat', () => {
    const [row] = project([event]);
    expect(row?.role).toBe('tool');
    expect(row?.tool?.summary).toBe('Background command status');
    expect(row?.text).toContain(notice);
    expect(transcriptMessageIsFoldedByDefault(row!)).toBe(true);
    expect(row?.state).toBeUndefined(); // an execution event is not a failed conversation
    const visible = buildVisibleTranscriptRenderRows([row!], new Set());
    expect(visible).toHaveLength(1);
    expect(JSON.stringify(visible[0]?.compiled)).not.toContain('Exec failed');
    expect(JSON.stringify(visible[0]?.compiled)).toContain('Background command status');
    expect(JSON.stringify(buildVisibleTranscriptRenderRows([row!], new Set([row!.id])))).toContain('Exec failed');
  });

  it('folds the witnessed native mirror, retaining its details and identity', () => {
    expect(project([event, mirror]).map(row => [row.id, row.role])).toEqual([['event', 'tool'], ['mirror', 'tool']]);
  });

  it('converges separate pages and cached execution evidence', () => {
    const cached = parsedTranscriptCache(serializedTranscriptCache(project([event])));
    expect(authoritativeHistoryChronology([...cached, ...project([mirror])]).map(row => row.role)).toEqual(['tool', 'tool']);
  });

  it('keeps user-authored quotations and assistant explanations', () => {
    const rows = project([event, { id: 'quote', role: 'user', content: notice },
      { id: 'answer', role: 'assistant', content: 'The command failed. Here is the recovery.' }]);
    expect(rows.find(row => row.id === 'quote')?.role).toBe('user');
    expect(rows.find(row => row.id === 'answer')?.role).toBe('assistant');
  });

  it('does not infer an internal event from text, a different source, or an unwitnessed native import', () => {
    expect(project([{ ...event, provenance: undefined }])[0]?.role).toBe('user');
    expect(project([{ ...event, provenance: { kind: 'internal_system', sourceTool: 'other' } }])[0]?.role).toBe('system');
    expect(project([mirror])[0]?.role).toBe('user');
  });

  it('does not absorb a native mirror from another concrete session or a positioned authored input', () => {
    const other = project([mirror], '00000000-0000-4000-8000-000000000002');
    expect(authoritativeHistoryChronology([...project([event]), ...other]).map(row => row.role)).toEqual(['tool', 'user']);
    expect(project([event, { ...mirror, __openclaw: { ...mirror.__openclaw,
      transcriptPosition: { source: 'source', rawSeq: 2 } } }]).map(row => row.role)).toEqual(['tool', 'user']);
  });

  it('preserves an authored native copy without runtime-injected framing', () => {
    expect(project([event, { ...mirror, content: notice }]).map(row => row.role)).toEqual(['tool', 'user']);
  });

  it('retains all copies and is independent of page partition and repeated merges', () => {
    const rows = project([event, mirror, { ...mirror, __openclaw: { ...mirror.__openclaw, id: 'second', externalId: 'second' } }]);
    expect(rows.map(row => row.id)).toEqual(['event', 'mirror', 'second']);
    expect(rows.map(row => row.role)).toEqual(['tool', 'tool', 'tool']);
    const split = authoritativeHistoryChronology([...project([event, mirror]), ...project([{ ...mirror, __openclaw: { ...mirror.__openclaw, id: 'second', externalId: 'second' } }])]);
    expect(split).toEqual(rows);
    expect(authoritativeHistoryChronology(rows)).toEqual(rows);
    expect(authoritativeHistoryChronology(authoritativeHistoryChronology(rows))).toEqual(rows);
  });

  it('converges supported ISO timestamps and does not promote diagnostic paths to media', () => {
    expect(project([{ ...event, timestamp: '2026-10-27T00:00:00Z' },
      { ...mirror, timestamp: '2026-10-27T00:00:01Z' }]).map(row => row.role)).toEqual(['tool', 'tool']);
    const [row] = project([{ ...event, content: 'Exec failed (sample-id, code 1) :: ![output](/tmp/check.png)' }]);
    expect(row?.attachments).toBeUndefined();
    const mediaNotice = 'Exec failed (sample-id, code 1) :: ![output](/tmp/check.png)';
    const pair = project([{ ...event, content: mediaNotice }, { ...mirror, content: drift + mediaNotice }]);
    expect(pair.map(row => row.attachments)).toEqual([undefined, undefined]);
    expect(pair.map(row => row.role)).toEqual(['tool', 'tool']);
  });
});
