import { expect, it } from 'vitest';
import { commitSimulatorClaudeQueue, restoreSimulatorClaudeQueue, simulatorClaudeQueuedRows } from './simulatorClaudeQueueFixture';

it('retires four queued aliases without losing two intentional repeated Claude submissions', () => {
  const queued = simulatorClaudeQueuedRows();
  expect(queued).toHaveLength(4);
  expect(queued.every(row => row.id.startsWith('pending-input:'))).toBe(true);
  let rows = commitSimulatorClaudeQueue(queued);
  for (let refresh = 0; refresh < 3; refresh += 1) {
    expect(rows.filter(row => row.role === 'user').map(row => row.text)).toEqual([
      'SIMULATOR stop using opencode astra', 'SIMULATOR stop',
      'SIMULATOR intentional repeat', 'SIMULATOR intentional repeat',
    ]);
    expect(rows.some(row => row.id.startsWith('pending-input:'))).toBe(false);
    expect(new Set(rows.map(row => row.idempotencyKey)).size).toBe(4);
    rows = restoreSimulatorClaudeQueue(rows);
  }
});
