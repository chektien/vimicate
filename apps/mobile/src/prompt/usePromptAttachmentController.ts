import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { EncodingType, getInfoAsync, readAsStringAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import { MAX_PROMPT_ATTACHMENTS, normalizedPromptAttachment, SessionPromptAttachmentDrafts, type GatewayPromptAttachment, type PromptAttachment } from './promptAttachments';
import nativeEditor, { type PromptDropEvent } from '../../modules/vimicate-editor';
import { materializePromptAttachmentBatch } from './promptAttachmentUploadBatch';

// Expo 57's FileHandle.readBytes is synchronous. The supported legacy reader
// pairs position and length to retain bounded native background I/O + base64.
const openAttachmentReader = async (uri: string) => {
  const info = await getInfoAsync(uri);
  return {
    size: info.exists && !info.isDirectory ? info.size : null,
    readBase64: (length: number) => readAsStringAsync(uri, { encoding: EncodingType.Base64, position: 0, length }),
  };
};
type AttachmentInput = Parameters<typeof normalizedPromptAttachment>[0];
const interruptedPreparation = () => new Error('Attachment read interrupted when Vimicate left the foreground. Original attachments are still staged; retry Send.');
type Preparation = { cancel: () => void; statusText: string };
const dropStatus = 'attaching dropped files…';

export function usePromptAttachmentController(sessionKey: string, onStatus: Dispatch<SetStateAction<string>>) {
  const drafts = useRef(new SessionPromptAttachmentDrafts((items) => { for (const item of items) void nativeEditor.releaseDroppedFile?.(item.uri).catch(() => {}); })); const activeKey = useRef(sessionKey);
  const activeDrop = useRef<string | undefined>(undefined);
  const preparations = useRef(new Map<string, Preparation>());
  const [, setRevision] = useState(0);
  useLayoutEffect(() => {
    const previous = activeKey.current;
    activeKey.current = sessionKey;
    if (previous !== sessionKey) {
      if (activeDrop.current && drafts.current.isImporting(previous)) onStatus((current) => current === dropStatus ? '' : current);
      const oldPreparation = preparations.current.get(previous);
      if (oldPreparation?.statusText) onStatus((current) => current === oldPreparation.statusText ? '' : current);
    }
  }, [sessionKey, onStatus]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') for (const preparation of preparations.current.values()) preparation.cancel();
    });
    return () => { subscription.remove(); activeKey.current = ''; drafts.current.dispose(); if (activeDrop.current) void nativeEditor.discardDrop?.(activeDrop.current).catch(() => {}); for (const preparation of preparations.current.values()) preparation.cancel(); };
  }, []);

  const refresh = useCallback((_owner: string) => { setRevision((value) => value + 1); }, []);
  const status = useCallback((owner: string, value: string) => { if (activeKey.current === owner) onStatus(value); }, [onStatus]);
  const publish = useCallback((owner: string, next: PromptAttachment[]) => {
    drafts.current.replace(owner, next); refresh(owner);
  }, [refresh]);
  const stage = useCallback((owner: string, inputs: AttachmentInput[]) => {
    try { const next = drafts.current.append(owner, inputs.map(normalizedPromptAttachment)); refresh(owner); status(owner, `${next.length} attachment${next.length === 1 ? '' : 's'} staged`); return true; }
    catch (error) { status(owner, error instanceof Error ? error.message : 'attachment rejected'); return false; }
  }, [refresh, status]);
  const importFromPicker = useCallback(async (read: () => Promise<AttachmentInput[] | undefined>, failure: string) => {
    const owner = activeKey.current; if (!owner) return;
    const ticket = drafts.current.beginImport(owner);
    if (!ticket) { status(owner, 'Finish or cancel the open attachment picker first.'); return; }
    refresh(owner);
    try {
      const inputs = await read();
      if (inputs && drafts.current.ownsImport(ticket)) stage(owner, inputs);
    } catch (error) {
      if (drafts.current.ownsImport(ticket)) status(owner, error instanceof Error ? error.message : failure);
    } finally { if (drafts.current.finishImport(ticket)) refresh(owner); }
  }, [refresh, stage, status]);
  const importDrop = useCallback(async (event: PromptDropEvent) => {
    const discard = () => nativeEditor.discardDrop?.(event.id).catch(() => {});
    if (!event.sessionKey || event.sessionKey !== activeKey.current) { await discard(); return; }
    const owner = event.sessionKey;
    const ticket = drafts.current.beginImport(owner);
    if (!ticket) { status(owner, 'Finish the current attachment import first.'); await discard(); return; }
    activeDrop.current = event.id;
    refresh(owner); status(owner, dropStatus);
    let accepted = false;
    try {
      const inputs = await nativeEditor.readDrop(event.id);
      if (drafts.current.ownsImport(ticket)) accepted = stage(owner, inputs.map((input) => ({ ...input, id: Crypto.randomUUID() })));
    } catch (error) {
      if (drafts.current.ownsImport(ticket)) status(owner, error instanceof Error ? error.message : 'Dropped files could not be read.');
    } finally {
      if (!accepted) await discard();
      if (activeDrop.current === event.id) activeDrop.current = undefined;
      if (drafts.current.finishImport(ticket)) refresh(owner);
    }
  }, [refresh, stage, status]);
  const pickDocument = useCallback(() => importFromPicker(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    return result.canceled ? undefined : result.assets.map((asset) => ({ id: Crypto.randomUUID(), uri: asset.uri, filename: asset.name, mimeType: asset.mimeType, byteCount: asset.size }));
  }, 'document import failed'), [importFromPicker]);
  const pickImage = useCallback(() => importFromPicker(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.85 });
    return result.canceled ? undefined : result.assets.map((asset) => ({ id: Crypto.randomUUID(), uri: asset.uri, filename: asset.fileName, mimeType: asset.mimeType, byteCount: asset.fileSize }));
  }, 'image import failed'), [importFromPicker]);
  const isImporting = useCallback((owner = activeKey.current) => drafts.current.isImporting(owner), []);
  const stagePastedAttachment = useCallback((input: AttachmentInput & { error?: string }) => {
    const owner = activeKey.current;
    if (!owner) return;
    if (input.error) { status(owner, input.error); return; }
    if (isImporting(owner)) return;
    stage(owner, [{ ...input, id: Crypto.randomUUID() }]);
  }, [isImporting, stage, status]);
  const remove = useCallback((id: string) => { const owner = activeKey.current; publish(owner, drafts.current.remove(owner, id)); }, [publish]);
  // Acceptance consumes its snapshot, never media staged for the next draft.
  const clear = useCallback((owner = activeKey.current, submitted = drafts.current.restore(owner)) => {
    const ids = new Set(submitted.map((item) => item.id));
    publish(owner, drafts.current.restore(owner).filter((item) => !ids.has(item.id)));
  }, [publish]);
  const snapshot = useCallback((owner = activeKey.current) => drafts.current.restore(owner), []);
  const payloads = useCallback(async (owner = activeKey.current, selected = drafts.current.restore(owner)): Promise<GatewayPromptAttachment[]> => {
    if (isImporting(owner)) throw new Error('Still attaching media. Wait for the attachment chip before sending.');
    if (!selected.length) return [];
    if (preparations.current.has(owner)) throw new Error('Still reading attachments for this thread.');
    if (AppState.currentState === 'inactive' || AppState.currentState === 'background') throw interruptedPreparation();
    let rejectInterrupted!: (error: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
    let live = true;
    const preparation: Preparation = { statusText: 'reading attachments…', cancel: () => {
      if (!live) return;
      live = false;
      rejectInterrupted(interruptedPreparation());
    } };
    const assertActive = () => { if (!live) throw interruptedPreparation(); };
    preparations.current.set(owner, preparation);
    status(owner, preparation.statusText);
    try {
      const result = await Promise.race([materializePromptAttachmentBatch(selected, openAttachmentReader, async (data) => {
        const native = (await import('../../modules/vimicate-editor')).default;
        assertActive();
        if (typeof native.prepareImageUploadCopy !== 'function') throw new Error('Install the latest TestFlight build to prepare this image. The original is unchanged.');
        return native.prepareImageUploadCopy(data);
      }, (filename) => { if (live) { preparation.statusText = `optimizing upload copy of ${filename}… original kept`; status(owner, preparation.statusText); } }, assertActive), interrupted]);
      assertActive();
      status(owner, '');
      return result;
    } catch (error) {
      if (live) status(owner, error instanceof Error ? error.message : 'attachment read failed');
      else if (activeKey.current === owner) status(owner, interruptedPreparation().message);
      throw error;
    } finally {
      live = false;
      if (preparations.current.get(owner) === preparation) preparations.current.delete(owner);
    }
  }, [isImporting, status]);
  const attachments = drafts.current.restore(sessionKey);
  return { attachments, importing: isImporting(sessionKey), pendingDrafts: drafts.current.hasPendingDrafts(), isImporting, atLimit: attachments.length >= MAX_PROMPT_ATTACHMENTS, importDrop, pickDocument, pickImage, stagePastedAttachment, remove, clear, snapshot, payloads };
}
