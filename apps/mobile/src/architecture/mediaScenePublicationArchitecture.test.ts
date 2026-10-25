import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../gateway/useGatewayWorkspace.ts', import.meta.url), 'utf8');
const image = readFileSync(new URL('../transcript/GatewayImage.tsx', import.meta.url), 'utf8');
const owner = readFileSync(new URL('../transcript/useGatewayImage.ts', import.meta.url), 'utf8');

describe('media scene publication architecture', () => {
  it('synchronizes the one media authority at the existing app lifecycle owner', () => {
    expect(workspace).toContain('mediaScenePublicationAuthority.resume()');
    expect(workspace).toContain('mediaScenePublicationAuthority.suspend()');
    const suspension = workspace.slice(workspace.indexOf("if (action === 'suspend')"), workspace.indexOf("} else if (action === 'resume')"));
    const resume = workspace.slice(workspace.indexOf("} else if (action === 'resume')"), workspace.indexOf("} else if (appActive.current)"));
    expect(suspension).toContain('mediaScenePublicationAuthority.suspend()');
    expect(resume).toContain('mediaScenePublicationAuthority.resume()');
  });

  it('uses one request owner for resolution, native decode and commit-time publication', () => {
    expect(image).toContain('useGatewayImage(attachment)');
    expect(image).toContain('key={imageKey}');
    expect(owner).toContain('scene.capture()');
    expect(owner).toContain('scene.subscribeResume');
    expect(owner).toContain('setState(previous => publishable(pending)');
    expect(owner).toContain('previous.request === decodedRequest && publishable(decodedRequest)');
    expect(owner).not.toContain('retryAfterResume');
    expect(owner).not.toContain('acceptedSourceRevision');
    expect(image).not.toContain('useState');
    expect(image).not.toContain("onLoad={() => setPhase('decoded')}");
    expect(image).not.toContain("if (active) { recordGatewayDiagnostic");
  });
});
