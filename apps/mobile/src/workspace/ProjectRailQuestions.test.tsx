// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ProjectRail } from './ProjectRail';
import type { WorkspaceProject, WorkspaceRunPhase } from './workspaceTypes';
import { colors } from '../theme/tokens';

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  type Props = { children?: React.ReactNode; accessibilityLabel?: string; style?: unknown };
  const element = (tag: string) => ({ children, accessibilityLabel, style }: Props) => createElement(tag, { 'aria-label': accessibilityLabel, 'data-style': JSON.stringify(style) }, children);
  return { StyleSheet: { create: (styles: unknown) => styles }, Text: element('span'), View: element('div'), Pressable: element('button'),
    FlatList: ({ data, renderItem, ListHeaderComponent }: { data: WorkspaceProject[]; renderItem: (input: { item: WorkspaceProject; index: number }) => React.ReactNode; ListHeaderComponent: React.ReactNode }) => createElement('div', {}, ListHeaderComponent, data.map((item, index) => createElement('div', { key: item.id }, renderItem({ item, index })))) };
});

function render(runPhase?: WorkspaceRunPhase, unread = false, pending = true, fontScale = 1, compactDrawer = false, focused = true, focusedKey = 'root') {
  const project: WorkspaceProject = { id: 'root', sessionKey: 'root', name: 'A long project name', path: '', branch: '', starred: true, threadCount: 1, state: 'idle', unread, ...(runPhase ? { runPhase } : {}), ...(pending ? { pendingQuestions: { own: 1, total: 1, threads: 0 } } : {}) };
  const noop = () => {};
  const markup = renderToStaticMarkup(<ProjectRail projects={[project]} emptyLabel="empty" activeKey="root" focusedKey={focusedKey} focused={focused} fontScale={fontScale} reflowSuppressed={false} sortMode="manual" collapsedRootKeys={new Set()} onToggleSort={noop} onSelect={noop} onToggleFold={noop} onToggleStar={noop} onRefresh={noop} compactDrawer={compactDrawer} />);
  const dom = document.createElement('div'); dom.innerHTML = markup; return dom;
}

it.each([['running', '●'], ['waiting', '◆'], ['uncertain', '?'], ['failed', '●']] as const)('renders %s and a separate question slot in that order', (phase, symbol) => {
  const dom = render(phase);
  const card = dom.querySelector('button[aria-label^="A long project name"]')!;
  expect(card.getAttribute('aria-label')).toContain(', Question pending');
  expect(card.textContent).toContain(`${symbol}↩\uFE0E`);
  const marker = [...card.querySelectorAll('span')].find(node => node.textContent === '↩\uFE0E')!;
  expect(marker.getAttribute('data-style')).toContain(colors.purple);
});

it('renders unread alongside the question and does not infer questions from waiting or uncertain runs', () => {
  const dom = render(undefined, true);
  expect(dom.querySelector('[aria-label="Unread output"]')).not.toBeNull();
  expect(dom.textContent).toContain('↩\uFE0E');
  for (const phase of ['waiting', 'uncertain'] as const) expect(render(phase, false, false).textContent).not.toContain('↩');
});

it.each([0.75, 1.5])('keeps semantic slots, star and names at font scale %s for compact and full rails', scale => {
  for (const compact of [false, true]) {
    const dom = render('running', false, true, scale, compact);
    expect(dom.textContent).toContain('a long project name'); expect(dom.textContent).toContain('★');
    expect(dom.textContent).toContain('●↩\uFE0E');
    const marker = [...dom.querySelectorAll('span')].find(node => node.textContent === '↩\uFE0E')!;
    expect(marker.getAttribute('data-style')).toContain('"flexShrink":0');
  }
});

function markerColor(dom: HTMLElement): string {
  const marker = [...dom.querySelectorAll('span')].find(node => node.textContent === '↩\uFE0E')!;
  return Object.assign({}, ...JSON.parse(marker.getAttribute('data-style')!))['color'];
}

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/../g)!.map(part => parseInt(part, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

it.each([0.75, 1, 1.5])('keeps the question marker legible when rail focus changes at scale %s', scale => {
  for (const compact of [false, true]) {
    const focusedColor = markerColor(render('running', false, true, scale, compact));
    const ink = luminance(focusedColor), background = luminance(colors.activeAccent);
    expect((Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(markerColor(render('running', false, true, scale, compact, false))).toBe(colors.purple);
    expect(markerColor(render('running', false, true, scale, compact, true, 'other'))).toBe(colors.purple);
  }
});
