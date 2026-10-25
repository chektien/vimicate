// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import type { QueuedPromptView } from '../gateway/useGatewayQueuedPrompts';
const probe = vi.hoisted(() => ({ alert: vi.fn(), buttons: [] as { style: Record<string, number>; accessibilityLabel: string }[] }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
  return { Alert: { alert: probe.alert }, View: Host, Text: Host, StyleSheet: { create: (value: unknown) => value },
    Pressable: (props: { children?: React.ReactNode; onPress: () => void; style: Record<string, number>; accessibilityLabel: string }) => {
      probe.buttons.push(props); return createElement('button', { onClick: props.onPress, 'aria-label': props.accessibilityLabel }, props.children);
    } };
});
import { QueuedPromptProvider } from './QueuedPromptContext';
import { TranscriptQueuedPrompt } from './TranscriptQueuedPrompt';
const message = { id: 'row', role: 'user' as const, sessionKey: 'route', text: 'test', idempotencyKey: 'followup' };
const queued: QueuedPromptView = { id: 'followup', runId: 'followup', originalSubmissionId: 'original', sessionKey: 'route', sessionId: 'generation', predecessorRunId: 'previous', createdAt: 1, text: 'test', state: 'queued', canCancel: true, canRunNow: true, busy: false };
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); probe.buttons = []; probe.alert.mockReset(); });
it('renders inline native queue actions for the exact message and invokes only its existing queue identity', async () => {
  const host = document.createElement('div'); const root = createRoot(host); const cancel = vi.fn(async () => {}); const runNow = vi.fn(async () => {});
  const actions = { view: () => queued, cancel, runNow } as unknown as React.ComponentProps<typeof QueuedPromptProvider>['value'];
  await act(async () => root.render(<QueuedPromptProvider value={actions}><TranscriptQueuedPrompt message={message} /></QueuedPromptProvider>));
  expect(host.textContent).toContain('Queued after the current task. Runs automatically.');
  expect(host.textContent).toContain('Reply "interrupt" to stop it and run queued messages next.'); expect(host.querySelectorAll('button')).toHaveLength(2);
  expect(probe.buttons.every(button => button.style.minHeight! >= 44 && button.style.minWidth! >= 44)).toBe(true);
  await act(async () => { host.querySelectorAll('button')[0]!.click(); });
  expect(cancel).toHaveBeenCalledWith('followup'); expect(runNow).not.toHaveBeenCalled(); await act(async () => root.unmount());
});
it('shows an unconfirmed or consumed outcome without offering resend or completed-answer claims', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  for (const state of ['unknown', 'consumed'] as const) {
    const actions = { view: () => ({ ...queued, state, canCancel: false, canRunNow: false }), storageError: undefined } as unknown as React.ComponentProps<typeof QueuedPromptProvider>['value'];
    await act(async () => root.render(<QueuedPromptProvider value={actions}><TranscriptQueuedPrompt message={message} /></QueuedPromptProvider>));
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.textContent).toBe(state === 'unknown' ? 'Queued-message delivery unconfirmed' : 'Sent to agent');
  }
  await act(async () => root.unmount());
});

async function confirmationFixture() {
  const host = document.createElement('div'); const root = createRoot(host);
  const runNow = vi.fn(async () => {}); const cancel = vi.fn(async () => {});
  let current = queued;
  const actions = { view: () => current, cancel, runNow } as unknown as React.ComponentProps<typeof QueuedPromptProvider>['value'];
  const render = async () => { await act(async () => root.render(<QueuedPromptProvider value={actions}><TranscriptQueuedPrompt message={message} /></QueuedPromptProvider>)); };
  await render();
  const open = async () => { await act(async () => { (host.querySelectorAll('button')[1] as HTMLButtonElement).click(); }); };
  return { host, root, runNow, cancel, open, change: async (next: QueuedPromptView) => { current = next; await render(); } };
}
it('requires explicit destructive confirmation, defaults to keeping queued, and explains scheduling consequences', async () => {
  const f = await confirmationFixture();
  expect(f.host.textContent).toContain('Stop task & run next…');
  await f.open(); await f.open();
  expect(probe.alert).toHaveBeenCalledTimes(1);
  expect(f.runNow).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  const [title, body, buttons] = probe.alert.mock.calls[0]!;
  expect(title).toBe('Stop the current task?');
  expect(body).toContain('will not resume automatically');
  expect(body).toContain('may not schedule its next run');
  expect(buttons[0]).toMatchObject({ text: 'Keep queued', style: 'cancel', isPreferred: true });
  expect(buttons[1]).toMatchObject({ text: 'Stop task & run next', style: 'destructive' });
  await act(async () => buttons[1].onPress());
  await act(async () => buttons[1].onPress());
  expect(f.runNow).toHaveBeenCalledExactlyOnceWith('followup');
  await act(async () => f.root.unmount());
});
it('Keep queued or dismiss performs no stop or cancellation and allows a fresh decision', async () => {
  const f = await confirmationFixture(); await f.open();
  await act(async () => probe.alert.mock.calls[0]![2][0].onPress());
  await f.open();
  await act(async () => probe.alert.mock.calls[1]![3].onDismiss());
  expect(f.runNow).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  await f.open(); expect(probe.alert).toHaveBeenCalledTimes(3);
  await act(async () => f.root.unmount());
});
it.each(['consumed', 'successor', 'generation', 'unmounted'] as const)('ignores a stale confirmation after %s', async (change) => {
  const f = await confirmationFixture(); await f.open();
  const confirm = probe.alert.mock.calls[0]![2][1].onPress;
  if (change === 'unmounted') await act(async () => f.root.unmount());
  else await f.change({ ...queued, ...(change === 'consumed' ? { state: 'consumed', canRunNow: false } : change === 'successor' ? { predecessorRunId: 'new-task' } : { sessionId: 'new-generation' }) });
  await act(async () => confirm()); expect(f.runNow).not.toHaveBeenCalled();
  if (change !== 'unmounted') await act(async () => f.root.unmount());
});
