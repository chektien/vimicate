import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from './historyMessageProjection';
import { transcriptMessageMarker } from '../transcript/transcriptPresentation';
import { transcriptMessageIsFoldedByDefault } from '../transcript/transcriptRowBudget';

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
