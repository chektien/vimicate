// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: ({ children, style }: { children?: React.ReactNode; style?: unknown }) => <div data-style={JSON.stringify(style)}>{children}</div>,
  Text: ({ children, style }: { children?: React.ReactNode; style?: unknown }) => <span data-style={JSON.stringify(style)}>{children}</span>,
  Pressable: ({ children, onPress, style, accessibilityLabel }: { children?: React.ReactNode; onPress?: () => void; style?: unknown; accessibilityLabel?: string }) =>
    <button data-style={JSON.stringify(style)} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  ScrollView: ({ children, contentContainerStyle, style, ...props }: { children?: React.ReactNode; contentContainerStyle?: unknown; style?: unknown; [key: string]: unknown }) =>
    <section data-scroll={JSON.stringify(props)} data-style={JSON.stringify(style)}><div data-scroll-content="true" data-style={JSON.stringify(contentContainerStyle)}>{children}</div></section>,
  StyleSheet: { create: (styles: unknown) => styles },
}));

import { StatusLine } from './StatusLine';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it.each([true, false])('scrolls a complete status row horizontally while preserving its spacer at compact=%s', async (compact) => {
  const refresh = vi.fn();
  await act(async () => root.render(<StatusLine compact={compact} mode="insert" path="last known" branch="main"
    detail="last known 9m" quota={{ text: '5h 21% 2h52m · Week 86% 2d21h', tone: 'normal', provider: 'claude' }}
    usage="589k" position="1:1" onRefreshQuota={refresh} />));
  const rail = container.querySelector('section')!;
  const scroll = JSON.parse(rail.dataset.scroll!);
  const contentNode = rail.querySelector('[data-scroll-content]')!;
  const content = JSON.parse((contentNode as HTMLElement).dataset.style!);
  expect(scroll.horizontal).toBe(true);
  expect(scroll.directionalLockEnabled).toBe(true);
  expect(scroll.focusable).toBe(false);
  expect(scroll.keyboardDismissMode).toBe('none');
  expect(scroll.showsHorizontalScrollIndicator).toBe(false);
  expect(scroll.keyboardShouldPersistTaps).toBe('always');
  expect(content.flexGrow).toBe(1);
  expect(content.flexDirection).toBe('row');
  const spacer = [...contentNode.querySelectorAll('div')].find(node => JSON.parse(node.dataset.style!).flex === 1);
  expect(spacer).toBeDefined();
  const quota = contentNode.querySelector('button') as HTMLButtonElement;
  const usage = [...contentNode.querySelectorAll('span')].find(node => node.textContent === '589k')!;
  expect(quota.getAttribute('aria-label')).toContain('Provider quota 5h 21%');
  expect(quota.textContent).toContain('Week 86%');
  expect(quota.compareDocumentPosition(usage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const node of [rail, contentNode, ...contentNode.querySelectorAll('[data-style]')]) {
    const style = Object.assign({}, ...[JSON.parse((node as HTMLElement).dataset.style!)].flat().filter(Boolean));
    expect(style.maxWidth).toBeUndefined();
    expect(style.flexShrink ?? 0).toBeLessThanOrEqual(0);
  }
  await act(async () => quota.click());
  expect(refresh).toHaveBeenCalledOnce();
});
