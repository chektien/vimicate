// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { join } from 'node:path';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaults, inventory, productionSourceFiles, sizeViolations } from '../../../../scripts/architecture/source-size-policy.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const exceptions: Record<string, { lines: number; bytes: number; plan: string }> = JSON.parse(
  readFileSync(new URL('../../../../scripts/architecture/source-size-exceptions.json', import.meta.url), 'utf8'),
);

describe('automatic production source size coverage', () => {
  it('covers every source in the mobile, native-module and host roots', () => {
    const rows: Array<{ path: string; lines: number; bytes: number }> = inventory(root);
    expect(rows.length).toBeGreaterThan(0);
    const paths = new Set(rows.map(row => row.path));
    expect(paths.has('apps/mobile/modules/vimicate-editor/ios/VimicateEditorView.swift')).toBe(true);
    expect(paths.has('apps/mobile/modules/vimicate-editor/src/VimicateEditorView.web.tsx')).toBe(true);
    expect(paths.has('host/openclaw/vimicate-narration-record-contract.mjs')).toBe(true);
    const violations = rows.flatMap(({ path }) => sizeViolations(path, readFileSync(join(root, path), 'utf8'), exceptions));
    expect(violations).toEqual([]);
    for (const [path, ceiling] of Object.entries(exceptions)) {
      expect(paths.has(path), `remove stale exception: ${path}`).toBe(true);
      expect(ceiling.plan.length, `missing split plan: ${path}`).toBeGreaterThan(20);
      const actual = rows.find(row => row.path === path)!;
      expect(actual.lines > defaults.lines || actual.bytes > defaults.bytes, `retire resolved exception: ${path}`).toBe(true);
    }
  });

  it('discovers new files without an allowlist and excludes only test/build artifacts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vimicate-size-policy-'));
    try {
      const included = [
        'feature/NewOwner.ts', 'feature/NewOwner.web.tsx', 'feature/Bridge.swift',
        'feature/Owner.mts', 'feature/Owner.cts', 'feature/Owner.jsx',
        'feature/Native.m', 'feature/Native.mm', 'feature/Native.h',
        'feature/build/Owner.ts', 'feature/dist/Owner.ts',
        'feature/tests/Owner.ts', 'feature/architecture/Owner.ts',
      ];
      const excluded = [
        'feature/NewOwner.test.ts', 'feature/NewOwner.spec.ts', 'feature/types.d.mts',
        'node_modules/vendor.js', '.build/Generated.swift', '__tests__/Probe.ts',
        'apps/mobile/modules/sample/tests/Probe.swift',
        'apps/mobile/modules/sample/build/Generated.js',
        'apps/mobile/modules/sample/dist/Generated.js',
        'apps/mobile/src/build/Generated.js', 'host/openclaw/dist/Generated.js',
      ];
      for (const path of [...included, ...excluded]) {
        mkdirSync(join(directory, path, '..'), { recursive: true });
        writeFileSync(join(directory, path), 'const source = 1;\n');
      }
      expect(productionSourceFiles(directory)).toEqual(included.sort());
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('rejects a newly oversized module even when it is absent from the exceptions', () => {
    expect(sizeViolations('new.ts', 'const x = 1;\n'.repeat(351))).toEqual(['new.ts: 351 lines exceeds 350']);
  });

  it('rejects packed-line growth independently of line count', () => {
    expect(sizeViolations('new.ts', 'x'.repeat(24001))).toEqual(['new.ts: 24001 bytes exceeds 24000']);
    const limits = { 'existing.ts': { lines: 2, bytes: 12 } };
    expect(sizeViolations('existing.ts', 'let x = 1;\n', limits)).toEqual([]);
    expect(sizeViolations('existing.ts', 'let x = 12345;', limits)).toEqual(['existing.ts: 14 bytes exceeds 12']);
  });

  it('keeps the history parser out of workspace types and its runtime importers on the new owner', () => {
    const types = readFileSync(join(root, 'apps/mobile/src/workspace/workspaceTypes.ts'), 'utf8');
    expect(types).not.toMatch(/historyMessageProjection|function messagesFromPayload|function extractAttachments/);
    for (const path of productionSourceFiles(join(root, 'apps/mobile/src')) as string[]) {
      const source = readFileSync(join(root, 'apps/mobile/src', path), 'utf8');
      expect(source, path).not.toMatch(/import\s*\{[^}]*\b(?:messagesFromPayload|gatewayContentText|gatewayAttachments|authoritativeHistoryChronology)\b[^}]*\}\s*from\s*['"][^'"]*workspaceTypes['"]/);
    }
  });
});
