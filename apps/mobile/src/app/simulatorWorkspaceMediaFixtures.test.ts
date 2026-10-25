import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides these test-only modules.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides these test-only modules.
import { resolve } from 'node:path';

import {
  SIMULATOR_WORKSPACE_MEDIA_APPROVAL_EXPIRY_TICK,
  SIMULATOR_WORKSPACE_MEDIA_DECODE_TICK,
  SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE,
  SIMULATOR_WORKSPACE_MEDIA_FOUR_PAGE_TICK,
  SIMULATOR_WORKSPACE_MEDIA_PROJECT_A_RETURN_TICK,
  SIMULATOR_WORKSPACE_MEDIA_PROJECT_B_TICK,
  SIMULATOR_WORKSPACE_MEDIA_READY_TICK,
  SIMULATOR_WORKSPACE_MEDIA_ROOT,
  SIMULATOR_WORKSPACE_MEDIA_SESSION_A,
  SIMULATOR_WORKSPACE_MEDIA_SESSION_B,
  simulatorWorkspaceMediaPhaseTicks,
  simulatorWorkspaceMediaMessages,
  simulatorWorkspaceMediaProjectRail,
  simulatorWorkspaceMediaStartup,
} from './simulatorWorkspaceMediaFixtures';
import { SessionPromptDraftMemory } from '../prompt/draftHydration';
import { assistantMediaRequest, gatewayLocalImagePath } from '../transcript/gatewayImageSource';

describe('isolated simulator workspace, approval and media fixture', () => {
  it('keeps the compiled QA mode within the native truncation boundary', () => {
    expect(SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE).toBe('qa-workmedia-v1');
    expect(SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE.length).toBeLessThanOrEqual(16);
  });

  it('maps every visible QA control to one exact payload milestone without a clock', () => {
    expect(simulatorWorkspaceMediaPhaseTicks).toEqual({
      loading: 0,
      ready: SIMULATOR_WORKSPACE_MEDIA_READY_TICK,
      decode: SIMULATOR_WORKSPACE_MEDIA_DECODE_TICK,
      expiry: SIMULATOR_WORKSPACE_MEDIA_APPROVAL_EXPIRY_TICK,
      beta: SIMULATOR_WORKSPACE_MEDIA_PROJECT_B_TICK,
      'four-page': SIMULATOR_WORKSPACE_MEDIA_FOUR_PAGE_TICK,
      'alpha-return': SIMULATOR_WORKSPACE_MEDIA_PROJECT_A_RETURN_TICK,
    });
    const wrapper = readFileSync(resolve(process.cwd(), 'src/app/simulatorWorkspaceMediaFixtureApp.tsx'), 'utf8');
    for (const label of ['QA phase ready', 'QA phase decode', 'QA phase expiry', 'QA phase beta', 'QA phase four page', 'QA phase alpha return']) {
      expect(wrapper).toContain(label);
    }
    expect(wrapper).toContain("edges={['top']}");
    expect(wrapper.indexOf('<SafeAreaView')).toBeLessThan(wrapper.indexOf('<AppShell'));
    expect(wrapper).not.toMatch(/setInterval|setTimeout/);
  });

  it('moves from authoritative startup loading to A/B/A without deleted or control-session rows', () => {
    expect([SIMULATOR_WORKSPACE_MEDIA_SESSION_A, SIMULATOR_WORKSPACE_MEDIA_SESSION_B]).toEqual([
      'fixture-workspace-media-a', 'fixture-workspace-media-b',
    ]);
    expect(simulatorWorkspaceMediaStartup(SIMULATOR_WORKSPACE_MEDIA_READY_TICK - 1)).toEqual({ paired: true, registryReady: false });
    expect(simulatorWorkspaceMediaProjectRail(SIMULATOR_WORKSPACE_MEDIA_READY_TICK - 1)).toBeUndefined();
    const alpha = simulatorWorkspaceMediaProjectRail(SIMULATOR_WORKSPACE_MEDIA_READY_TICK)!;
    const beta = simulatorWorkspaceMediaProjectRail(SIMULATOR_WORKSPACE_MEDIA_PROJECT_B_TICK)!;
    const returned = simulatorWorkspaceMediaProjectRail(SIMULATOR_WORKSPACE_MEDIA_PROJECT_A_RETURN_TICK)!;
    expect(alpha.projects.map((project) => project.name)).toEqual(['fixture alpha', 'fixture beta']);
    expect(alpha.projects.every((project) => !/deleted|control/i.test(project.name))).toBe(true);
    expect([alpha.selectedKey, beta.selectedKey, returned.selectedKey]).toEqual([
      'fixture-workspace-media-a', 'fixture-workspace-media-b', 'fixture-workspace-media-a',
    ]);
  });

  it('uses the production draft owner for exact A/B/A restoration and explicit per-project cleanup', () => {
    const memory = new SessionPromptDraftMemory();
    expect(memory.enter('fixture-workspace-media-a', '', false)).toMatchObject({ text: '', source: 'empty' });
    memory.remember('fixture-workspace-media-a', 'AQ');
    expect(memory.enter('fixture-workspace-media-b', 'AQ', true)).toMatchObject({ text: '', source: 'empty' });
    memory.remember('fixture-workspace-media-b', 'BQ');
    memory.remember('fixture-workspace-media-b', '');
    expect(memory.enter('fixture-workspace-media-a', '', true)).toMatchObject({ text: 'AQ', source: 'memory' });

    memory.remember('fixture-workspace-media-a', '');
    expect(memory.enter('fixture-workspace-media-b', '', true)).toMatchObject({ text: '', source: 'memory' });
    expect(memory.enter('fixture-workspace-media-a', '', true)).toMatchObject({ text: '', source: 'memory' });
  });

  it('derives later expiry through the production approval reconciler and preserves the newer row', () => {
    const pending = simulatorWorkspaceMediaMessages(SIMULATOR_WORKSPACE_MEDIA_APPROVAL_EXPIRY_TICK - 1)!;
    const expired = simulatorWorkspaceMediaMessages(SIMULATOR_WORKSPACE_MEDIA_APPROVAL_EXPIRY_TICK)!;
    expect(pending[0]).toMatchObject({ approval: { resolved: false, allowedDecisions: ['allow-once', 'deny'] } });
    expect(expired[0]).toMatchObject({
      text: 'approval expired · run outcome unconfirmed', state: 'error',
      approval: { resolved: true, outcome: 'expired', allowedDecisions: [] },
    });
    expect(expired[1]).toMatchObject({ id: 'simwm-later-row', text: expect.stringContaining('SIMWM-LATER-LIVE-ROW') });
  });

  it('replaces an obsolete failed source and then exposes one authoritative four-page snapshot', () => {
    const failed = simulatorWorkspaceMediaMessages(SIMULATOR_WORKSPACE_MEDIA_DECODE_TICK - 1)![3]!;
    const recovered = simulatorWorkspaceMediaMessages(SIMULATOR_WORKSPACE_MEDIA_DECODE_TICK)![3]!;
    const four = simulatorWorkspaceMediaMessages(SIMULATOR_WORKSPACE_MEDIA_FOUR_PAGE_TICK)![3]!;
    expect(failed.attachments).toEqual([expect.objectContaining({ id: 'dynamic-current', filename: 'obsolete-attempt.png' })]);
    expect(failed.attachments?.[0]?.uri).toBe('file:///simulator-vimicate-fixture/does-not-exist/obsolete-attempt.png');
    // The native test now taps Retry. Keep this fixture outside the Gateway,
    // media-ticket and Files-folder authorization paths.
    const retryAttachment = failed.attachments![0]!;
    expect(assistantMediaRequest(retryAttachment)).toBeNull();
    expect(gatewayLocalImagePath(retryAttachment)).toBe('');
    expect(retryAttachment.artifactId).toBeUndefined();
    expect(retryAttachment.headers).toBeUndefined();
    expect(retryAttachment.uri).not.toContain('mediaTicket=');
    expect(recovered.attachments).toEqual([expect.objectContaining({ id: 'dynamic-current', filename: 'managed-remount.png' })]);
    expect(four.attachments?.map((attachment) => attachment.filename)).toEqual([
      'managed-remount.png', 'media-page-2.png', 'media-page-3.png', 'media-page-4.png',
    ]);
    expect(four.attachments?.every((attachment) => attachment.uri?.startsWith('data:image/png;base64,'))).toBe(true);
    expect(four.attachments?.some((attachment) => attachment.filename === 'obsolete-attempt.png')).toBe(false);
  });


});
