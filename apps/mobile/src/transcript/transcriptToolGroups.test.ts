import { settleCommandOperation, beginCommandOperation } from '../gateway/commandOperation';
import { describe, expect, it, vi } from 'vitest';
import * as rowBudget from './transcriptRowBudget';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectTranscriptToolGroups } from './transcriptToolGroups';
import { buildVisibleTranscriptRenderRows, transcriptNavigationSourceRows, transcriptRenderIndexForSourceRow } from './transcriptVisibleRows';
import { createTranscriptBuffer, transcriptLineAt, updatedTranscriptBuffer } from './transcriptBuffer';
import { reconcileTranscriptVimState, createTranscriptVimState } from './transcriptVim';
import { nextTranscriptSearchCursor } from './transcriptMessageSearch';
const tool = (id: string, text = 'exec\nresult'): WorkspaceMessage => ({ id, role: 'tool', text, sessionKey: 's', runId: 'r' });
const prose = (id: string): WorkspaceMessage => ({ id, role: 'narration', text: id });

describe('nested continuous tool groups', () => {
  it('stacks tools until prose and keeps one stable group when more tools arrive', () => {
    const a = tool('a'); const b = tool('b');
    const first = projectTranscriptToolGroups([prose('before'), a]);
    const next = projectTranscriptToolGroups([prose('before'), a, b, prose('after'), tool('c')]);
    expect(next[1]?.id).toBe(first[1]?.id);
    expect(next.filter(m => m.toolGroup).map(m => m.toolGroup?.count)).toEqual([2, 1]);
    const rows = buildVisibleTranscriptRenderRows(next, new Set());
    expect(rows.map(r => r.compiled.source)).toEqual(['before', 'Tool activity · 2 calls', 'after', 'Tool activity · 1 call']);
    const buffer = createTranscriptBuffer(next);
    expect(rows.map(r => transcriptLineAt(buffer, r.sourceRow)?.messageId)).toEqual(rows.map(r => r.message.id));
    expect(updatedTranscriptBuffer(first, createTranscriptBuffer(first), next)).toEqual(buffer);
  });
  it('preserves the reviewed group across prepends, page trimming and recreated canonical objects', () => {
    const initial = projectTranscriptToolGroups([tool('c'), tool('d'), prose('after')]);
    const group = initial[0]!;
    const before = createTranscriptBuffer(initial);
    const review = { ...createTranscriptVimState(before), cursor: { row: 0, column: 0 }, followTail: false };
    const next = projectTranscriptToolGroups([prose('older'), tool('a', 'read\n' + 'detail\n'.repeat(2000)), tool('b'), tool('c'), tool('d'), prose('after')], initial);
    const visible = buildVisibleTranscriptRenderRows(next, new Set());
    const selected = reconcileTranscriptVimState(review, before, createTranscriptBuffer(next), transcriptNavigationSourceRows(visible));
    expect(next[1]!.id).toBe(group.id);
    expect(transcriptLineAt(createTranscriptBuffer(next), selected.cursor.row)?.messageId).toBe(group.id);
    expect(visible[1]!.key).toBe(buildVisibleTranscriptRenderRows(initial, new Set())[0]!.key);
    expect(buildVisibleTranscriptRenderRows(next, new Set([group.id, 'c'])).find(row => row.message.id === 'c')?.fold?.expanded).toBe(true);
    const trimmed = projectTranscriptToolGroups([tool('a'), tool('b')], next);
    expect(trimmed[0]!.id).toBe(group.id);
    expect(trimmed[0]!.toolGroup?.count).toBe(2);
  });
  it('keeps unrelated batches distinct when canonical prose splits a group or replaces a page', () => {
    const previous = projectTranscriptToolGroups([tool('c'), tool('d')]);
    const expanded = projectTranscriptToolGroups([tool('a'), tool('b'), tool('c'), tool('d')], previous);
    const split = projectTranscriptToolGroups([tool('a'), prose('new-preamble'), tool('b'), tool('c'), tool('d')], expanded);
    const groups = split.filter(m => m.toolGroup);
    expect(new Set(groups.map(m => m.id)).size).toBe(2);
    expect(groups.map(m => m.toolGroup?.count)).toEqual([1, 3]);
    expect(projectTranscriptToolGroups([tool('unrelated')], split)[0]!.id).toBe('tool-group:unrelated');
    expect(projectTranscriptToolGroups(split.filter(m => !m.toolGroup), split).filter(m => m.toolGroup).map(m => m.id)).toEqual(groups.map(m => m.id));
  });
  it('opens the outer fold independently of individual details with unique source coordinates', () => {
    const messages = projectTranscriptToolGroups([tool('a'), tool('b', 'read\nneedle'), prose('after')]);
    const group = messages[0]!;
    const collapsed = buildVisibleTranscriptRenderRows(messages, new Set());
    const open = buildVisibleTranscriptRenderRows(messages, new Set([group.id]));
    expect(open.map(r => r.message.id)).toEqual([group.id, 'a', 'b', 'after']);
    expect(open.slice(1, 3).every(r => r.fold && !r.fold.expanded && r.toolGroupDepth === 1)).toBe(true);
    const nested = buildVisibleTranscriptRenderRows(messages, new Set([group.id, 'a']));
    expect(nested.filter(r => r.message.id === 'a')).toHaveLength(2);
    expect(nested.find(r => r.message.id === 'b')?.fold?.expanded).toBe(false);
    expect(new Set(transcriptNavigationSourceRows(nested)).size).toBe(nested.length);
    const buffer = createTranscriptBuffer(messages);
    expect(transcriptRenderIndexForSourceRow(collapsed, buffer.firstRowByMessage[2]!)).toBe(0);
    expect(nextTranscriptSearchCursor(buffer, 'needle', { row: 0, column: 0 }, 1, transcriptNavigationSourceRows(collapsed))).toBeNull();
    expect(open[0]?.key).toBe(collapsed[0]?.key);
  });
  it('ignores invisible metadata boundaries while keeping approvals and media visible', () => {
    const rows = projectTranscriptToolGroups([tool('a'), { ...tool('b'), runId: 'other' },
      { id: 'approval', role: 'approval', text: 'approval needed' }, tool('c'),
      { ...tool('d'), transcriptSessionId: 'different' }, { id: 'end', role: 'assistant', text: 'done' }]);
    expect(rows.filter(m => m.toolGroup).map(m => m.toolGroup?.count)).toEqual([2, 2]);
    expect(buildVisibleTranscriptRenderRows(rows, new Set()).some(r => r.message.id === 'approval')).toBe(true);
  });
  it('labels known activity without printing tool arguments or guessing mixed purposes', () => {
    const named = (id: string, name: string, summary = '') => ({ ...tool(id), tool: { name, summary } });
    const label = (...messages: WorkspaceMessage[]) => projectTranscriptToolGroups(messages)[0]!.text;
    expect(label(named('a', 'openclaw__read'), named('b', 'read'))).toBe('Reading files · 2 calls');
    expect(label(named('a', 'exec', 'exec · pnpm test'), named('b', 'exec', 'exec · pnpm typecheck'))).toBe('Running checks · 2 calls');
    expect(label(named('a', 'exec', 'exec · pnpm build'))).toBe('Building · 1 call');
    expect(label(named('a', 'web_search'), named('b', 'rg'))).toBe('Searching · 2 calls');
    expect(label(named('a', 'read'), named('b', 'apply_patch'))).toBe('Tool activity · 2 calls');
    expect(label(named('a', 'exec', 'exec · echo "pnpm test"'))).toBe('Running commands · 1 call');
    expect(label(named('a', 'exec', 'exec · pnpm test; deploy'))).toBe('Running commands · 1 call');
    expect(label(named('a', 'unknown', 'Reading private/file'))).toBe('Tool activity · 1 call');
  });
  it('keeps the same fold key across metadata hydration, appends and activity-label changes', () => {
    const a = { ...tool('a'), tool: { name: 'read', summary: 'read' } };
    const first = projectTranscriptToolGroups([a])[0]!;
    const next = projectTranscriptToolGroups([a, { ...tool('b'), sessionKey: 'other', transcriptSessionId: 'new', runId: 'new' }]);
    expect(next[0]!.id).toBe(first.id);
    expect(next[0]!.text).toBe('Tool activity · 2 calls');
    expect(projectTranscriptToolGroups([a, next[2]!], next)[0]).toBe(next[0]);
    expect(buildVisibleTranscriptRenderRows(next, new Set([first.id])).map(r => r.message.id)).toEqual([first.id, 'a', 'b']);
  });
  it('never groups across visible conversation, media or approval boundaries', () => {
    for (const boundary of [prose('p'), { id: 'u', role: 'user', text: 'steer' },
      { id: 'f', role: 'assistant', text: 'reply' }, { id: 'cmd', role: 'command', text: 'status' },
      { ...tool('media'), attachments: [{ id: 'img', filename: 'a.png', mimeType: 'image/png' }] },
      { id: 'approval', role: 'approval', text: 'permission' }] as WorkspaceMessage[]) {
      const rows = buildVisibleTranscriptRenderRows(projectTranscriptToolGroups([tool('a'), boundary, tool('b')]), new Set());
      expect(rows.some(row => row.message.id === boundary.id)).toBe(true);
      expect(rows.filter(row => row.message.toolGroup)).toHaveLength(2);
    }
  });
  it('shows failed colon operations as readable responses without losing error state', () => {
    const messages = settleCommandOperation(beginCommandOperation([], 'op', 's', ':status'), 'op', ':status failed\nTry reconnecting.', true);
    const rows = buildVisibleTranscriptRenderRows(messages, new Set());
    expect(rows).toHaveLength(2);
    expect(rows.every(row => !row.fold && row.presentation.conversation && row.message.state === 'error')).toBe(true);
  });
  it('does not compile or expand huge child payloads when the outer group is closed', () => {
    const messages = projectTranscriptToolGroups([tool('huge', 'exec\n' + 'data\n'.repeat(20_000)), tool('small')]);
    const rows = buildVisibleTranscriptRenderRows(messages, new Set(['huge']));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fold?.hiddenLineCount).toBe(20_004);
    expect(rows[0]?.compiled.source).toBe('Tool activity · 2 calls');
  });
  it('does not recount retained closed-group payloads when an optimistic prompt is appended', () => {
    const first = tool('retained-first', `exec\n${'first retained result\n'.repeat(1000)}`);
    const second = tool('retained-second', `read\n${'second retained result\n'.repeat(1000)}`);
    const previous = projectTranscriptToolGroups([first, second]);
    const countLines = vi.spyOn(rowBudget, 'transcriptSourceLineCount');
    try {
      const initialRows = buildVisibleTranscriptRenderRows(previous, new Set());
      expect(initialRows[0]?.fold?.hiddenLineCount).toBe(2004);
      countLines.mockClear();
      const prompt: WorkspaceMessage = { id: 'local-prompt', role: 'user', source: 'local', text: 'Continue' };
      const appended = projectTranscriptToolGroups([first, second, prompt], previous);
      const nextRows = buildVisibleTranscriptRenderRows(appended, new Set());
      expect(nextRows.map(row => row.message.id)).toEqual([previous[0]!.id, prompt.id]);
      expect(nextRows[0]?.fold?.hiddenLineCount).toBe(2004);
      expect(nextRows[1]?.sourceRow).toBe(2005);
      expect(countLines.mock.calls.filter(([text]) => text === first.text || text === second.text)).toHaveLength(0);

      // A changed child must invalidate its own count without rereading its sibling.
      countLines.mockClear();
      const grown = { ...second, text: `${second.text}\none more line` };
      const revised = buildVisibleTranscriptRenderRows(projectTranscriptToolGroups([first, grown, prompt], appended), new Set());
      expect(revised[0]?.fold?.hiddenLineCount).toBe(2005);
      expect(revised[1]?.sourceRow).toBe(2006);
      expect(countLines.mock.calls.filter(([text]) => text === first.text)).toHaveLength(0);
      expect(countLines.mock.calls.filter(([text]) => text === grown.text)).toHaveLength(1);
    } finally { countLines.mockRestore(); }
  });
  it('keeps command output expanded and formatted, without unfolding machine diagnostics', () => {
    const rows = buildVisibleTranscriptRenderRows([
      { id: 'command', role: 'command', text: '**Status**\nReady\n\n- Connected' },
      { id: 'system', role: 'system', text: 'raw\nmetadata' },
    ], new Set());
    const command = rows.filter(r => r.message.id === 'command');
    expect(command).toHaveLength(3);
    expect(command.every(r => r.presentation.conversation && !r.fold)).toBe(true);
    expect(rows.find(r => r.message.id === 'system')?.fold?.expanded).toBe(false);
  });
});
