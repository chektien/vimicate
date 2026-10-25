import type { GatewayStatus } from '../gateway/OpenClawClient';
import type { ProviderQuotaPresentation } from '../gateway/providerQuota';
import type { PromptAttachment } from '../prompt/promptAttachments';
import type { AppUpdateNoticeController } from '../updates/useAppUpdateNotice';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import type { ProjectFilesFixture } from '../projectFiles/projectFilesTypes';

export const ATTACHMENT_GEOMETRY_SECOND_TICK = 39;

const stagedDesignReference: PromptAttachment = {
  id: 'fixture-staged-image',
  uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  filename: 'staged-design-reference.png',
  mimeType: 'image/png',
  byteCount: 68,
  kind: 'image',
};

const stagedReviewNotes: PromptAttachment = {
  ...stagedDesignReference,
  id: 'fixture-staged-review-notes',
  filename: 'staged-review-notes.png',
};

const oneStagedAttachment = [stagedDesignReference];
const twoStagedAttachments = [stagedDesignReference, stagedReviewNotes];

/** Explicit QA-only prompt data; ordinary launches never receive attachments. */
export function promptAttachmentGeometryFixture(fixtureMode: string | undefined, streamTick: number) {
  if (fixtureMode === 'interaction-polish') return oneStagedAttachment;
  if (fixtureMode !== 'prompt-attachment-geometry-transition') return undefined;
  return streamTick < ATTACHMENT_GEOMETRY_SECOND_TICK
    ? oneStagedAttachment
    : twoStagedAttachments;
}

export const attentionProjectRailFixture: { projects: WorkspaceProject[]; selectedKey: string } = {
  selectedKey: 'fixture-notes',
  projects: [
    {
      id: 'fixture-notes', sessionKey: 'fixture-notes', name: 'notes', path: '~/projects/example-notes', branch: 'root',
      starred: true, threadCount: 2, state: 'idle', group: 'home', updatedAt: Date.parse('2026-08-29T23:40:00+08:00'),
    },
    {
      id: 'fixture-emails', sessionKey: 'fixture-emails', name: 'emails', path: '~/projects/example-notes', branch: 'notes',
      kind: 'thread', rootSessionKey: 'fixture-notes', projectName: 'notes',
      starred: false, threadCount: 1, state: 'idle', group: 'home', unread: true, updatedAt: Date.parse('2026-08-29T23:41:00+08:00'),
    },
    {
      id: 'fixture-crons', sessionKey: 'fixture-crons', name: 'crons', path: '~/.openclaw', branch: 'root',
      starred: false, threadCount: 1, state: 'idle', group: 'operations', updatedAt: Date.parse('2026-08-29T23:39:00+08:00'),
    },
    {
      id: 'fixture-example-research', sessionKey: 'fixture-example-research', name: 'Example Research', path: '~/repos/example-research', branch: 'main',
      starred: false, threadCount: 2, state: 'idle', group: 'work', updatedAt: Date.parse('2026-08-29T23:38:00+08:00'),
    },
    {
      id: 'fixture-example-slides', sessionKey: 'fixture-example-slides', name: 'example slides', path: '~/repos/example-research', branch: 'main',
      kind: 'thread', rootSessionKey: 'fixture-example-research', projectName: 'Example Research',
      starred: false, threadCount: 1, state: 'idle', group: 'work', unread: true, updatedAt: Date.parse('2026-08-29T23:37:00+08:00'),
    },
  ],
};

export type AppShellFixtureProps = {
  fixtureMessages?: WorkspaceMessage[] | undefined;
  fixtureRunActive?: boolean;
  fixtureGatewayStatus?: GatewayStatus | undefined;
  fixtureProviderQuota?: ProviderQuotaPresentation | undefined;
  fixturePromptAttachments?: PromptAttachment[] | undefined;
  fixtureUpdateNotice?: AppUpdateNoticeController | undefined;
  fixtureProjectRailStartup?: { paired: boolean; registryReady: boolean } | undefined;
  fixtureProjectRail?: { projects: WorkspaceProject[]; selectedKey: string } | undefined;
  fixtureProjectFiles?: ProjectFilesFixture | undefined;
  fixtureOlderHistory?: {
    canLoadOlder: boolean;
    loadingOlder: boolean;
    historyProblem?: string | undefined;
    loadOlderHistory: () => unknown | Promise<unknown>;
  } | undefined;
};
