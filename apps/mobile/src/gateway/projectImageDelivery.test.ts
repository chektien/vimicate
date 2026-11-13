import { afterEach, expect, it, vi } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { decorateGatewayMedia } from './gatewayMedia';
import { cachedGatewayImageSource, invalidateGatewayImageSource } from '../transcript/gatewayImageSource';
import { createGatewayProjectImageResolver } from './gatewayProjectImage';
import type { ProjectFileContent } from './projectFiles';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

const key = 'agent:fixture:claims';
const path = 'repo@gateway/internal/claim%20proof.png';
afterEach(() => vi.unstubAllGlobals());

it('loads a named-host Markdown image through Files without inventing a workspace path or probing legacy media', async () => {
  const messages = messagesFromPayload({ messages: [{ role: 'assistant', text: `![Claim screenshot](${path})` }] }, '~/repos/course');
  const attachment = decorateGatewayMedia(messages, 'wss://gateway.example', 'fixture', key)[0]!.attachments![0]!;
  expect(attachment.uri).toBe('repo@gateway/internal/claim proof.png');
  expect(attachment.projectImageSessionKey).toBe(key);
  const read = vi.fn(async (projectId, path): Promise<ProjectFileContent> => ({ projectId, path, kind: 'image', mimeType: 'image/png', size: 4, mtimeMs: 0, dataBase64: 'iVBORw==' }));
  const project: WorkspaceProject = { id: 'course', sessionKey: key, name: 'Course', path: '~/repos/course', branch: 'main', starred: false, state: 'idle', threadCount: 0 };
  const resolver = createGatewayProjectImageResolver(read, () => [project], () => 'paired-fixture');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  try {
    expect(await cachedGatewayImageSource(attachment, undefined, resolver)).toEqual({ uri: 'data:image/png;base64,iVBORw==' });
    expect(read).toHaveBeenCalledWith('course', 'repo@gateway/internal/claim proof.png', expect.any(AbortSignal));
    expect(fetcher).not.toHaveBeenCalled();
  } finally { invalidateGatewayImageSource(attachment, resolver); }
});
