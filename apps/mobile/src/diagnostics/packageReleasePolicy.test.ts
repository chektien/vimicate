// @ts-expect-error Vitest's Node runtime supplies the test-only filesystem.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps one exact-version age exception per package so pnpm first-match rules cannot shadow later approvals', () => {
  const source: string = readFileSync('pnpm-workspace.yaml', 'utf8');
  const entries = source.split('\n').flatMap((line) => {
    const match = line.match(/^  - ['"]?(.+?)['"]?$/);
    return match ? [match[1]!] : [];
  });
  const names = entries.map((entry) => entry.slice(0, entry.lastIndexOf('@')));
  expect(new Set(names).size).toBe(names.length);
  for (const entry of entries) {
    expect(entry).not.toContain('*');
    const versions = entry.slice(entry.lastIndexOf('@') + 1).split(' || ');
    expect(versions.every((version) => /^\d+\.\d+\.\d+$/.test(version))).toBe(true);
  }
});
