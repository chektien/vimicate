import { expect, it, vi } from 'vitest';
import { createGatewayProjectImageResolver } from './gatewayProjectImage';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import type { ProjectFileContent } from './projectFiles';
import { cachedGatewayImageSource, invalidateGatewayImageSource } from '../transcript/gatewayImageSource';

const path = 'repo@work-mac/proof.png';
const root: WorkspaceProject = { id: 'course', sessionKey: 'root', name: 'Course', path: '~/repos/course', branch: 'main', starred: false, state: 'idle', threadCount: 1 };
const thread: WorkspaceProject = { ...root, id: 'thread', sessionKey: 'claims', kind: 'thread', rootSessionKey: 'root', sessionId: 'generation-one' };
const image = (projectId = 'course', filePath = path): ProjectFileContent => ({ projectId, path: filePath, kind: 'image', mimeType: 'image/png', size: 4, mtimeMs: 0, dataBase64: 'iVBORw==' });
const signal = () => new AbortController().signal;

it('binds a registered thread to its owning project while preserving the exact host', async () => {
  const read = vi.fn(async () => image());
  const resolver = createGatewayProjectImageResolver(read, () => [root, thread], () => 'connection');
  expect(await resolver(path, 'claims').load(signal())).toEqual({ uri: 'data:image/png;base64,iVBORw==' });
  expect(read).toHaveBeenCalledWith('course', path, expect.any(AbortSignal));
});

it.each(['unknown', ''])('refuses absent origin %s without a selected-project fallback', key => {
  const read = vi.fn();
  const resolver = createGatewayProjectImageResolver(read, () => [root, thread], () => 'connection');
  expect(() => resolver(path, key)).toThrow(); expect(read).not.toHaveBeenCalled();
});

it.each(['repo@work-mac/../proof.png', 'repo@work-mac/./proof.png', 'repo@work-mac//proof.png',
  'repo@work-mac/proof.png?other=1', 'repo@work-mac/proof.png#part', 'repo@work-mac/proof\\other.png'])('rejects malformed named-root input %s', bad => {
  const read = vi.fn();
  const resolver = createGatewayProjectImageResolver(read, () => [root], () => 'connection');
  expect(() => resolver(bad, 'root')).toThrow(); expect(read).not.toHaveBeenCalled();
});

it('does not dispatch queued demand after its captured connection or project retires', async () => {
  const read = vi.fn(async () => image()); let connection = 'one';
  const resolver = createGatewayProjectImageResolver(read, () => [root, thread], () => connection);
  const pending = resolver(path, 'claims'); connection = 'two';
  await expect(pending.load(signal())).rejects.toThrow('retired'); expect(read).not.toHaveBeenCalled();
});

it('rejects replies after reparenting, concrete generation reset, cancellation or connection replacement', async () => {
  for (const change of ['project', 'session', 'cancel', 'connection']) {
    let projects = [root, thread], connection = 'one';
    let finish!: (content: ProjectFileContent) => void;
    const read = vi.fn(() => new Promise<ProjectFileContent>(done => { finish = done; }));
    const resolver = createGatewayProjectImageResolver(read, () => projects, () => connection);
    const controller = new AbortController(); const pending = resolver(path, 'claims').load(controller.signal);
    if (change === 'project') projects = [root, { ...thread, rootSessionKey: 'missing' }];
    if (change === 'session') projects = [root, { ...thread, sessionId: 'generation-two' }];
    if (change === 'cancel') controller.abort();
    if (change === 'connection') connection = 'two';
    finish(image()); await expect(pending).rejects.toThrow();
  }
});

it.each([image('another'), image('course', 'repo@gateway/proof.png'),
  { ...image(), kind: 'text', mimeType: 'text/plain', text: 'not an image' }])('rejects unrelated or non-image payloads %#', async value => {
  const resolver = createGatewayProjectImageResolver(async () => value as ProjectFileContent, () => [root], () => 'connection');
  await expect(resolver(path, 'root').load(signal())).rejects.toThrow('response');
});

it('revalidates ready-cache authority on connection, project and session changes, and retry invalidates it', async () => {
  let projects = [root, thread], connection = 'cache-one';
  const read = vi.fn(async (id: string) => image(id));
  const resolver = createGatewayProjectImageResolver(read, () => projects, () => connection);
  const attachment = { id: 'image', filename: 'proof', mimeType: 'image/png', uri: path, projectImageSessionKey: 'claims' };
  for (let step = 0; step < 4; step += 1) {
    expect((await cachedGatewayImageSource(attachment, undefined, resolver)).uri).toContain('data:image/png');
    expect((await cachedGatewayImageSource(attachment, undefined, resolver)).uri).toContain('data:image/png');
    expect(read).toHaveBeenCalledTimes(step + 1);
    if (step === 0) connection = 'cache-two';
    if (step === 1) projects = [root, { ...thread, sessionId: 'generation-two' }];
    if (step === 2) projects = [{ ...root, id: 'new-project' }, { ...thread, sessionId: 'generation-two' }];
  }
  invalidateGatewayImageSource(attachment, resolver);
  await cachedGatewayImageSource(attachment, undefined, resolver); expect(read).toHaveBeenCalledTimes(5);
  projects = [];
  expect((await cachedGatewayImageSource(attachment, undefined, resolver)).uri).toBe(''); expect(read).toHaveBeenCalledTimes(5);
});
