// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: ({ children, style }: { children?: React.ReactNode; style?: Record<string, unknown> }) => <div data-style={JSON.stringify(style)}>{children}</div>,
  Text: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => <span aria-label={accessibilityLabel}>{children}</span>,
  TextInput: ({ accessibilityLabel, value, onChangeText, onFocus }: { accessibilityLabel?: string; value: string; onChangeText: (value: string) => void; onFocus?: () => void }) => <input aria-label={accessibilityLabel} value={value} onChange={(event) => onChangeText(event.target.value)} onFocus={onFocus} />,
  Pressable: ({ children, accessibilityLabel, disabled, onPress }: { children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode); accessibilityLabel?: string; disabled?: boolean; onPress?: () => void }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{typeof children === 'function' ? children({ pressed: false }) : children}</button>,
  ScrollView: ({ children, accessibilityLabel, horizontal, directionalLockEnabled, keyboardDismissMode, keyboardShouldPersistTaps }: { children?: React.ReactNode; accessibilityLabel?: string; horizontal?: boolean; directionalLockEnabled?: boolean; keyboardDismissMode?: string; keyboardShouldPersistTaps?: string }) => <section aria-label={accessibilityLabel} data-horizontal={String(Boolean(horizontal))} data-directional-lock={String(Boolean(directionalLockEnabled))} data-keyboard-dismiss={keyboardDismissMode} data-keyboard-taps={keyboardShouldPersistTaps}>{children}</section>,
  Modal: ({ children, visible }: { children?: React.ReactNode; visible?: boolean }) => visible ? <div>{children}</div> : null,
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
vi.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })] }));
vi.mock('./ConnectionStatusControl', () => ({
  ConnectionStatusControl: ({ label, onPress }: { label: string; onPress: () => void }) => <button aria-label={`Gateway ${label}`} onClick={onPress} />,
}));

import { PairingBar } from './PairingBar';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('swaps workspace chrome for one horizontally scrollable edit strip and restores preserved edits on close', async () => {
  const editingChanges: boolean[] = [];
  const gateway = {
    profile: { endpoint: 'wss://gateway.example', credentialKind: 'none' as const, credential: '', sessionKey: 'fixture' },
    status: 'connected' as const,
    pair: vi.fn(),
    connect: vi.fn(),
    forget: vi.fn(),
  };
  await act(async () => root.render(<PairingBar gateway={gateway} onEditingChange={(editing) => editingChanges.push(editing)} paneControls={<span>workspace panes</span>} />));

  expect(container.textContent).toContain('vimicate');
  expect(container.textContent).toContain('workspace panes');
  expect(JSON.parse((container.firstElementChild as HTMLElement).dataset.style!)).toMatchObject({ height: 33, overflow: 'hidden' });

  await act(async () => (container.querySelector('[aria-label="Gateway connected"]') as HTMLButtonElement).click());
  const rail = container.querySelector('[aria-label="Gateway connection settings"]') as HTMLElement;
  expect(rail.dataset.horizontal).toBe('true');
  expect(rail.dataset.directionalLock).toBe('true');
  expect(rail.dataset.keyboardDismiss).toBe('none');
  expect(rail.dataset.keyboardTaps).toBe('always');
  expect(container.textContent).not.toContain('vimicate');
  expect(container.textContent).not.toContain('workspace panes');
  expect(container.querySelector('[aria-label="Gateway connected"]')).not.toBeNull();

  const input = container.querySelector('[aria-label="OpenClaw setup code or Gateway URL"]') as HTMLInputElement;
  expect(input.value).toBe('wss://gateway.example');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'wss://edited.example');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => (container.querySelector('[aria-label="Gateway connected"]') as HTMLButtonElement).click());
  expect(container.textContent).toContain('vimicate');
  expect(container.textContent).toContain('workspace panes');
  await act(async () => (container.querySelector('[aria-label="Gateway connected"]') as HTMLButtonElement).click());
  expect((container.querySelector('[aria-label="OpenClaw setup code or Gateway URL"]') as HTMLInputElement).value).toBe('wss://edited.example');
  expect(editingChanges).toEqual([true, false, true]);

  gateway.pair.mockRejectedValueOnce(new Error('Fixture pairing unavailable'));
  await act(async () => (container.querySelector('[aria-label="Pair"]') as HTMLButtonElement).click());
  expect(container.querySelector('[aria-label="Gateway connection settings"]')?.textContent).toContain('Fixture pairing unavailable');
  expect((container.querySelector('[aria-label="OpenClaw setup code or Gateway URL"]') as HTMLInputElement).value).toBe('wss://edited.example');
  expect(gateway.connect).not.toHaveBeenCalled();
  expect(editingChanges).toEqual([true, false, true]);
});
