import { defineConfig } from 'vitest/config';

// The canonical checkout keeps every maintainer release and evidence gate.
export default defineConfig({ test: { maxWorkers: 4, include: [
  'src/**/*.test.{ts,tsx}', 'modules/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs', 'private-tests/**/*.test.{ts,tsx}',
] } });
