import { reconcileApprovalAbsence } from '../gateway/approvalFinalization';
import type { WorkspaceAttachment, WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';

export const SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE = 'qa-workmedia-v1';
export const SIMULATOR_WORKSPACE_MEDIA_READY_TICK = 40;
export const SIMULATOR_WORKSPACE_MEDIA_DECODE_TICK = 80;
export const SIMULATOR_WORKSPACE_MEDIA_APPROVAL_EXPIRY_TICK = 120;
export const SIMULATOR_WORKSPACE_MEDIA_PROJECT_B_TICK = 140;
export const SIMULATOR_WORKSPACE_MEDIA_FOUR_PAGE_TICK = 170;
export const SIMULATOR_WORKSPACE_MEDIA_PROJECT_A_RETURN_TICK = 220;

export type SimulatorWorkspaceMediaPhase = 'loading' | 'ready' | 'decode' | 'expiry' | 'beta' | 'four-page' | 'alpha-return';

export const simulatorWorkspaceMediaPhaseTicks: Record<SimulatorWorkspaceMediaPhase, number> = {
  loading: 0,
  ready: SIMULATOR_WORKSPACE_MEDIA_READY_TICK,
  decode: SIMULATOR_WORKSPACE_MEDIA_DECODE_TICK,
  expiry: SIMULATOR_WORKSPACE_MEDIA_APPROVAL_EXPIRY_TICK,
  beta: SIMULATOR_WORKSPACE_MEDIA_PROJECT_B_TICK,
  'four-page': SIMULATOR_WORKSPACE_MEDIA_FOUR_PAGE_TICK,
  'alpha-return': SIMULATOR_WORKSPACE_MEDIA_PROJECT_A_RETURN_TICK,
};

export const SIMULATOR_WORKSPACE_MEDIA_ROOT = 'SIMWM-FIXTURE-ROOT';
export const SIMULATOR_WORKSPACE_MEDIA_APPROVAL = 'SIMWM-APPROVAL-PENDING';
export const SIMULATOR_WORKSPACE_MEDIA_LATER_ROW = 'SIMWM-LATER-LIVE-ROW';
export const SIMULATOR_WORKSPACE_MEDIA_RETAINED = 'SIMWM-RETAINED-MEDIA';
export const SIMULATOR_WORKSPACE_MEDIA_DYNAMIC = 'SIMWM-DYNAMIC-MEDIA';

export const SIMULATOR_WORKSPACE_MEDIA_SESSION_A = 'fixture-workspace-media-a';
export const SIMULATOR_WORKSPACE_MEDIA_SESSION_B = 'fixture-workspace-media-b';
const SESSION_A = SIMULATOR_WORKSPACE_MEDIA_SESSION_A;
const SESSION_B = SIMULATOR_WORKSPACE_MEDIA_SESSION_B;
const RUN = 'fixture-workspace-media-run';
const VALID_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const MISSING_IMAGE_URI = 'file:///simulator-vimicate-fixture/does-not-exist/obsolete-attempt.png';

const projects: WorkspaceProject[] = [
  {
    id: SESSION_A, sessionKey: SESSION_A, name: 'fixture alpha', path: '/fixture/alpha', branch: 'main',
    starred: true, threadCount: 1, state: 'idle', group: 'home',
  },
  {
    id: SESSION_B, sessionKey: SESSION_B, name: 'fixture beta', path: '/fixture/beta', branch: 'main',
    starred: false, threadCount: 1, state: 'idle', group: 'home',
  },
];

export function simulatorWorkspaceMediaStartup(streamTick: number) {
  return { paired: true, registryReady: streamTick >= SIMULATOR_WORKSPACE_MEDIA_READY_TICK };
}

/** Deleted/control candidates are deliberately absent from this authoritative snapshot. */
export function simulatorWorkspaceMediaProjectRail(streamTick: number) {
  if (streamTick < SIMULATOR_WORKSPACE_MEDIA_READY_TICK) return undefined;
  const selectedKey = streamTick < SIMULATOR_WORKSPACE_MEDIA_PROJECT_B_TICK
    || streamTick >= SIMULATOR_WORKSPACE_MEDIA_PROJECT_A_RETURN_TICK
    ? SESSION_A
    : SESSION_B;
  return { projects, selectedKey };
}

export function simulatorWorkspaceMediaMessages(streamTick: number): WorkspaceMessage[] | undefined {
  if (streamTick < SIMULATOR_WORKSPACE_MEDIA_READY_TICK) return undefined;
  const expiresAtMs = Date.now() + 60_000;
  const approval: WorkspaceMessage = {
    id: 'simwm-approval', role: 'approval', text: `${SIMULATOR_WORKSPACE_MEDIA_APPROVAL}: allow the synthetic command?`,
    source: 'history', state: 'streaming', sessionKey: SESSION_A, runId: RUN,
    timestamp: '2026-09-19T12:00:00+08:00',
    approval: {
      id: 'simwm-approval-id', kind: 'exec', allowedDecisions: ['allow-once', 'deny'],
      resolved: false, expiresAtMs,
    },
  };
  const later: WorkspaceMessage = {
    id: 'simwm-later-row', role: 'assistant', text: `${SIMULATOR_WORKSPACE_MEDIA_LATER_ROW}: newer ownership remains visible.`,
    source: 'live', state: 'complete', sessionKey: SESSION_A, runId: 'simwm-newer-run',
    timestamp: '2026-09-19T12:00:01+08:00',
  };
  const approvalRows = streamTick < SIMULATOR_WORKSPACE_MEDIA_APPROVAL_EXPIRY_TICK
    ? [approval, later]
    : reconcileApprovalAbsence([approval, later], [], SESSION_A, expiresAtMs + 1).messages;

  return [
    ...approvalRows,
    {
      id: 'simwm-retained-media', role: 'assistant', text: `${SIMULATOR_WORKSPACE_MEDIA_RETAINED}: stable across viewer dismissal and app remount.`,
      source: 'history', state: 'complete', sessionKey: SESSION_A,
      timestamp: '2026-09-19T12:00:02+08:00', attachments: [image('retained-media', 'retained-remount.png')],
    },
    {
      id: 'simwm-dynamic-media', role: 'assistant',
      text: `${SIMULATOR_WORKSPACE_MEDIA_DYNAMIC}: ${mediaPhase(streamTick)}.`,
      source: 'history', state: 'complete', sessionKey: SESSION_A,
      timestamp: '2026-09-19T12:00:03+08:00', attachments: dynamicAttachments(streamTick),
    },
    {
      id: 'simwm-root', role: 'assistant', text: `${SIMULATOR_WORKSPACE_MEDIA_ROOT}: offline workspace/media fixture ready.`,
      source: 'history', state: 'complete', sessionKey: SESSION_A,
      timestamp: '2026-09-19T12:00:04+08:00',
    },
  ];
}

function dynamicAttachments(streamTick: number): WorkspaceAttachment[] {
  if (streamTick < SIMULATOR_WORKSPACE_MEDIA_DECODE_TICK) {
    return [image('dynamic-current', 'obsolete-attempt.png', MISSING_IMAGE_URI)];
  }
  const current = image('dynamic-current', 'managed-remount.png');
  if (streamTick < SIMULATOR_WORKSPACE_MEDIA_FOUR_PAGE_TICK) return [current];
  return [
    current,
    image('dynamic-page-2', 'media-page-2.png'),
    image('dynamic-page-3', 'media-page-3.png'),
    image('dynamic-page-4', 'media-page-4.png'),
  ];
}

function mediaPhase(streamTick: number) {
  if (streamTick < SIMULATOR_WORKSPACE_MEDIA_DECODE_TICK) return 'obsolete source must fail honestly';
  if (streamTick < SIMULATOR_WORKSPACE_MEDIA_FOUR_PAGE_TICK) return 'authoritative source replaced obsolete attempt';
  return 'authoritative four-page snapshot ready';
}

function image(id: string, filename: string, uri = VALID_PIXEL): WorkspaceAttachment {
  return { id, filename, uri, mimeType: 'image/png', byteCount: 68, pixelWidth: 1, pixelHeight: 1 };
}
