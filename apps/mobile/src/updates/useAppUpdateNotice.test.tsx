// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const expo = vi.hoisted(() => ({ state: {} as Record<string, unknown>, reload: vi.fn(), check: vi.fn(), fetch: vi.fn() }));
vi.mock('expo-updates', () => ({ useUpdates: () => expo.state, UpdateInfoType: { NEW: 'new' }, isEnabled: true,
  reloadAsync: expo.reload, checkForUpdateAsync: expo.check, fetchUpdateAsync: expo.fetch }));
vi.mock('expo-application', () => ({ nativeApplicationVersion: '0.1.0' }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children, testID }: { children?: React.ReactNode; testID?: string }) => createElement('div', { 'data-testid': testID }, children);
  return { View: Host, Text: Host, StyleSheet: { create: (styles: unknown) => styles },
    Pressable: ({ children, onPress, accessibilityLabel, disabled }: { children?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; disabled?: boolean }) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children) };
});
import { AppUpdateNotice } from './AppUpdateNotice';
import { useAppUpdateNotice } from './useAppUpdateNotice';
const manifest = (title: string) => ({ extra: { vimicateUpdate: { title, fixes: [`${title} detail`] } } });
let notice: ReturnType<typeof useAppUpdateNotice>;
let root: Root;
let container: HTMLDivElement;
const persistDraft = vi.fn(async () => {});
function Harness({ hold = null }: { hold?: 'submission' | 'attachments' | null }) { notice = useAppUpdateNotice(hold, persistDraft); return <AppUpdateNotice notice={notice} />; }
const click = async (label: string) => { await act(async () => { (container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click(); }); };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React); vi.clearAllMocks(); persistDraft.mockResolvedValue(undefined);
  expo.state = { currentlyRunning: { updateId: 'installed', manifest: manifest('Installed notes') }, restartCount: 1,
    isUpdatePending: false, isRestarting: false };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe('reopening update notes', () => {
  it('reopens dismissed notes expanded repeatedly without network or reload', async () => {
    await act(async () => root.render(<Harness />));
    await click('Dismiss update notification'); expect(container.textContent).toBe('');
    for (let i = 0; i < 2; i++) {
      await act(async () => { expect(notice.showNotes()).toBe('update notes opened'); });
      expect(container.querySelector('[data-testid="app-update-release-notes"]')?.textContent).toContain('Installed notes detail');
      await click('Collapse update notes');
      await act(async () => { notice.showNotes(); });
      expect(container.querySelector('[data-testid="app-update-release-notes"]')).not.toBeNull();
      await click('Dismiss update notification'); expect(container.textContent).toBe('');
    }
    expect(expo.reload).not.toHaveBeenCalled(); expect(expo.check).not.toHaveBeenCalled(); expect(expo.fetch).not.toHaveBeenCalled();
  });
  it('can show currently installed notes after a cold launch, without an automatic notification', async () => {
    expo.state.restartCount = 0;
    await act(async () => root.render(<Harness />)); expect(container.textContent).toBe('');
    await act(async () => { notice.showNotes(); });
    expect(container.textContent).toContain('Installed notes detail');
    expect(container.textContent).toContain('installed · ready to use');
    expect(container.querySelector('[aria-label="Restart Vimicate to apply update"]')).toBeNull();
  });
  it('reopens downloaded notes and offers restart during an active selected run', async () => {
    expo.state.isUpdatePending = true; expo.state.downloadedUpdate = { type: 'new', updateId: 'next', manifest: manifest('Next notes') };
    await act(async () => root.render(<Harness />)); await click('Dismiss update notification');
    await act(async () => { notice.showNotes(); }); expect(container.textContent).toContain('Next notes detail');
    const restart = container.querySelector('[aria-label="Restart Vimicate to apply update"]') as HTMLButtonElement;
    expect(restart.disabled).toBe(false); await act(async () => restart.click()); expect(persistDraft).toHaveBeenCalledOnce(); expect(expo.reload).toHaveBeenCalledOnce();
    expect(persistDraft.mock.invocationCallOrder[0]).toBeLessThan(expo.reload.mock.invocationCallOrder[0]!);
    await click('Dismiss update notification');
    expo.state.downloadedUpdate = { type: 'new', updateId: 'later', manifest: manifest('Later notes') };
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain('Later notes'); expect(container.querySelector('[data-testid="app-update-release-notes"]')).toBeNull();
  });
  it('waits for a prompt submission to settle before allowing restart', async () => {
    expo.state.isUpdatePending = true;
    await act(async () => root.render(<Harness hold="submission" />));
    const restart = container.querySelector('[aria-label="Restart after the prompt finishes sending"]') as HTMLButtonElement;
    expect(restart.disabled).toBe(true);
    await act(async () => restart.click());
    expect(persistDraft).not.toHaveBeenCalled(); expect(expo.reload).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness />));
    expect((container.querySelector('[aria-label="Restart Vimicate to apply update"]') as HTMLButtonElement).disabled).toBe(false);
  });
  it('holds restart while staged attachments exist only in memory', async () => {
    expo.state.isUpdatePending = true;
    await act(async () => root.render(<Harness hold="attachments" />));
    const restart = container.querySelector('[aria-label="Restart after sending or removing staged attachments"]') as HTMLButtonElement;
    expect(restart.disabled).toBe(true);
    await act(async () => restart.click());
    expect(expo.reload).not.toHaveBeenCalled();
  });
  it('keeps the update ready when the current draft cannot be saved', async () => {
    expo.state.isUpdatePending = true;
    persistDraft.mockRejectedValueOnce(new Error('draft write failed'));
    await act(async () => root.render(<Harness />));
    await click('Restart Vimicate to apply update');
    expect(expo.reload).not.toHaveBeenCalled();
    expect(container.textContent).toContain('retry');
  });
  it('reports unavailable notes without fetching or inventing an update', async () => {
    expo.state.currentlyRunning = { updateId: 'no-notes', manifest: {} }; expo.state.restartCount = 0;
    await act(async () => root.render(<Harness />));
    await act(async () => { expect(notice.showNotes()).toBe('update notes unavailable for this build'); });
    expect(container.textContent).toBe(''); expect(expo.check).not.toHaveBeenCalled(); expect(expo.reload).not.toHaveBeenCalled();
  });
});
