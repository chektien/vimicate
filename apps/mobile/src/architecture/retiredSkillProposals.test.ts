import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readdirSync, readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { join, relative } from 'node:path';

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry: { name: string; isDirectory: () => boolean }) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

describe('retired Workshop proposal boundary', () => {
  it('never requests the retired approval workflow from app startup, refresh, events or actions', () => {
    // OpenClaw keeps these methods registered, but every call fails with
    // INVALID_REQUEST. A catalog-presence check cannot make them usable.
    const files = [join(process.cwd(), 'App.tsx'), ...productionFiles(join(process.cwd(), 'src'))];
    const offenders = files.filter(path => /\bskills\.proposals\.|\bskill_proposal_changed\b/.test(readFileSync(path, 'utf8')));
    expect(offenders.map(path => relative(process.cwd(), path))).toEqual([]);
  });

  it('does not offer obsolete apply/reject proposal cards in the app composition', () => {
    const shell = readFileSync(join(process.cwd(), 'src/app/AppShell.tsx'), 'utf8');
    expect(shell).not.toMatch(/\bSkillProposalNotice\b|\bfixtureSkillProposals\b/);
  });
});
