// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('project thread removal routing', () => {
  it('routes project-pane dd through the canonical close-thread command for the focused session', () => {
    const shell = source('../app/AppShell.tsx');
    const rail = source('../workspace/useProjectRailController.ts');
    const submission = source('../gateway/useGatewaySubmission.ts');

    expect(rail).toContain('if (result.removeKey) onRemove(result.removeKey);');
    expect(shell).toContain("gateway.submit(':close-thread', [], key)");
    expect(shell).toContain("setVimStatus('removing thread…')");
    expect(submission).toContain("} else if (typedCommand === ':close-thread') {");
    expect(shell).not.toContain('removeWorkspaceThread(');
    expect(rail).not.toContain('updateThreadRegistry');
  });
});
