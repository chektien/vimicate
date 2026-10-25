import { describe, expect, it } from 'vitest';
import fixture from './claudeHistoryFixture.json';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { sameTranscriptPublication } from '../gateway/transcriptPublicationEquality';
import { projectClaudeHistoryDeliveries } from './claudeHistoryPresentation';
const CLI_SESSION_ID = '00000000-0000-4000-8000-000000000114';

function example() {
  return [...messagesFromPayload({ ...fixture, messages: fixture.imported }),
    ...messagesFromPayload({ ...fixture, messages: fixture.canonical })];
}

function nativePrompt(overrides: Record<string, unknown> = {}) {
  return messagesFromPayload({ ...fixture, messages: [{
    role: 'user', content: 'Isolated named-skill read fixture.', timestamp: 1767225602055,
    __openclaw: {
      id: 'native-user', importedFrom: 'claude-cli',
      cliSessionId: CLI_SESSION_ID, externalId: 'native-user',
    },
    ...overrides,
  }] })[0]!;
}

describe('explicit native CLI and aggregate delivery presentation', () => {
  it('keeps the native step identities at the canonical prompt/answer slot, without mutating source history', () => {
    const rows = example(); const before = JSON.stringify(rows);
    const result = projectClaudeHistoryDeliveries(rows);
    expect(result.map(r => r.role)).toEqual(['user', 'narration', 'tool', 'tool', 'assistant']);
    expect(result[1]).toBe(rows[0]); expect(result.at(-1)).toBe(rows[3]);
    expect(projectClaudeHistoryDeliveries(result)).toBe(result);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('publishes one user row when the matched native CLI delivery repeats its canonical prompt', () => {
    const rows = [nativePrompt(), ...example()];
    const projected = projectClaudeHistoryDeliveries(rows);
    expect(projected.filter(row => row.role === 'user')).toEqual([
      expect.objectContaining({ id: '00000000-0000-4000-b000-000000000162', idempotencyKey: 'vimicate-provider-fixture-cli-run:user' }),
    ]);
    expect(projectClaudeHistoryDeliveries(projected)).toBe(projected);
    const restored = parsedTranscriptCache(serializedTranscriptCache(rows));
    expect(projectClaudeHistoryDeliveries(restored).filter(row => row.role === 'user')).toHaveLength(1);
  });

  it('preserves unproven or ambiguous repeated native user rows', () => {
    const canonical = example();
    const controls = [
      nativePrompt({ content: 'same words, different input' }),
      { ...nativePrompt(), cliProvenance: { kind: 'claude-native' as const, sessionId: '11111111-1111-4111-8111-111111111111', externalId: 'native-user' } },
      { ...nativePrompt(), sessionKey: 'other' },
      { ...nativePrompt(), transcriptSessionId: '11111111-1111-4111-8111-111111111111' },
      { ...nativePrompt(), attachments: [{ id: 'image', filename: 'image.png', mimeType: 'image/png' }] },
    ];
    for (const row of controls) expect(projectClaudeHistoryDeliveries([row, ...canonical])).toContain(row);
    const first = nativePrompt(); const second = { ...nativePrompt(), id: 'native-user-two',
      cliProvenance: { kind: 'claude-native' as const, sessionId: CLI_SESSION_ID, externalId: 'native-user-two' } };
    const ambiguous = projectClaudeHistoryDeliveries([first, second, ...canonical]);
    expect(ambiguous).toContain(first); expect(ambiguous).toContain(second);
  });

  it('does not project across an unmatched native input or boundary in the delivery window', () => {
    for (const extra of [nativePrompt({ content: 'A different input' }),
      { ...nativePrompt(), role: 'boundary' as const },
      { ...nativePrompt(), runId: 'other-run' }]) {
      const rows = [extra, ...example()];
      expect(projectClaudeHistoryDeliveries(rows)).toBe(rows);
    }
  });

  const controls: Array<[string, (rows: WorkspaceMessage[]) => WorkspaceMessage[]]> = [
    ['native page only', rows => rows.slice(0, 4)],
    ['aggregate page only', rows => rows.slice(4)],
    ['incomplete native turn', rows => rows.filter((_, i) => i !== 3)],
    ['missing provenance', rows => rows.map(({ cliProvenance: _, ...row }) => row)],
    ['another concrete generation', rows => rows.map((row, i) => i < 4 ? { ...row, transcriptSessionId: '11111111-1111-4111-8111-111111111111' } : row)],
    ['another stable route', rows => rows.map((row, i) => i < 4 ? { ...row, sessionKey: 'other' } : row)],
    ['conflicting explicit run', rows => rows.map((row, i) => i === 0 ? { ...row, runId: 'another' } : row)],
    ['no explicit prompt owner', rows => rows.filter(row => row.role !== 'user')],
    ['wrong aggregate protocol key', rows => rows.map(row => row.cliProvenance?.kind === 'claude-aggregate' ? { ...row, idempotencyKey: 'generic-assistant' } : row)],
    ['extra native answer', rows => [{ ...rows[0]!, id: 'extra', text: 'Different native output', cliProvenance: { kind: 'claude-native', sessionId: '00000000-0000-4000-8000-000000000114', externalId: 'extra' } }, ...rows]],
    ['two native sources match', rows => [...rows.slice(0, 4).map(row => ({ ...row, id: `second-${row.id}`, cliProvenance: { kind: 'claude-native' as const, sessionId: '11111111-1111-4111-8111-111111111111', externalId: `second-${row.id.split('#tool-')[0]}` } })), ...rows]],
    ['native media is not redundant text', rows => rows.map((row, i) => i === 0 ? { ...row, attachments: [{ id: 'image', filename: 'image.png', mimeType: 'image/png' }] } : row)],
    ['aggregate media is not redundant text', rows => rows.map(row => row.cliProvenance?.kind === 'claude-aggregate' ? { ...row, attachments: [{ id: 'image', filename: 'image.png', mimeType: 'image/png' }] } : row)],
    ['a different canonical turn intervenes', rows => [...rows.map(row => row.cliProvenance?.kind === 'claude-aggregate' ? { ...row, displayPosition: { ...row.displayPosition!, rawSeq: 95 } } : row), { ...rows[4]!, id: 'different-prompt', idempotencyKey: 'other:user', displayPosition: { ...rows[4]!.displayPosition!, rawSeq: 94 } }]],
  ];
  for (const [name, change] of controls) it(`preserves ${name}`, () => {
    const rows = change(example()); expect(projectClaudeHistoryDeliveries(rows)).toBe(rows);
  });

  it('retains validated provenance across cache and publishes metadata-only hydration', () => {
    const rows = example(); const restored = parsedTranscriptCache(serializedTranscriptCache(rows));
    expect(restored.map(r => r.cliProvenance)).toEqual(rows.map(r => r.cliProvenance));
    expect(projectClaudeHistoryDeliveries(restored).map(r => r.id)).toEqual(projectClaudeHistoryDeliveries(rows).map(r => r.id));
    expect(sameTranscriptPublication(rows, rows.map(({ cliProvenance: _, ...row }) => row))).toBe(false);
    const invalid = parsedTranscriptCache(JSON.stringify([{ ...rows[0], cliProvenance: { kind: 'claude-native', sessionId: 'not-a-session', externalId: 'id' } }]));
    expect(invalid[0]?.cliProvenance).toBeUndefined();
  });
});
