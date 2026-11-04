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
  return { Animated: { Value: class { constructor(public value: number) {} }, Text: element('span'), View: element('div') }, StyleSheet: { create: (styles: unknown) => styles }, Text: element('span'), View: element('div'), Pressable: element('button'),
    FlatList: ({ data, renderItem, ListHeaderComponent }: { data: WorkspaceProject[]; renderItem: (input: { item: WorkspaceProject; index: number }) => React.ReactNode; ListHeaderComponent: React.ReactNode }) => createElement('div', {}, ListHeaderComponent, data.map((item, index) => createElement('div', { key: item.id }, renderItem({ item, index })))) };
});

function render(runPhase?: WorkspaceRunPhase, unread = false, pending = true, fontScale = 1, compactDrawer = false, focused = true, focusedKey = 'root') {
  const project: WorkspaceProject = { id: 'root', sessionKey: 'root', name: 'A long project name', path: '', branch: '', starred: true, threadCount: 1, state: 'idle', unread, ...(runPhase ? { runPhase } : {}), ...(pending ? { pendingQuestions: { own: 1, total: 1, threads: 0 } } : {}) };
  const noop = () => {};
  const markup = renderToStaticMarkup(<ProjectRail projects={[project]} emptyLabel="empty" activeKey="root" focusedKey={focusedKey} focused={focused} fontScale={fontScale} reflowSuppressed={false} sortMode="manual" collapsedRootKeys={new Set()} onToggleSort={noop} onSelect={noop} onToggleFold={noop} onToggleStar={noop} onRefresh={noop} compactDrawer={compactDrawer} />);
  const dom = document.createElement('div'); dom.innerHTML = markup; return dom;
}

it.each([['running', '●'], ['waiting', '●'], ['needs-user', '◆'], ['uncertain', '?'], ['failed', '●']] as const)('renders %s and a separate question slot in that order', (phase, symbol) => {
  const dom = render(phase);
  const card = dom.querySelector('button[aria-label^="A long project name"]')!;
  expect(card.getAttribute('aria-label')).toContain(', Question pending');
  const status = card.querySelector('[aria-label]')!;
  expect(status).not.toBeNull();
  if (symbol !== '●') expect(status.textContent).toBe(symbol);
  const marker = [...card.querySelectorAll('span')].find(node => node.textContent === '↩\uFE0E')!;
  expect(status.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(dom.querySelector('[aria-label="running"]')).not.toBeNull();
    expect(dom.textContent).toContain('↩\uFE0E');
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

it.each([['running', colors.orange], ['needs-user', colors.purple], ['uncertain', colors.faint], ['failed', colors.red]] as const)('keeps %s colour without a backing on keyboard-selected cards', (phase, colour) => {
  const dom = render(phase, false, false);
  const glyph = dom.querySelector(`[aria-label="${phase === 'needs-user' ? 'needs approval' : phase === 'uncertain' ? 'connection uncertain' : phase}"]`)!;
  expect(glyph.getAttribute('data-style')).toContain(colour);
  const slot = JSON.parse(glyph.parentElement!.getAttribute('data-style')!);
  expect(slot.backgroundColor).toBeUndefined();
  expect(slot.borderWidth).toBeUndefined();
  expect(slot.alignItems).toBe('center');
  expect(slot.justifyContent).toBe('center');
  if (phase === 'running' || phase === 'failed') {
    expect(glyph.tagName).toBe('DIV');
    expect(glyph.textContent).toBe('');
  }
});

it('keeps the pulse trough distinguishable on normal, active and dimmed cards', () => {
  const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(part => parseInt(part, 16));
  const blend = (front: string, back: string, alpha: number) => '#' + rgb(front).map((v, i) => Math.round(v * alpha + rgb(back)[i]! * (1-alpha)).toString(16).padStart(2, '0')).join('');
  for (const background of ['#242525', colors.canvas]) {
    for (const dim of [0, 0.18]) {
      const pulse = blend(colors.orange, background, 0.55);
      const foregroundLuma = luminance(blend(colors.canvas, pulse, dim));
      const backgroundLuma = luminance(blend(colors.canvas, background, dim));
      expect((foregroundLuma + 0.05) / (backgroundLuma + 0.05)).toBeGreaterThanOrEqual(3);
    }
  }
});

it('includes unread output in the card announcement after completion', () => {
  const dom = render('completed', true, false);
  expect(dom.querySelector('button[aria-label^="A long project name"]')!.getAttribute('aria-label')).toContain('idle, unread output');
});
