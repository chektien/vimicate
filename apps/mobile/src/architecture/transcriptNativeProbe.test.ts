import { describe, expect, it } from 'vitest';
// @ts-expect-error Node runtime is available only to this test.
import { readFileSync } from 'node:fs';

describe('isolated native transcript review probe', () => {
  it('audits every pagination frame, including loading and variable-height history, without live data', () => {
    const probe = readFileSync(new URL('../../scripts/fixtures/TranscriptPaginationFrameProbe.tsx', import.meta.url), 'utf8');
    const entry = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
    expect(probe).toContain('requestAnimationFrame(sample)');
    expect(probe).toContain('Variable-height history');
    expect(probe).toContain('pagination-frame.complete');
    expect(probe).toContain('maxDrift <= 0.004');
    expect(probe).not.toMatch(/OpenClawClient|useGatewayWorkspace|fetch\(|WebSocket|setInterval\(/);
    expect(entry).not.toContain('TranscriptPaginationFrameProbe');
  });
  it('keeps the deliberate layout feedback calibration outside production entry points', () => {
    const probe = readFileSync(new URL('../../scripts/fixtures/TranscriptLayoutBurstProbe.tsx', import.meta.url), 'utf8');
    const entry = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(probe).toContain('useTranscriptLayoutDiagnostics(');
    expect(probe).toContain('publications.current < 12');
    expect(probe).toContain('cellLayouts.current < 12');
    expect(probe).not.toMatch(/OpenClawClient|useGatewayWorkspace|fetch\(|WebSocket|setInterval\(/);
    expect(entry + app).not.toContain('TranscriptLayoutBurstProbe');
  });
  it('keeps the lane-overlap crash regression isolated from production and the Gateway', () => {
    const probe = readFileSync(new URL('../../scripts/fixtures/TranscriptNavigationCommitProbe.tsx', import.meta.url), 'utf8');
    const entry = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(probe).toContain('startTransition(() => setMessages(');
    expect(probe).toContain('useSessionTranscriptNavigation(');
    expect(probe).toContain('navigation-cycle.complete');
    expect(probe).not.toMatch(/OpenClawClient|useGatewayWorkspace|fetch\(|WebSocket|setInterval\(/);
    expect(entry + app).not.toContain('TranscriptNavigationCommitProbe');
  });
  it('composes production owners only behind the explicit offline QA fixture selector', () => {
    const probe = readFileSync(new URL('../../scripts/fixtures/TranscriptSessionReviewProbe.tsx', import.meta.url), 'utf8');
    const entry = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(probe).toContain("from '../../src/transcript/TranscriptPane'");
    expect(probe).toContain('useSessionTranscriptNavigation(');
    expect(probe).toContain('owner.captureCurrentSession(); setSession(next)');
    expect(probe).toContain('onViewportReview={owner.onViewportReview}');
    expect(probe).not.toMatch(/OpenClawClient|useGatewayWorkspace|fetch\(|WebSocket|setInterval\(/);
    expect(entry).not.toContain('TranscriptSessionReviewProbe');
    expect(app).toContain('isSimulatorReviewFixtureMode(fixtureMode) ? <TranscriptSessionReviewProbe />');
    expect(probe).toContain("mode === 'qa-review-v1'");
    expect(probe).toContain("useMemo(() => ({ A: makeRows('A'), B: makeRows('B') }), [])");
  });

});
