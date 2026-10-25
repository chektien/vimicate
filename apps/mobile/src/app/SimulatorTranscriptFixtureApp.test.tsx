// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppShellFixtureProps } from './appShellFixtures';

const probe = vi.hoisted(() => ({ props: {} as AppShellFixtureProps }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    View: ({ children }: { children?: React.ReactNode }) => createElement('div', {}, children),
    Text: ({ children }: { children?: React.ReactNode }) => createElement('span', {}, children),
    Pressable: ({ children, accessibilityLabel, onPress }: { children?: React.ReactNode; accessibilityLabel?: string; onPress?: () => void }) => createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress }, children),
    StyleSheet: { create: <T,>(styles: T) => styles },
  };
});
vi.mock('./AppShell', () => ({
  AppShell: (props: AppShellFixtureProps) => {
    useLayoutEffect(() => { probe.props = props; });
    return null;
  },
}));

import { SimulatorTranscriptFixtureApp } from './SimulatorTranscriptFixtureApp';
import { SIMULATOR_TRANSCRIPT_MARKERS } from './simulatorTranscriptFixtures';

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

describe('simulator transcript older-history fixture driver', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    probe.props = {};
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });
  afterEach(async () => {
    if (mounted) await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('holds each request for explicit native completion and then admits exactly one page', async () => {
    await act(async () => { root.render(<SimulatorTranscriptFixtureApp />); });
    const history = probe.props.fixtureOlderHistory!;
    let request: Promise<unknown>;
    await act(async () => { request = Promise.resolve(history.loadOlderHistory()); });
    expect(probe.props.fixtureOlderHistory?.loadingOlder).toBe(true);
    expect(probe.props.fixtureMessages?.some(message => message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.historyPageOneOldest))).toBe(false);
    const complete = container.querySelector<HTMLButtonElement>('button[aria-label="Complete simulator older-history request"]');
    expect(complete?.textContent).toContain('1 accepted');
    await act(async () => { complete?.click(); await request!; });
    expect(probe.props.fixtureOlderHistory?.loadingOlder).toBe(false);
    expect(probe.props.fixtureMessages?.some(message => message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.historyPageOneOldest))).toBe(true);
    expect(probe.props.fixtureMessages?.some(message => message.text.includes(SIMULATOR_TRANSCRIPT_MARKERS.historyPageTwoOldest))).toBe(false);
  });

  it('settles every owned pending request when the fixture unmounts', async () => {
    await act(async () => { root.render(<SimulatorTranscriptFixtureApp />); });
    const first = Promise.resolve(probe.props.fixtureOlderHistory!.loadOlderHistory());
    const second = Promise.resolve(probe.props.fixtureOlderHistory!.loadOlderHistory());
    await act(async () => { root.unmount(); });
    mounted = false;
    await Promise.all([first, second]);
  });
});
