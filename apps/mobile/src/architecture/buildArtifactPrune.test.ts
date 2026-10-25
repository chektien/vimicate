// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { execFileSync } from 'node:child_process';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { tmpdir } from 'node:os';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe('RN build-artifact pruning', () => {
  it('admits only marked Vimicate Xcode DerivedData under the configured temporary root', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'vimicate-prune-contract-'));
    temporaryRoots.push(temporaryRoot);
    const mobileRoot = join(temporaryRoot, 'mobile');
    const derived = join(temporaryRoot, 'vimicate-rn-old-release');
    const retainedEvidence = join(temporaryRoot, 'vimicate-rn-crash-report');
    const uppercaseDerived = join(temporaryRoot, 'VimicateRN-old-physical-release');
    mkdirSync(join(derived, 'Build', 'Products'), { recursive: true });
    writeFileSync(join(derived, 'info.plist'), 'generated');
    mkdirSync(join(uppercaseDerived, 'Build', 'Products'), { recursive: true });
    writeFileSync(join(uppercaseDerived, 'info.plist'), 'generated');
    mkdirSync(retainedEvidence, { recursive: true });
    writeFileSync(join(retainedEvidence, 'incident.ips'), 'evidence');
    mkdirSync(mobileRoot, { recursive: true });
    writeFileSync(join(mobileRoot, 'package.json'), '{}');

    const output = execFileSync('/bin/bash', [resolve(process.cwd(), 'scripts/prune-rn-build-artifacts.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VIMICATE_RN_MOBILE_ROOT: mobileRoot,
        VIMICATE_RN_TEMP_DERIVED_ROOT: temporaryRoot,
        VIMICATE_XCODE_DERIVED_ROOT: join(temporaryRoot, 'ordinary-derived'),
        VIMICATE_XCODE_ARCHIVES_ROOT: join(temporaryRoot, 'archives'),
      },
    });

    expect(output).toContain(`WOULD_REMOVE category=rn-temporary-xcode-derived`);
    expect(output).toContain(`path=${derived}`);
    expect(output).toContain(`path=${uppercaseDerived}`);
    expect(output).not.toContain(retainedEvidence);
    expect(readFileSync(join(retainedEvidence, 'incident.ips'), 'utf8')).toBe('evidence');
  });

  it('admits only marker-verified xcodebuildmcp roots under the RN build directory', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'vimicate-prune-build-contract-'));
    temporaryRoots.push(temporaryRoot);
    const mobileRoot = join(temporaryRoot, 'mobile');
    const derived = join(mobileRoot, 'build', 'xcodebuildmcp-old-release');
    const retained = join(mobileRoot, 'build', 'xcodebuildmcp-retained-evidence');
    mkdirSync(join(derived, 'Build', 'Products'), { recursive: true });
    writeFileSync(join(derived, 'info.plist'), 'generated');
    mkdirSync(retained, { recursive: true });
    writeFileSync(join(retained, 'report.ips'), 'evidence');
    writeFileSync(join(mobileRoot, 'package.json'), '{}');

    const output = execFileSync('/bin/bash', [resolve(process.cwd(), 'scripts/prune-rn-build-artifacts.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VIMICATE_RN_MOBILE_ROOT: mobileRoot,
        VIMICATE_RN_TEMP_DERIVED_ROOT: join(temporaryRoot, 'temporary-derived'),
        VIMICATE_XCODE_DERIVED_ROOT: join(temporaryRoot, 'ordinary-derived'),
        VIMICATE_XCODE_ARCHIVES_ROOT: join(temporaryRoot, 'archives'),
      },
    });

    expect(output).toContain('WOULD_REMOVE category=rn-build-xcode-derived');
    expect(output).toContain(`path=${derived}`);
    expect(output).not.toContain(retained);
    expect(readFileSync(join(retained, 'report.ips'), 'utf8')).toBe('evidence');
  });

  it('admits marked top-level xcodebuildmcp output without admitting runner source', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'vimicate-prune-top-level-contract-'));
    temporaryRoots.push(temporaryRoot);
    const mobileRoot = join(temporaryRoot, 'mobile');
    const derived = join(mobileRoot, '.xcodebuildmcp-new-release');
    const runnerSource = join(mobileRoot, '.xcodebuildmcp-physical-runner');
    mkdirSync(join(derived, 'Build', 'Products'), { recursive: true });
    writeFileSync(join(derived, 'info.plist'), 'generated');
    mkdirSync(runnerSource, { recursive: true });
    writeFileSync(join(runnerSource, 'project.pbxproj'), 'source');
    writeFileSync(join(mobileRoot, 'package.json'), '{}');

    const output = execFileSync('/bin/bash', [resolve(process.cwd(), 'scripts/prune-rn-build-artifacts.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VIMICATE_RN_MOBILE_ROOT: mobileRoot,
        VIMICATE_RN_TEMP_DERIVED_ROOT: join(temporaryRoot, 'temporary-derived'),
        VIMICATE_XCODE_DERIVED_ROOT: join(temporaryRoot, 'ordinary-derived'),
        VIMICATE_XCODE_ARCHIVES_ROOT: join(temporaryRoot, 'archives'),
      },
    });

    expect(output).toContain('WOULD_REMOVE category=rn-top-level-xcode-derived');
    expect(output).toContain(`path=${derived}`);
    expect(output).not.toContain(runnerSource);
    expect(readFileSync(join(runnerSource, 'project.pbxproj'), 'utf8')).toBe('source');
  });
});
