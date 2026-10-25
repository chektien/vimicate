// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Real React/controller/rail/viewer composition. Native I/O and native views
// are seams, so this does not measure decoding, paging, frames or device latency.
const native = vi.hoisted(() => ({
  image: vi.fn(), info: vi.fn(), read: vi.fn(), release: vi.fn(),
  state: 'active', listeners: new Set<(state: string) => void>(), nextID: 0,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => `attachment-${++native.nextID}` }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: native.image }));
vi.mock('expo-file-system/legacy', () => ({ EncodingType: { Base64: 'base64' }, getInfoAsync: native.info, readAsStringAsync: native.read }));
vi.mock('../../modules/vimicate-editor', () => ({ default: { releaseDroppedFile: native.release } }));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return native.state; },
    addEventListener: (_: string, listener: (state: string) => void) => {
      native.listeners.add(listener); return { remove: () => native.listeners.delete(listener) };
    },
  },
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Image: ({ source }: { source: { uri: string } }) => <img src={source.uri} />,
  Pressable: ({ children, accessibilityLabel, onPress }: { children?: React.ReactNode; accessibilityLabel: string; onPress: () => void }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  ScrollView: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel: string }) => <section aria-label={accessibilityLabel}>{children}</section>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
import { usePromptAttachmentController } from './usePromptAttachmentController';
import { PromptAttachmentRail } from './PromptAttachmentRail';
import { promptAttachmentViewer } from './promptAttachmentViewer';

let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof usePromptAttachmentController>;
let viewer: ReturnType<typeof promptAttachmentViewer>;
function Scene({ sessionKey = 'origin', compact = false }) {
  const [status, setStatus] = useState('');
  const [interactions, setInteractions] = useState(0);
  controller = usePromptAttachmentController(sessionKey, setStatus);
  return <>
    <output>{status}</output><button onClick={() => setInteractions(value => value + 1)}>Interact {interactions}</button>
    <PromptAttachmentRail attachments={controller.attachments} compact={compact} visibleSlots={1}
      onPreviewAttachment={id => { viewer = promptAttachmentViewer(controller.attachments, id); }} onRemoveAttachment={controller.remove} />
  </>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const input = (name: string) => ({ uri: `file:///synthetic/${name}.png`, filename: `${name}.png`, mimeType: 'image/png', byteCount: 1 });
const click = async (label: string) => act(async () => {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  expect(button).not.toBeNull(); button!.click();
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  vi.clearAllMocks(); native.nextID = 0; native.state = 'active'; native.listeners.clear(); viewer = null;
  native.info.mockResolvedValue({ exists: true, isDirectory: false, size: 1 });
  native.read.mockReset().mockResolvedValue('AQ=='); native.release.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each([false, true])('keeps paste-one/picker-three identities through parking, preview and removal (compact=%s)', async compact => {
  const render = (sessionKey: string) => act(async () => root.render(<Scene sessionKey={sessionKey} compact={compact} />));
  await render('origin');
  await act(async () => controller.stagePastedAttachment(input('paste')));
  const pasted = controller.attachments[0]!;
  const picker = deferred<{ canceled: boolean; assets: object[] }>(); native.image.mockReturnValueOnce(picker.promise);
  let picking!: Promise<void>;
  await act(async () => { picking = controller.pickImage(); });
  await expect(controller.payloads()).rejects.toThrow('Still attaching media');
  await render('other');
  await act(async () => controller.stagePastedAttachment(input('other')));
  const other = controller.attachments;
  const footer = container.querySelector('output')!.textContent;
  await act(async () => {
    picker.resolve({ canceled: false, assets: [1, 2, 3].map(index => ({ uri: input(`album-${index}`).uri, fileName: 'same-name.png', mimeType: 'image/png', fileSize: 1 })) });
    await picking;
  });
  expect(controller.attachments).toEqual(other);
  expect(container.querySelector('output')!.textContent).toBe(footer);
  await render('origin');
  const staged = controller.attachments;
  expect(staged[0]).toEqual(pasted);
  expect(staged.map(item => item.uri)).toEqual(['paste', 'album-1', 'album-2', 'album-3'].map(name => input(name).uri));
  expect(new Set(staged.map(item => item.id)).size).toBe(4);
  expect([...container.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(staged.map(item => item.uri));
  for (const [index, attachment] of staged.entries()) {
    await click(`Preview attachment ${index + 1}: ${attachment.filename}`);
    expect(viewer?.initialID).toBe(attachment.id);
    expect(viewer?.attachments.map(item => item.id)).toEqual(staged.map(item => item.id));
  }
  await click('Remove attachment 3: same-name.png');
  const remaining = [staged[0]!, staged[1]!, staged[3]!];
  expect(controller.attachments).toEqual(remaining);
  await click('Preview attachment 3: same-name.png');
  expect(viewer?.initialID).toBe(staged[3]!.id);
  native.image.mockResolvedValueOnce({ canceled: true, assets: [] });
  await act(async () => controller.pickImage());
  expect(controller.attachments).toEqual(remaining);
  await act(async () => {
    await expect(controller.payloads()).resolves.toMatchObject(remaining.map(item => ({ id: item.id, uri: item.uri, dataBase64: 'AQ==' })));
  });
  expect(controller.attachments).toEqual(remaining);
  await render('other'); expect(controller.attachments).toEqual(other);
});

it.each(['background', 'unmount'] as const)('paints preparation feedback and retires pending reads on %s without reading the next file', async terminal => {
  await act(async () => root.render(<Scene />));
  await act(async () => { controller.stagePastedAttachment(input('first')); controller.stagePastedAttachment(input('second')); });
  const staged = controller.attachments;
  const read = deferred<string>(); native.read.mockReturnValueOnce(read.promise);
  let preparation!: Promise<unknown>;
  await act(async () => { preparation = controller.payloads().catch(error => error); });
  expect(container.querySelector('output')!.textContent).toBe('reading attachments…');
  expect(native.read).toHaveBeenCalledExactlyOnceWith(input('first').uri, { encoding: 'base64', position: 0, length: 18 * 1024 * 1024 + 1 });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toContain('Interact 1');
  await expect(controller.payloads()).rejects.toThrow('Still reading attachments');
  await act(async () => {
    if (terminal === 'unmount') root.unmount();
    else { native.state = 'background'; for (const listener of native.listeners) listener('background'); }
    expect(await preparation).toMatchObject({ message: expect.stringContaining('Original attachments are still staged') });
  });
  await act(async () => { read.resolve('AQ=='); await new Promise<void>(resolve => setTimeout(resolve, 0)); });
  expect(native.info).toHaveBeenCalledTimes(1); expect(native.read).toHaveBeenCalledTimes(1);
  if (terminal === 'background') {
    expect(controller.attachments).toEqual(staged);
    await act(async () => { native.state = 'active'; for (const listener of native.listeners) listener('active'); });
    await act(async () => { await expect(controller.payloads()).resolves.toHaveLength(2); });
    expect(native.read.mock.calls.slice(1).map(([uri]) => uri)).toEqual(staged.map(item => item.uri));
    expect(container.querySelector('output')!.textContent).toBe('');
    expect(controller.attachments).toEqual(staged);
  } else expect(native.listeners.size).toBe(0);
});

it('keeps next-draft media when an earlier submitted snapshot is consumed', async () => {
  await act(async () => root.render(<Scene />));
  await act(async () => controller.stagePastedAttachment(input('sent')));
  const submitted = controller.attachments;
  await act(async () => controller.stagePastedAttachment(input('later')));
  const later = controller.attachments[1]!;
  // Model an accepted send after a newer attachment has reached this draft.
  await act(async () => controller.clear('origin', submitted));
  expect(controller.attachments).toEqual([later]);
  expect(native.release.mock.calls.map(([uri]) => uri)).toEqual([input('sent').uri]);
  await act(async () => { await expect(controller.payloads()).resolves.toMatchObject([{ id: later.id, dataBase64: 'AQ==' }]); });
});

it('captures live synchronous staging and pins the same media set through asynchronous preparation', async () => {
  await act(async () => root.render(<Scene />));
  await act(async () => controller.stagePastedAttachment(input('first')));
  const stale = controller;
  const read = deferred<string>(); native.read.mockReturnValueOnce(read.promise);
  let submitted!: typeof controller.attachments;
  let preparation!: ReturnType<typeof controller.payloads>;
  await act(async () => {
    stale.stagePastedAttachment(input('same-tick'));
    submitted = stale.snapshot('origin');
    preparation = stale.payloads('origin', submitted);
  });
  expect(submitted.map(item => item.uri)).toEqual([input('first').uri, input('same-tick').uri]);
  await act(async () => controller.stagePastedAttachment(input('next-draft')));
  const next = controller.attachments[2]!;
  await act(async () => read.resolve('AQ=='));
  await expect(preparation).resolves.toMatchObject(submitted.map(item => ({ id: item.id, dataBase64: 'AQ==' })));
  expect(native.read.mock.calls.map(([uri]) => uri)).toEqual(submitted.map(item => item.uri));
  await act(async () => controller.clear('origin', submitted));
  expect(controller.attachments).toEqual([next]);
});
