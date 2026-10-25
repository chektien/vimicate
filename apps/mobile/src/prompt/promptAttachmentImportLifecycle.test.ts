import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromByteArray } from 'base64-js';

// Deterministic hook scheduling, not a native picker or physical UI test.
const harness = vi.hoisted(() => {
  type Slot = { value: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | undefined };
  const slots: Slot[] = [];
  let cursor = 0; let dirty = false; let effects: (() => void)[] = [];
  const slot = (initial: unknown) => slots[cursor++] ?? (slots[cursor - 1] = { value: initial });
  const effect = (run: () => void | (() => void), deps: readonly unknown[]) => {
    const current = slot(undefined);
    if (current.deps && deps.length === current.deps.length && deps.every((dep, i) => Object.is(dep, current.deps![i]))) return;
    current.deps = deps;
    effects.push(() => { current.cleanup?.(); current.cleanup = run() || undefined; });
  };
  return {
    react: {
      useRef: (value: unknown) => slot({ current: value }).value,
      useState: (initial: unknown) => {
        const current = slot(initial);
        return [current.value, (next: unknown) => {
          const value = typeof next === 'function' ? next(current.value) : next;
          if (!Object.is(current.value, value)) { current.value = value; dirty = true; }
        }];
      },
      useCallback: (callback: unknown) => { slot(undefined); return callback; },
      useEffect: effect,
      useLayoutEffect: effect,
    },
    render<T>(body: () => T): T {
      let value: T;
      let renders = 0;
      do {
        cursor = 0; dirty = false; value = body();
        const pending = effects; effects = []; pending.forEach((run) => run());
        if (++renders > 10) throw new Error('hook did not settle');
      } while (dirty);
      return value;
    },
    unmount: () => slots.forEach((current) => current.cleanup?.()),
    reset: () => { slots.length = 0; cursor = 0; dirty = false; effects = []; },
  };
});
const pickers = vi.hoisted(() => ({ document: vi.fn(), image: vi.fn(), optimize: vi.fn(), readDrop: vi.fn(), discardDrop: vi.fn().mockResolvedValue(undefined), releaseDroppedFile: vi.fn().mockResolvedValue(undefined) }));
const appState = vi.hoisted(() => ({ current: 'active', listeners: new Set<(next: string) => void>() }));
vi.mock('react', () => harness.react);
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return appState.current; },
  addEventListener: (_: string, listener: (next: string) => void) => {
    appState.listeners.add(listener);
    return { remove: () => appState.listeners.delete(listener) };
  },
} }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: pickers.document }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: pickers.image }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'picked-file' }));
vi.mock('../../modules/vimicate-editor', () => ({ default: { prepareImageUploadCopy: pickers.optimize, readDrop: pickers.readDrop, discardDrop: pickers.discardDrop, releaseDroppedFile: pickers.releaseDroppedFile } }));
const fileReads = vi.hoisted(() => ({ info: vi.fn(), base64: vi.fn() }));
vi.mock('expo-file-system/legacy', () => ({ EncodingType: { Base64: 'base64' }, getInfoAsync: fileReads.info, readAsStringAsync: fileReads.base64 }));

import { usePromptAttachmentController } from './usePromptAttachmentController';

const asset = { uri: 'file:///picked.txt', name: 'picked.txt', mimeType: 'text/plain', size: 1 };
function deferredPicker() {
  let resolve!: (result: { canceled: boolean; assets: typeof asset[] }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ canceled: boolean; assets: typeof asset[] }>((done, fail) => { resolve = done; reject = fail; });
  pickers.document.mockReturnValue(promise);
  return { resolve, reject, promise };
}

describe('prompt attachment import lifetime', () => {
  beforeEach(() => { harness.reset(); vi.clearAllMocks(); appState.current = 'active'; appState.listeners.clear();
    fileReads.info.mockImplementation(async (uri: string) => ({ exists: true, isDirectory: false, size: uri.includes('large') ? 7 * 1024 * 1024 : 1 }));
    fileReads.base64.mockImplementation(async (uri: string) => uri.includes('large') ? fromByteArray(new Uint8Array(7 * 1024 * 1024)) : 'QQ==');
  });
  const transition = (next: string) => { appState.current = next; for (const listener of appState.listeners) listener(next); };

  it('ends the reading footer after successful payload preparation without removing the draft attachment', async () => {
    const status = vi.fn(); const render = () => harness.render(() => usePromptAttachmentController('a', status));
    render().stagePastedAttachment({ uri: 'file:///small.png', filename: 'small.png', byteCount: 1 });
    status.mockClear();
    await expect(render().payloads()).resolves.toHaveLength(1);
    expect(status.mock.calls.map(([value]) => value)).toEqual(['reading attachments…', '']);
    expect(render().attachments).toHaveLength(1);
    expect(fileReads.info).toHaveBeenCalledExactlyOnceWith('file:///small.png');
    expect(fileReads.base64).toHaveBeenCalledExactlyOnceWith('file:///small.png', { encoding: 'base64', position: 0, length: 18 * 1024 * 1024 + 1 });
  });

  it('cancels a pending ordinary native file read and ignores its stale result after retry', async () => {
    const status = vi.fn(); const render = () => harness.render(() => usePromptAttachmentController('a', status));
    render().stagePastedAttachment({ uri: 'file:///small.pdf', filename: 'small.pdf', byteCount: 1 });
    let lateResolve!: (value: string) => void;
    fileReads.base64.mockImplementationOnce(() => new Promise<string>((resolve) => { lateResolve = resolve; }));
    const first = render().payloads();
    await vi.waitFor(() => expect(fileReads.base64).toHaveBeenCalledOnce());
    await expect(render().payloads()).rejects.toThrow('Still reading attachments');
    transition('inactive');
    await expect(first).rejects.toThrow('retry Send');
    expect(render().attachments).toHaveLength(1);
    transition('active');
    await expect(render().payloads()).resolves.toMatchObject([{ byteCount: 1 }]);
    const statusCount = status.mock.calls.length;
    lateResolve('AQID'); await Promise.resolve(); await Promise.resolve();
    expect(status).toHaveBeenCalledTimes(statusCount);
    expect(pickers.optimize).not.toHaveBeenCalled();
    expect(render().attachments).toHaveLength(1);
  });

  it('does not publish or optimize a late ordinary read after unmount', async () => {
    const status = vi.fn(); const render = () => harness.render(() => usePromptAttachmentController('a', status));
    render().stagePastedAttachment({ uri: 'file:///large.png', filename: 'large.png', byteCount: 7 * 1024 * 1024 });
    let lateResolve!: (value: string) => void;
    fileReads.base64.mockImplementationOnce(() => new Promise<string>((resolve) => { lateResolve = resolve; }));
    const pending = render().payloads();
    await vi.waitFor(() => expect(fileReads.base64).toHaveBeenCalledOnce());
    harness.unmount(); const statusCount = status.mock.calls.length;
    await expect(pending).rejects.toThrow('retry Send');
    lateResolve(fromByteArray(new Uint8Array(7 * 1024 * 1024)));
    await Promise.resolve(); await Promise.resolve();
    expect(status).toHaveBeenCalledTimes(statusCount);
    expect(pickers.optimize).not.toHaveBeenCalled();
  });

  it('settles suspended image preparation, retains the staged image, and ignores its late native result after retry', async () => {
    const status = vi.fn(); const render = () => harness.render(() => usePromptAttachmentController('a', status));
    render().stagePastedAttachment({ uri: 'file:///large.png', filename: 'large.png', byteCount: 7 * 1024 * 1024 });
    let lateResolve!: (value: { dataBase64: string; byteCount: number; mimeType: string }) => void;
    pickers.optimize.mockImplementationOnce(() => new Promise((resolve) => { lateResolve = resolve; }));
    const first = render().payloads();
    await vi.waitFor(() => expect(pickers.optimize).toHaveBeenCalledTimes(1));
    transition('inactive'); transition('background');
    await expect(first).rejects.toThrow('retry Send');
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('retry Send'));
    expect(render().attachments).toHaveLength(1);
    transition('active');
    pickers.optimize.mockResolvedValue({ dataBase64: 'AQID', byteCount: 3, mimeType: 'image/jpeg' });
    const second = render().payloads();
    await expect(second).resolves.toMatchObject([{ filename: 'large.upload.jpg' }]);
    const afterRetry = status.mock.calls.length;
    lateResolve({ dataBase64: 'AQID', byteCount: 3, mimeType: 'image/jpeg' });
    await Promise.resolve(); await Promise.resolve();
    expect(status).toHaveBeenCalledTimes(afterRetry);
    expect(render().attachments).toHaveLength(1);
  });

  it('does not cancel a system picker merely because its native UI deactivates the app', async () => {
    const picker = deferredPicker(); const render = () => harness.render(() => usePromptAttachmentController('a', vi.fn()));
    const work = render().pickDocument(); transition('inactive'); transition('active');
    picker.resolve({ canceled: false, assets: [asset] }); await work;
    expect(render()).toMatchObject({ importing: false, attachments: [{ filename: 'picked.txt' }] });
  });

  it('rejects a new payload read while backgrounded, then admits foreground retry', async () => {
    const status = vi.fn(); const render = () => harness.render(() => usePromptAttachmentController('a', status));
    render().stagePastedAttachment({ uri: 'file:///small.png', filename: 'small.png', byteCount: 1 });
    transition('background');
    await expect(render().payloads()).rejects.toThrow('retry Send');
    expect(render().attachments).toHaveLength(1);
    transition('active');
    await expect(render().payloads()).resolves.toHaveLength(1);
    expect(status).toHaveBeenLastCalledWith('');
  });

  it('replaces the reading footer with a real preparation failure and keeps the image retryable', async () => {
    const status = vi.fn(); const render = () => harness.render(() => usePromptAttachmentController('a', status));
    render().stagePastedAttachment({ uri: 'file:///large.png', filename: 'large.png', byteCount: 7 * 1024 * 1024 });
    pickers.optimize.mockRejectedValueOnce(new Error('image copy unavailable'));
    await expect(render().payloads()).rejects.toThrow('image copy unavailable');
    expect(status).toHaveBeenLastCalledWith('image copy unavailable');
    expect(render().attachments).toHaveLength(1);
    pickers.optimize.mockResolvedValue({ dataBase64: 'AQID', byteCount: 3, mimeType: 'image/jpeg' });
    await expect(render().payloads()).resolves.toHaveLength(1);
  });

  it('settles a pending native preparation on unmount without publishing a late status', async () => {
    const status = vi.fn(); const render = () => harness.render(() => usePromptAttachmentController('a', status));
    render().stagePastedAttachment({ uri: 'file:///large.png', filename: 'large.png', byteCount: 7 * 1024 * 1024 });
    let lateResolve!: (value: { dataBase64: string; byteCount: number; mimeType: string }) => void;
    pickers.optimize.mockImplementationOnce(() => new Promise((resolve) => { lateResolve = resolve; }));
    const pending = render().payloads();
    await vi.waitFor(() => expect(pickers.optimize).toHaveBeenCalledOnce());
    harness.unmount(); const statusCount = status.mock.calls.length;
    await expect(pending).rejects.toThrow('retry Send');
    lateResolve({ dataBase64: 'AQID', byteCount: 3, mimeType: 'image/jpeg' });
    await Promise.resolve(); await Promise.resolve();
    expect(status).toHaveBeenCalledTimes(statusCount);
    expect(appState.listeners.size).toBe(0);
  });

  it('removes only its own in-flight footer when the selected thread changes', async () => {
    let footer = '';
    const status = vi.fn((next: string | ((previous: string) => string)) => { footer = typeof next === 'function' ? next(footer) : next; });
    const render = (session: string) => harness.render(() => usePromptAttachmentController(session, status));
    render('a').stagePastedAttachment({ uri: 'file:///large.png', filename: 'large.png', byteCount: 7 * 1024 * 1024 });
    let lateResolve!: (value: { dataBase64: string; byteCount: number; mimeType: string }) => void;
    pickers.optimize.mockImplementationOnce(() => new Promise((resolve) => { lateResolve = resolve; }));
    const pending = render('a').payloads();
    await vi.waitFor(() => expect(pickers.optimize).toHaveBeenCalledOnce());
    expect(footer).toContain('optimizing upload copy');
    render('b'); expect(footer).toBe('');
    transition('inactive');
    await expect(pending).rejects.toThrow('retry Send');
    expect(footer).toBe('');
    lateResolve({ dataBase64: 'AQID', byteCount: 3, mimeType: 'image/jpeg' });
    await Promise.resolve();
    expect(footer).toBe('');
    expect(render('a').attachments).toHaveLength(1);
  });

  it('keeps the originating send gate closed after switching away and back', async () => {
    const picker = deferredPicker(); const status = vi.fn();
    const render = (session: string) => harness.render(() => usePromptAttachmentController(session, status));
    const work = render('a').pickDocument();
    expect(render('a').importing).toBe(true);
    expect(render('b').importing).toBe(false);
    expect(render('a').importing).toBe(true);
    picker.resolve({ canceled: false, assets: [asset] }); await work;
    expect(render('a')).toMatchObject({ importing: false, attachments: [{ filename: 'picked.txt' }] });
  });

  it('blocks payload materialization while that destination picker is pending', async () => {
    const picker = deferredPicker();
    const controller = harness.render(() => usePromptAttachmentController('a', vi.fn()));
    const work = controller.pickDocument();
    expect(controller.isImporting('a')).toBe(true);
    await expect(controller.payloads('a')).rejects.toThrow('Still attaching media');
    await expect(controller.payloads('b')).resolves.toEqual([]);
    picker.resolve({ canceled: true, assets: [] }); await work;
  });

  it('admits only one native picker before React can render its busy flag', async () => {
    const picker = deferredPicker();
    const controller = harness.render(() => usePromptAttachmentController('a', vi.fn()));
    const first = controller.pickDocument(); const second = controller.pickDocument();
    expect(pickers.document).toHaveBeenCalledTimes(1);
    picker.resolve({ canceled: true, assets: [] }); await Promise.all([first, second]);
  });

  it('parks completed media without announcing it in a different destination', async () => {
    const picker = deferredPicker(); const status = vi.fn();
    const render = (session: string) => harness.render(() => usePromptAttachmentController(session, status));
    const work = render('a').pickDocument(); render('b'); status.mockClear();
    picker.resolve({ canceled: false, assets: [asset] }); await work;
    expect(status).not.toHaveBeenCalled();
    expect(render('b').attachments).toEqual([]);
    expect(render('a').attachments).toHaveLength(1);
  });

  it('discards a picker result after terminal controller disposal', async () => {
    const picker = deferredPicker(); const status = vi.fn();
    const controller = harness.render(() => usePromptAttachmentController('a', status));
    const work = controller.pickDocument(); harness.unmount(); status.mockClear();
    picker.resolve({ canceled: false, assets: [asset] }); await work;
    expect(status).not.toHaveBeenCalled();
    await expect(controller.payloads('a')).resolves.toEqual([]);
  });

  it('does not let a destination switch launch a competing photo picker', async () => {
    const picker = deferredPicker(); const status = vi.fn();
    const render = (session: string) => harness.render(() => usePromptAttachmentController(session, status));
    const work = render('a').pickDocument();
    await render('b').pickImage();
    expect(pickers.image).not.toHaveBeenCalled();
    picker.resolve({ canceled: true, assets: [] }); await work;
    expect(render('a').importing).toBe(false);
  });

  it('releases a rejected picker and permits a subsequent successful photo import', async () => {
    const picker = deferredPicker(); const status = vi.fn();
    const render = () => harness.render(() => usePromptAttachmentController('a', status));
    const work = render().pickDocument();
    picker.reject(new Error('provider unavailable')); await work;
    expect(render().importing).toBe(false);
    expect(status).toHaveBeenLastCalledWith('provider unavailable');
    pickers.image.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///shot.png', fileName: 'shot.png', mimeType: 'image/png', fileSize: 1 }] });
    await render().pickImage();
    expect(render().attachments).toMatchObject([{ filename: 'shot.png', kind: 'image' }]);
    await expect(render().payloads('a')).resolves.toMatchObject([{ filename: 'shot.png', dataBase64: 'QQ==' }]);
  });

  it('imports ten screenshots and keeps the draft unchanged when an eleventh is rejected', async () => {
    const status = vi.fn(); const render = () => harness.render(() => usePromptAttachmentController('a', status));
    const assets = Array.from({ length: 10 }, (_, i) => ({ uri: `file:///shot-${i}.png`, fileName: `shot-${i}.png`, mimeType: 'image/png', fileSize: 100 }));
    pickers.image.mockResolvedValue({ canceled: false, assets });
    await render().pickImage();
    expect(render().attachments).toHaveLength(10);
    expect(render().atLimit).toBe(true);
    await expect(render().payloads()).resolves.toHaveLength(10);
    render().stagePastedAttachment({ uri: 'file:///eleven.png', filename: 'eleven.png', byteCount: 100 });
    expect(render().attachments).toHaveLength(10);
    expect(status).toHaveBeenLastCalledWith('Attachment limit reached: 10.');
  });

  it('releases the picker after attachment validation rejects an oversized file', async () => {
    const picker = deferredPicker(); const status = vi.fn();
    const render = () => harness.render(() => usePromptAttachmentController('a', status));
    const work = render().pickDocument();
    picker.resolve({ canceled: false, assets: [{ ...asset, size: 19 * 1024 * 1024 }] }); await work;
    expect(render()).toMatchObject({ attachments: [], importing: false });
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('18 MB total'));
  });
  it('stages a mixed drop atomically into its original thread and gates Send while it loads', async () => {
    let resolve!: (files: object[]) => void;
    pickers.readDrop.mockReturnValue(new Promise((done) => { resolve = done; }));
    const status = vi.fn(); const render = (key: string) => harness.render(() => usePromptAttachmentController(key, status));
    const work = render('a').importDrop({ id: 'drop1', sessionKey: 'a' });
    expect(render('a').importing).toBe(true);
    await expect(render('a').payloads()).rejects.toThrow('Still attaching media');
    render('b'); status.mockClear();
    resolve([{ uri: 'file:///drop/a.png', filename: 'a.png', byteCount: 1 }, { uri: 'file:///drop/b.pdf', filename: 'b.pdf', byteCount: 1 }]);
    await work;
    expect(status).not.toHaveBeenCalled();
    expect(render('b').attachments).toEqual([]);
    expect(render('a').attachments.map((a) => a.kind)).toEqual(['image', 'file']);
    expect(pickers.discardDrop).not.toHaveBeenCalled();
  });

  it('discards a delayed event from another thread without loading or changing its draft', async () => {
    const render = () => harness.render(() => usePromptAttachmentController('b', vi.fn()));
    await render().importDrop({ id: 'old', sessionKey: 'a' });
    expect(pickers.readDrop).not.toHaveBeenCalled();
    expect(pickers.discardDrop).toHaveBeenCalledWith('old');
    expect(render().attachments).toEqual([]);
  });

  it('rejects the entire over-budget batch and cleans native copies without changing existing attachments', async () => {
    const render = () => harness.render(() => usePromptAttachmentController('a', vi.fn()));
    render().stagePastedAttachment({ uri: 'file:///existing.png', filename: 'existing.png', byteCount: 10 * 1024 * 1024 });
    pickers.readDrop.mockResolvedValue([{ uri: 'file:///drop/b.pdf', filename: 'b.pdf', byteCount: 9 * 1024 * 1024 }]);
    await render().importDrop({ id: 'large', sessionKey: 'a' });
    expect(render().attachments).toMatchObject([{ filename: 'existing.png' }]);
    expect(pickers.discardDrop).toHaveBeenCalledWith('large');
    expect(render().importing).toBe(false);
  });

  it('rejects a competing drop while a picker owns the import', async () => {
    const picker = deferredPicker(); const render = () => harness.render(() => usePromptAttachmentController('a', vi.fn()));
    const work = render().pickDocument();
    await render().importDrop({ id: 'competing', sessionKey: 'a' });
    expect(pickers.readDrop).not.toHaveBeenCalled();
    expect(pickers.discardDrop).toHaveBeenCalledWith('competing');
    picker.resolve({ canceled: true, assets: [] }); await work;
  });

  it('cleans a late native result after disposal and permits retry after a provider failure', async () => {
    const render = () => harness.render(() => usePromptAttachmentController('a', vi.fn()));
    pickers.readDrop.mockRejectedValueOnce(new Error('cloud file unavailable'));
    await render().importDrop({ id: 'failed', sessionKey: 'a' });
    expect(render().importing).toBe(false);
    let resolve!: (files: object[]) => void;
    pickers.readDrop.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const work = render().importDrop({ id: 'late', sessionKey: 'a' });
    harness.unmount();
    resolve([{ uri: 'file:///drop/a.png', filename: 'a.png', byteCount: 1 }]); await work;
    expect(pickers.discardDrop.mock.calls).toEqual([['failed'], ['late'], ['late']]); // disposal plus idempotent late-result cleanup
  });

  it('releases owned files on remove and successful-send clear', async () => {
    const render = () => harness.render(() => usePromptAttachmentController('a', vi.fn()));
    pickers.readDrop.mockResolvedValue([{ uri: 'file:///drop/a.png', filename: 'a.png', byteCount: 1 }]);
    await render().importDrop({ id: 'one', sessionKey: 'a' });
    render().remove(render().attachments[0]!.id);
    expect(pickers.releaseDroppedFile).toHaveBeenCalledWith('file:///drop/a.png');
    await render().importDrop({ id: 'two', sessionKey: 'a' });
    render().clear();
    expect(pickers.releaseDroppedFile).toHaveBeenCalledTimes(2);
  });

  it('clears only its in-flight drop status when switching threads', async () => {
    let footer = '';
    const status = (next: string | ((previous: string) => string)) => { footer = typeof next === 'function' ? next(footer) : next; };
    const render = (key: string) => harness.render(() => usePromptAttachmentController(key, status));
    let resolve!: (files: object[]) => void;
    pickers.readDrop.mockReturnValue(new Promise((done) => { resolve = done; }));
    const work = render('a').importDrop({ id: 'switch', sessionKey: 'a' });
    expect(footer).toBe('attaching dropped files…');
    render('b'); expect(footer).toBe('');
    footer = 'unrelated status';
    render('a'); render('b'); expect(footer).toBe('unrelated status');
    resolve([{ uri: 'file:///drop/note.txt', filename: 'note.txt', byteCount: 1 }]); await work;
    expect(footer).toBe('unrelated status');
  });

});
