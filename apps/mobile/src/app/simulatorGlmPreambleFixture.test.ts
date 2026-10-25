import { expect, it } from 'vitest';
import { GLM_REPLAY_A, GLM_REPLAY_B, GLM_REPLAY_FINAL, GLM_REPLAY_REPEAT,
  publishSimulatorGlmCanonical, repeatSimulatorGlmCanonical, restoreSimulatorGlmCache,
  simulatorGlmLiveRows } from './simulatorGlmPreambleFixture';

function roles(rows: ReturnType<typeof simulatorGlmLiveRows>, text: string) {
  return rows.filter(row => row.text === text).map(row => row.role);
}

it('renders one row per owned GLM item, preserves intentional repeats, and converges through canonical/cache controls', () => {
  const live = simulatorGlmLiveRows();
  expect(roles(live, GLM_REPLAY_A)).toEqual(['narration']);
  expect(roles(live, GLM_REPLAY_B)).toEqual(['narration']);
  expect(roles(live, GLM_REPLAY_REPEAT)).toEqual(['narration', 'narration', 'assistant']);
  expect(roles(live, GLM_REPLAY_FINAL)).toEqual([]);

  const canonical = publishSimulatorGlmCanonical(live);
  const repeated = repeatSimulatorGlmCanonical(canonical);
  const restored = restoreSimulatorGlmCache(repeated);
  for (const rows of [canonical, repeated, restored]) {
    expect(roles(rows, GLM_REPLAY_A)).toEqual(['narration']);
    expect(roles(rows, GLM_REPLAY_B)).toEqual(['narration']);
    expect(roles(rows, GLM_REPLAY_FINAL)).toEqual(['assistant']);
    expect(roles(rows, GLM_REPLAY_REPEAT)).toEqual(['narration', 'narration', 'assistant']);
  }
});
