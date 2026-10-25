import { defineConfig } from 'vitest/config';

// Portable contracts use source and synthetic fixtures only, never private ledgers,
// captures, release credentials or generated platform projects.
export default defineConfig({ test: { maxWorkers: 4, include: [
  'src/**/*.test.{ts,tsx}', 'modules/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs',
] } });
