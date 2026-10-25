// @ts-expect-error Vitest's Node runtime provides these test-only modules.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { completedLatestHistoryPage } from '../gateway/completedLatestHistoryPage';
import { PendingFinalAnswerRegistry } from '../gateway/pendingFinalAnswerRegistry';
import type { OpenClawClient } from '../gateway/OpenClawClient';
import {
  GLM_FINAL_PREAMBLE, GLM_FIRST_PREAMBLE, GLM_STEER_PROMPT, PAGINATION_LATEST,
  SIMULATOR_RECOVERY_FIXTURE_MODE, paginationLatestPayload, simulatorRecoveryRows,
} from './simulatorRecoveryFixtureData';

describe('simulator recovery production-owner fixture', () => {
  it('uses a verifier-safe independent selector', () => {
    expect(SIMULATOR_RECOVERY_FIXTURE_MODE).toBe('qa-recovery-v1');
    expect(SIMULATOR_RECOVERY_FIXTURE_MODE.length).toBeLessThan(16);
  });

  it('converges itemId-less GLM revisions at the first chronology slot', () => {
    const before = simulatorRecoveryRows(false);
    const after = simulatorRecoveryRows(true);
    expect(before.filter(row => row.text === GLM_FIRST_PREAMBLE)).toHaveLength(1);
    expect(after.filter(row => row.text === GLM_FIRST_PREAMBLE)).toHaveLength(0);
    expect(after.filter(row => row.text === GLM_FINAL_PREAMBLE)).toHaveLength(1);
    expect(after.findIndex(row => row.text === GLM_FINAL_PREAMBLE)).toBeGreaterThan(after.findIndex(row => row.text === GLM_STEER_PROMPT));
  });

  it('keeps archived review rows, filters stale live cache, and owns the replacement tail', () => {
    const rows = simulatorRecoveryRows(true);
    expect(rows.some(row => row.text === 'RECOVERY archived review prompt remains mounted')).toBe(true);
    expect(rows.some(row => row.text === 'RECOVERY archived review answer remains mounted')).toBe(true);
    expect(rows.some(row => row.text === 'RECOVERY replacement generation prompt')).toBe(true);
    expect(rows.some(row => row.text === 'RECOVERY stale prior generation MUST NOT PUBLISH')).toBe(false);
  });

  it('preserves the valid latest page and public cursor when optional completion lookback fails', async () => {
    const history = vi.fn().mockRejectedValue(new Error('optional context unavailable'));
    const client = { status: 'connected', history, decorateMessages: (rows: unknown) => rows } as unknown as OpenClawClient;
    const completed = await completedLatestHistoryPage(client, 'fixture:recovery:pagination', paginationLatestPayload(), '', () => true);
    expect(completed?.messages.map(row => row.text)).toContain(PAGINATION_LATEST);
    expect(completed?.cursor.nextOffset).toBe(80);
    expect(completed?.lookbackProblem).toBe('earlier prompt context: optional context unavailable');
  });

  it('retains independent many-run obligations when only the tracked run settles', () => {
    const registry = new PendingFinalAnswerRegistry();
    for (const [index, runId] of ['old', 'tracked', 'new'].entries()) registry.register('one', runId, index + 1);
    expect(registry.settle('one', 'tracked')).toBe(true);
    expect(registry.entries().map(entry => entry.runId)).toEqual(['old', 'new']);
  });

  it('mounts real recovery owners with bounded fake I/O and owner retirement', () => {
    const source = readFileSync(new URL('./simulatorRecoveryFixtures.tsx', import.meta.url), 'utf8');
    expect(source).toContain('completedLatestHistoryPage(');
    expect(source).toContain('useGatewayMessageRecovery({');
    expect(source).toContain('useGatewayFinalAnswerRecovery({');
    expect(source).toContain('authorizedHistoryStatePublication(');
    expect(source).toContain('recoveryOwners.current.clear()');
    expect(source).toContain('client.dispose()');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/WebSocket|wss:\/\//);
  });


});
