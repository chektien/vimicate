import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from './historyMessageProjection';
import { transcriptMessageMarker } from '../transcript/transcriptPresentation';
import { transcriptMessageIsFoldedByDefault } from '../transcript/transcriptRowBudget';
import { buildVisibleTranscriptRenderRows } from '../transcript/transcriptVisibleRows';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { retainedHistoryRecords } from '../gateway/retainedHistoryRecords';

const summary = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent:\n   - Rename keys.';

describe('harness-generated input in the user slot', () => {
  it('renders Claude Code context summaries as a folded system notice with a summary glyph', () => {
    const [row] = messagesFromPayload({ sessionKey: 'k', messages: [{ role: 'user', content: summary, timestamp: 1,
      provenance: { kind: 'internal_system', sourceTool: 'cli_harness_context' },
      __openclaw: { id: 'sum', importedFrom: 'claude-cli', cliSessionId: 'cli', externalId: 'sum' } }] });
    expect(row?.role).toBe('system');
    expect(row?.text).toBe(summary);
    expect(transcriptMessageMarker(row!)).toBe('§');
    expect(transcriptMessageIsFoldedByDefault(row!)).toBe(true);
  });

  it('keeps an authored prompt that quotes the same words as the user', () => {
    const [row] = messagesFromPayload({ sessionKey: 'k', messages: [{ role: 'user', content: summary, timestamp: 1 }] });
    expect(row?.role).toBe('user');
  });
});

const cronBody = 'Continue the synthetic maintenance task.\nCheck the isolated candidate before publishing.\nThis is an unattended scheduled run. Nobody is present to clarify or approve.\nA diagnostic example mentions ![preview](/tmp/internal-preview.png).';
const cron = {
  role: 'assistant', content: cronBody, timestamp: 1793683044310,
  provenance: { kind: 'internal_system', sourceTool: 'cron', sourcePromptPrefix: '[cron:fixture-id Maintenance continuation]' },
  __openclaw: { id: 'scheduled-input', mirrorOrigin: 'codex-app-server', mirrorIdentity: 'turn:prompt',
    runId: 'fixture-run', idempotencyKey: 'fixture-input:user', transcriptPosition: { source: 'fixture-sqlite', rawSeq: 10 } },
};
const project = (messages: unknown[]) => messagesFromPayload({ sessionKey: 'fixture',
  sessionId: '00000000-0000-4000-8000-000000000001', messages });
const visibleText = (rows: ReturnType<typeof project>, expanded = new Set<string>()) =>
  buildVisibleTranscriptRenderRows(rows, expanded).map(row => row.compiled.source).join('\n');

describe('typed scheduler input imported in an assistant slot', () => {
  it.each(['assistant', 'user'])('folds the %s projection while retaining its original details', role => {
    const rows = project([{ ...cron, role }]);
    expect(rows[0]?.role).toBe('system');
    expect(rows[0]?.text).toBe(`Scheduled run\n${cronBody}`);
    expect(rows[0]?.attachments).toBeUndefined();
    const rendered = buildVisibleTranscriptRenderRows(rows, new Set());
    expect(rendered).toHaveLength(1);
    expect(visibleText(rows)).toContain('Scheduled run');
    expect(visibleText(rows)).not.toContain('Nobody is present');
    expect(visibleText(rows, new Set([rows[0]!.id]))).toContain(cronBody);
  });

  it('keeps internal provenance authoritative over imported commentary hints', () => {
    expect(project([{ ...cron, stopReason: 'toolUse', provider: 'claude-cli' }])[0]?.role).toBe('system');
    expect(project([{ ...cron, openclawStreamFallback: { source: 'segment', itemId: 'segment' } }])[0]?.role).toBe('system');
  });

  it('repairs the same stale assistant record on refresh and retains folding across cache restoration', () => {
    let current = project([{ ...cron, provenance: undefined }]);
    const latest = project([cron]);
    for (let pass = 0; pass < 3; pass++) {
      current = mergeLatestHistory(latest, current, 'fixture');
      current = parsedTranscriptCache(serializedTranscriptCache(current));
      expect(current).toHaveLength(1);
      expect(current[0]?.id).toBe('scheduled-input');
      expect(current[0]?.role).toBe('system');
      expect(visibleText(current)).not.toContain('Nobody is present');
      expect(visibleText(current, new Set(['scheduled-input']))).toContain(cronBody);
    }
  });

  it('does not relabel authored explanations or quotations from scheduler-looking prose', () => {
    for (const role of ['assistant', 'user']) {
      for (const provenance of [undefined, {}, { kind: 'external', sourceTool: 'cron' }, [{ kind: 'internal_system' }]]) {
        const rows = project([{ ...cron, role, provenance }]);
        expect(rows[0]?.role).toBe(role);
        expect(rows[0]?.text).toBe(cronBody);
        expect(visibleText(rows)).toContain('Nobody is present');
      }
    }
  });

  it('does not retire a same-ID record in a different route or concrete generation', () => {
    const fresh = project([cron])[0]!;
    const old = project([{ ...cron, provenance: undefined }])[0]!;
    for (const foreign of [{ ...old, sessionKey: 'other-route' },
      { ...old, transcriptSessionId: '00000000-0000-4000-8000-000000000002' }]) {
      expect(retainedHistoryRecords([foreign], [fresh])).toEqual([foreign]);
    }
  });

  it('preserves a genuine worker-result delivery failure instead of calling it a successful scheduled run', () => {
    const failure = 'Native subagent fixture finished with status succeeded, but its completion could not be delivered. Automatic delivery has stopped.';
    const rows = project([{ ...cron, content: failure,
      provenance: { kind: 'internal_system', sourceTool: 'subagents' } }]);
    expect(rows[0]?.role).toBe('system');
    expect(visibleText(rows)).toBe(failure);
  });
});
