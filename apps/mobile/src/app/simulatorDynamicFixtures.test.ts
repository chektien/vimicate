// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messageByApplyingRecovery } from '../gateway/messageRecovery';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { coalesceTranscriptIdentities } from '../gateway/transcriptIdentityWall';
import { projectClaudeHistoryDeliveries } from '../transcript/claudeHistoryPresentation';
import { CLAUDE_LINKED_PROMPT, CLAUDE_LINKED_FIRST, CLAUDE_LINKED_SECOND } from './simulatorClaudePromptIdentityFixture';
import {
  DISTINCT_MEDIA_PIXEL,
  MEDIA_DYNAMIC_AFTER,
  MEDIA_DYNAMIC_BEFORE,
  MEDIA_DYNAMIC_LOCAL_PIXEL,
  MEDIA_DYNAMIC_PIXEL,
  MEDIA_DYNAMIC_PROMPT,
  simulatorDynamicMediaPromptRows,
} from './simulatorDynamicMediaPromptFixture';
import {
  CLAUDE_DYNAMIC_FINAL,
  CLAUDE_DYNAMIC_FIRST,
  CLAUDE_DYNAMIC_PROMPT,
  AMBIGUOUS_PROMPT,
  CANONICAL_FIRST_FINAL,
  CODEX_DYNAMIC_COMMENTARY_ONE,
  CODEX_DYNAMIC_COMMENTARY_TWO,
  CODEX_DYNAMIC_PROMPT,
  CROSS_SCOPE_PROMPT,
  DYNAMIC_CACHE_RESTORE_MARKER,
  DYNAMIC_REPEAT_REFRESH_MARKER,
  LATE_REPLAY_FINAL,
  OVERSIZED_DYNAMIC_FINAL,
  OVERSIZED_DYNAMIC_PLACEHOLDER,
  PENDING_FINAL_TEXT,
  REPEATED_PROMPT,
  SETTLED_FINAL_TEXT,
  SIMULATOR_DYNAMIC_FIXTURE_MODE,
  acknowledgeSimulatorDynamicReceipts,
  publishSimulatorDynamicCanonicalRows,
  repeatSimulatorDynamicCanonicalRefresh,
  restoreSimulatorDynamicCanonicalCache,
  simulatorDynamicRows,
  simulatorDynamicRowsForReceiptPhase,
} from './simulatorDynamicFixtureData';

describe('simulator dynamic production-owner fixtures', () => {
  it('keeps two linked Claude submissions singular before an aggregate, after refresh and cache restore', () => {
    const before = simulatorDynamicRows(false);
    expect(before.filter(row => row.text === CLAUDE_LINKED_PROMPT)).toHaveLength(4);
    const published = publishSimulatorDynamicCanonicalRows(before);
    const refreshed = repeatSimulatorDynamicCanonicalRefresh(published);
    for (const rows of [before, published, refreshed, restoreSimulatorDynamicCanonicalCache(refreshed)]) {
      const projected = projectClaudeHistoryDeliveries(coalesceTranscriptIdentities(rows));
      expect(projected.filter(row => [CLAUDE_LINKED_PROMPT, CLAUDE_LINKED_FIRST, CLAUDE_LINKED_SECOND].includes(row.text))
        .map(row => row.text)).toEqual([CLAUDE_LINKED_PROMPT, CLAUDE_LINKED_FIRST, CLAUDE_LINKED_PROMPT, CLAUDE_LINKED_SECOND]);
    }
  });

  it('uses one verifier-safe fixture selector without a shared 16-byte prefix', () => {
    expect(SIMULATOR_DYNAMIC_FIXTURE_MODE).toBe('qa-dynamic-v1');
    expect(SIMULATOR_DYNAMIC_FIXTURE_MODE.length).toBeLessThan(16);
  });

  it('converges real pending receipts before ack, then keeps equal-text inputs across distinct canonical execution runs', () => {
    const rawBeforeAck = simulatorDynamicRowsForReceiptPhase(false, false);
    const beforeAck = rawBeforeAck.filter(row => row.text === CODEX_DYNAMIC_PROMPT);
    expect(beforeAck).toEqual([
      expect.objectContaining({
        id: 'local-00000000-0000-4000-a000-000000000138', source: 'local',
        runId: 'simulator-codex-active-lifecycle-run',
        idempotencyKey: '00000000-0000-4000-a000-000000000138',
        inputReceiptRunId: '00000000-0000-4000-a000-000000000138',
      }),
      expect.objectContaining({
        id: 'local-00000000-0000-4000-8000-000000000139', source: 'local',
        runId: 'simulator-codex-active-lifecycle-run',
        idempotencyKey: '00000000-0000-4000-8000-000000000139',
        inputReceiptRunId: '00000000-0000-4000-8000-000000000139',
      }),
    ]);

    const acknowledged = acknowledgeSimulatorDynamicReceipts(rawBeforeAck);
    const accepted = acknowledged.filter(row => row.text === CODEX_DYNAMIC_PROMPT);
    expect(accepted).toHaveLength(2);
    expect(accepted.map(row => row.id)).toEqual([
      'local-00000000-0000-4000-a000-000000000138',
      'local-00000000-0000-4000-8000-000000000139',
    ]);
    expect(new Set(accepted.map(row => row.runId))).toEqual(new Set(['simulator-codex-active-lifecycle-run']));
    expect(new Set(accepted.map(row => row.inputReceiptRunId)).size).toBe(2);
    expect(accepted.map(row => [row.inputAcceptedAtMs, row.timestamp])).toEqual([
      [1789839783745, '1789839783745'],
      [1789839812836, '1789839812836'],
    ]);
    expect(acknowledged.filter(row => [CODEX_DYNAMIC_PROMPT, CODEX_DYNAMIC_COMMENTARY_ONE, CODEX_DYNAMIC_COMMENTARY_TWO].includes(row.text))
      .map(row => row.text)).toEqual([
      CODEX_DYNAMIC_PROMPT, CODEX_DYNAMIC_COMMENTARY_ONE,
      CODEX_DYNAMIC_PROMPT, CODEX_DYNAMIC_COMMENTARY_TWO,
    ]);

    const canonical = publishSimulatorDynamicCanonicalRows(acknowledged);
    expect(canonical.filter(row => row.text === CODEX_DYNAMIC_PROMPT)).toEqual([
      expect.objectContaining({
        id: 'simulator-codex-canonical-one', runId: '00000000-0000-4000-a000-000000000102',
        idempotencyKey: '00000000-0000-4000-a000-000000000138:user',
        displayPosition: { source: 'sqlite', rawSeq: 23567 },
      }),
      expect.objectContaining({
        id: 'simulator-codex-canonical-two', runId: '00000000-0000-4000-a000-000000000147',
        idempotencyKey: '00000000-0000-4000-8000-000000000139:user',
        displayPosition: { source: 'sqlite', rawSeq: 23574 },
      }),
    ]);
    const refreshed = repeatSimulatorDynamicCanonicalRefresh(canonical);
    expect(refreshed.filter(row => row.text === CODEX_DYNAMIC_PROMPT)).toHaveLength(2);
    expect(refreshed.some(row => row.text === DYNAMIC_REPEAT_REFRESH_MARKER)).toBe(true);
    const cacheRestored = restoreSimulatorDynamicCanonicalCache(refreshed);
    expect(cacheRestored.filter(row => row.text === CODEX_DYNAMIC_PROMPT)).toHaveLength(2);
    expect(cacheRestored.some(row => row.text === DYNAMIC_CACHE_RESTORE_MARKER)).toBe(true);
    const restored = parsedTranscriptCache(serializedTranscriptCache(cacheRestored));
    expect(restored.filter(row => row.text === CODEX_DYNAMIC_PROMPT).map(row => row.displayPosition?.rawSeq))
      .toEqual([23567, 23574]);
  });

  it('preserves local media through receipt convergence, then admits canonical media at accepted chronology', () => {
    const beforeAck = simulatorDynamicMediaPromptRows(false, undefined, false)
      .filter(row => row.text === MEDIA_DYNAMIC_PROMPT);
    expect(beforeAck).toEqual([expect.objectContaining({
      id: 'local-simulator-media-submission', source: 'local',
      idempotencyKey: 'simulator-media-submission', inputReceiptRunId: 'simulator-media-submission',
      attachments: [expect.objectContaining({ uri: MEDIA_DYNAMIC_LOCAL_PIXEL })],
    })]);

    const accepted = simulatorDynamicMediaPromptRows(false);
    expect(accepted.filter(row => row.text === MEDIA_DYNAMIC_PROMPT)).toEqual([
      expect.objectContaining({
        id: 'local-simulator-media-submission', source: 'local',
        runId: 'simulator-media-prompt-run', inputReceiptRunId: 'simulator-media-submission',
        inputAcceptedAtMs: 1789815470000,
        attachments: [expect.objectContaining({ uri: MEDIA_DYNAMIC_LOCAL_PIXEL, byteCount: 418_100 })],
      }),
    ]);

    const projected = coalesceTranscriptIdentities(simulatorDynamicMediaPromptRows(true));
    const promptRows = projected.filter(row => row.text === MEDIA_DYNAMIC_PROMPT);
    expect(promptRows).toEqual([
      expect.objectContaining({
        id: 'simulator-media-canonical',
        runId: '00000000-0000-4000-b000-000000000140',
        idempotencyKey: 'simulator-media-submission:user',
        displayPosition: { source: 'sqlite', rawSeq: 3103 },
        attachments: [expect.objectContaining({ mimeType: 'image/png' })],
      }),
    ]);
    const before = projected.findIndex(row => row.text === MEDIA_DYNAMIC_BEFORE);
    const prompt = projected.findIndex(row => row.text === MEDIA_DYNAMIC_PROMPT);
    const tool = projected.findIndex(row => row.role === 'tool' && row.runId === 'simulator-media-prompt-run');
    const after = projected.findIndex(row => row.text === MEDIA_DYNAMIC_AFTER);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(before).toBeLessThan(prompt);
    expect(prompt).toBeLessThan(tool);
    expect(tool).toBeLessThan(after);
  });

  it('does not collapse a media row for an unidentified receipt even when its text matches', () => {
    const prompts = coalesceTranscriptIdentities(simulatorDynamicMediaPromptRows(
      false, DISTINCT_MEDIA_PIXEL, false, 'simulator-unidentified-media-receipt',
    ))
      .filter(row => row.text === MEDIA_DYNAMIC_PROMPT);
    expect(prompts).toHaveLength(2);
    expect(new Set(prompts.map(row => row.attachments?.[0]?.uri)).size).toBe(2);
  });

  it('would be born red without Claude native alias convergence and aggregate chronology', () => {
    const raw = simulatorDynamicRows(true);
    expect(raw.filter(row => row.text === CLAUDE_DYNAMIC_PROMPT)).toHaveLength(2);
    const projected = projectClaudeHistoryDeliveries(coalesceTranscriptIdentities(raw));
    expect(projected.filter(row => row.text === CLAUDE_DYNAMIC_PROMPT)).toEqual([
      expect.objectContaining({ id: 'simulator-claude-canonical-user', displayPosition: { source: 'sqlite', rawSeq: 93 } }),
    ]);
    const prompt = projected.findIndex(row => row.text === CLAUDE_DYNAMIC_PROMPT);
    const first = projected.findIndex(row => row.text === CLAUDE_DYNAMIC_FIRST);
    const final = projected.findIndex(row => row.text === CLAUDE_DYNAMIC_FINAL);
    expect(prompt).toBeGreaterThanOrEqual(0);
    expect(first).toBeGreaterThan(prompt);
    expect(final).toBeGreaterThan(first);
    expect(projected.slice(first + 1, final).some(row => row.role === 'tool')).toBe(true);
    expect(projected.some(row => row.id === 'simulator-claude-aggregate')).toBe(false);
  });

  it('would be born red without authoritative oversized omission admission and short-final recovery', () => {
    const omitted = simulatorDynamicRows(false).find(row => row.text === OVERSIZED_DYNAMIC_PLACEHOLDER)!;
    expect(omitted).toMatchObject({
      id: 'simulator-oversized-message',
      recovery: { sourceMessageId: 'simulator-oversized-message', state: 'available' },
    });
    expect(messageByApplyingRecovery(omitted, OVERSIZED_DYNAMIC_FINAL, [])).toMatchObject({
      text: OVERSIZED_DYNAMIC_FINAL,
      recovery: { sourceMessageId: 'simulator-oversized-message', state: 'recovered' },
    });
  });

  it('runs canonical-first, late-replay and pending-final settlement through production owners', () => {
    const before = simulatorDynamicRows(false);
    const after = simulatorDynamicRows(true);
    expect(before.filter(row => row.text === CANONICAL_FIRST_FINAL)).toHaveLength(1);
    expect(after.filter(row => row.text === CANONICAL_FIRST_FINAL)).toHaveLength(1);
    expect(after.find(row => row.text === CANONICAL_FIRST_FINAL)).toMatchObject({
      id: 'canonical-first-final', absorbedLiveIdentity: { messageId: 'live-chat-simulator-canonical-run', runId: 'simulator-canonical-run' },
    });
    expect(after.findIndex(row => row.text === LATE_REPLAY_FINAL)).toBeLessThan(
      after.findIndex(row => row.text === 'SIMULATOR newer prompt after late replay'),
    );
    expect(before.some(row => row.text === PENDING_FINAL_TEXT)).toBe(true);
    expect(after.some(row => row.text === PENDING_FINAL_TEXT)).toBe(false);
    expect(after.filter(row => row.text === SETTLED_FINAL_TEXT)).toHaveLength(1);
    expect(after.filter(row => row.text.includes('SIMULATOR authoritative failure'))).toHaveLength(1);
  });

  it('fails closed for ambiguous, repeated and cross-scope equal prompts', () => {
    const projected = coalesceTranscriptIdentities(simulatorDynamicRows(true));
    expect(projected.filter(row => row.text === AMBIGUOUS_PROMPT)).toHaveLength(3);
    expect(projected.filter(row => row.text === REPEATED_PROMPT)).toHaveLength(2);
    expect(projected.filter(row => row.text === CROSS_SCOPE_PROMPT)).toHaveLength(2);
  });

  it('mounts only the existing bounded owners against explicit fake I/O', () => {
    const source = readFileSync(new URL('./simulatorDynamicFixtures.tsx', import.meta.url), 'utf8');
    expect(source).toContain('useProviderUsage(client as unknown as OpenClawClient');
    expect(source).toContain('useGatewayMessageRecovery({');
    expect(source).toContain('class SimulatorFakeGatewayIO');
    expect(source).toContain('simulatorDynamicRowsForReceiptPhase(false, false)');
    expect(source).toContain("['before-ack', 'QA receipt before ack']");
    expect(source).toContain("['acknowledged', 'QA receipt acknowledge']");
    expect(source).toContain("['canonical', 'QA receipt canonical']");
    expect(source).toContain('repeatSimulatorDynamicCanonicalRefresh');
    expect(source).toContain('restoreSimulatorDynamicCanonicalCache');
    expect(source).toContain('if (!manualReceiptControl.current) setMessages(acknowledgeSimulatorDynamicReceipts)');
    expect(source).toContain('if (manualReceiptControl.current) return current');
    expect(source).toContain('client.dispose();');
    expect(source).toContain('for (const timer of this.timers) clearTimeout(timer)');
    expect(source).not.toContain('new OpenClawClient(');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/WebSocket|wss:\/\/[^']+\.com/);
  });


});
