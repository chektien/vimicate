// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iOS persistence activity ownership', () => {
  it('protects only the duration of a serialized write with a finite iOS background task', () => {
    const swift = source(
      'modules/vimicate-persistence-activity/ios/VimicatePersistenceActivityModule.swift',
    );
    const bridge = source(
      'modules/vimicate-persistence-activity/src/VimicatePersistenceActivityModule.ts',
    );
    const queue = source('src/storage/workspacePersistenceQueue.ts');
    const store = source('src/storage/workspaceStore.ts');
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const startup = source('src/gateway/useGatewayPersistedStartup.ts');

    expect(swift).toContain('UIApplication.shared.beginBackgroundTask');
    expect(swift).toContain('UIApplication.shared.endBackgroundTask');
    expect(swift).toContain('AsyncFunction("beginPersistenceWrite")');
    expect(swift).toContain('AsyncFunction("endPersistenceWrite")');
    expect(swift.match(/\.runOnQueue\(\.main\)/g)).toHaveLength(2);
    expect(swift).toContain('Self.endLeaseOnMain(token)');
    expect(swift).not.toContain('DispatchQueue.main.sync');
    expect(swift).not.toContain('beginReceivingRemoteControlEvents');
    expect(bridge).toContain('await nativeModule?.beginPersistenceWrite()');
    expect(bridge).toContain('finally');
    expect(bridge).toContain('await nativeModule?.endPersistenceWrite(token)');
    expect(queue).toContain('await this.runWithActivity(write.task)');
    expect(queue).toContain('barrier()');
    expect(store).toContain('new WorkspacePersistenceQueue(withPersistenceActivity');
    expect(store).toContain("persistence.enqueue('database:init'");
    expect(store).toContain('new WorkspacePersistenceQueue(withPersistenceActivity, false)');
    expect(store).toContain('const ready = openWorkspaceDatabase();');
    expect(store).toContain('return persistence.enqueue(key, async () => task(await ready));');
    expect(store).toContain('await persistence.barrier();');
    expect(workspace).toContain('setWorkspacePersistenceActive(appActive.current)');
    expect(startup).toContain('!pending.current || !canPublish()');
  });
});
