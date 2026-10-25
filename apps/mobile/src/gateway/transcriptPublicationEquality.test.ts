import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { sameTranscriptPublication, sameWorkspaceMessageExceptText } from './transcriptPublicationEquality';

const row: WorkspaceMessage = { id: 'answer', role: 'assistant', text: 'done', sessionKey: 'one', source: 'history', attachments: [{ id: 'image', filename: 'proof.png', mimeType: 'image/png', uri: 'https://example.test/proof.png', headers: { z: 'last', a: 'first' } }] };

describe('transcript publication equality', () => {
  it('suppresses a semantically identical authoritative refresh', () => {
    expect(sameTranscriptPublication([row], [{ ...row, attachments: row.attachments!.map((attachment) => ({ ...attachment, headers: { a: 'first', z: 'last' } })) }])).toBe(true);
  });

  it('publishes cumulative streaming text and lifecycle changes', () => {
    expect(sameTranscriptPublication([row], [{ ...row, text: 'done now' }])).toBe(false);
    expect(sameTranscriptPublication([row], [{ ...row, state: 'streaming' }])).toBe(false);
  });

  it('publishes image geometry learned after the first media row', () => {
    const unresolved: WorkspaceMessage = {
      ...row,
      attachments: [{ ...row.attachments![0]! }],
    };
    const measured: WorkspaceMessage = {
      ...unresolved,
      attachments: [{ ...unresolved.attachments![0]!, pixelWidth: 2048, pixelHeight: 1536 }],
    };

    expect(sameTranscriptPublication([unresolved], [measured])).toBe(false);
  });

  it('does not suppress nested tool, approval, recovery, or attachment changes', () => {
    const detailed: WorkspaceMessage = {
      ...row,
      tool: { name: 'bash', summary: 'checking', durationMs: 10 },
      approval: { id: 'approval', kind: 'exec', allowedDecisions: ['allow-once', 'deny'], resolved: false, expiresAtMs: 100 },
      recovery: { sourceMessageId: 'source', state: 'available', detail: 'tap to load' },
    };

    expect(sameTranscriptPublication([detailed], [{ ...detailed, tool: { ...detailed.tool!, durationMs: 11 } }])).toBe(false);
    expect(sameTranscriptPublication([detailed], [{ ...detailed, approval: { ...detailed.approval!, resolved: true, outcome: 'allowed' } }])).toBe(false);
    expect(sameTranscriptPublication([detailed], [{ ...detailed, recovery: { ...detailed.recovery!, state: 'loading' } }])).toBe(false);
    expect(sameTranscriptPublication([detailed], [{ ...detailed, attachments: [] }])).toBe(false);
  });

  it('compares rich publications without serializing their full bodies', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const rich = Array.from({ length: 480 }, (_, index): WorkspaceMessage => ({
      id: `tool-${index}`,
      role: 'tool',
      text: `tool ${index}\n${'x'.repeat(16_000)}`,
      tool: { name: 'bash', summary: `step ${index}`, durationMs: index },
    }));
    const refreshed = rich.map((message): WorkspaceMessage => ({ ...message, tool: { ...message.tool! } }));

    expect(sameTranscriptPublication(rich, refreshed)).toBe(true);
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });
});

it.each(['chatCumulativeText', 'claudeNativeFullText', 'terminalReplyText'] as const)(
  'publishes changed %s authority while preserving presentation equality', (field) => {
    const before = { ...row, [field]: 'first\n\nanswer' };
    const after = { ...row, [field]: 'second\n\nanswer' };
    expect(sameTranscriptPublication([before], [after])).toBe(false);
    expect(sameWorkspaceMessageExceptText(before, after)).toBe(true);
    expect(sameTranscriptPublication([after], [{ ...after }])).toBe(true);
  },
);
