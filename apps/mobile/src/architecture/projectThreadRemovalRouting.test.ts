// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('project thread removal routing', () => {
  it('routes project-pane dd through the canonical close-thread or remove-project command for the focused session', () => {
    const shell = source('../app/AppShell.tsx');
    const rail = source('../workspace/useProjectRailController.ts');
    const removal = source('../workspace/railRemoval.ts');
    const submission = source('../gateway/useGatewaySubmission.ts');

    expect(rail).toContain('if (result.removeKey) onRemove(result.removeKey);');
    expect(shell).toContain('removeFromRail(railStartup.projects, key, gateway.submit, setVimStatus)');
    expect(removal).toContain('await submit(railRemovalCommand(target), [], key)');
    expect(submission).toContain("} else if (railCommand) { // :close-thread or :remove-project");
    expect(submission).toContain("typedCommand === ':close-thread' ? closeWorkspaceThread : removeWorkspaceProject");
    expect(shell).not.toContain('removeWorkspaceThread(');
    expect(rail).not.toContain('updateThreadRegistry');
  });
});
