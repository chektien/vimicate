// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ phase: 'failed' as 'failed' | 'decoded', retry: vi.fn() }));

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children, accessible, accessibilityRole, accessibilityLabel, accessibilityValue, accessibilityState, onPress, onAccessibilityTap, pointerEvents, disabled }: {
    children?: React.ReactNode;
    accessible?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityValue?: { text?: string };
    accessibilityState?: { disabled?: boolean };
    onPress?: (event: { stopPropagation: () => void }) => void;
    onAccessibilityTap?: () => void;
    pointerEvents?: string;
    disabled?: boolean;
  }) => {
    const semanticallyDisabled = Boolean(disabled || accessibilityState?.disabled);
    return createElement(accessibilityRole === 'button' ? 'button' : 'div', {
    role: accessibilityRole,
    'aria-label': accessibilityLabel,
    'aria-valuetext': accessibilityValue?.text,
    'aria-disabled': accessibilityState?.disabled,
    'data-accessible': String(accessible ?? accessibilityRole !== undefined),
    'data-pointer-events': pointerEvents,
    'data-has-press': String(Boolean(onPress)),
    'data-has-accessibility-tap': String(Boolean(onAccessibilityTap)),
      disabled: semanticallyDisabled,
      onClick: semanticallyDisabled ? undefined : (onPress ?? onAccessibilityTap),
    }, children);
  };
  return {
    View: Host,
    Text: Host,
    Pressable: Host,
    Image: (props: { onLoad?: () => void; onError?: () => void }) => createElement('img', props),
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1, absoluteFill: {} },
  };
});
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('./useGatewayImage', () => ({
  useGatewayImage: () => ({
    source: { uri: 'file:///fixture/obsolete-attempt.png' },
    phase: media.phase,
    imageKey: 1,
    retryImage: media.retry,
    onLoad: () => undefined,
    onError: () => undefined,
  }),
}));

import { TranscriptSourceRow } from './TranscriptSourceRow';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';

it('keeps media viewer and failed-image retry as separate accessible actions', async () => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  const openMedia = vi.fn();
  const message = {
    id: 'failed-media', role: 'assistant' as const, text: 'media result',
    attachments: [{
      id: 'obsolete', filename: 'obsolete-attempt.png',
      uri: 'file:///fixture/obsolete-attempt.png', mimeType: 'image/png',
      byteCount: 68, pixelWidth: 1, pixelHeight: 1,
    }],
  };
  const render = () => {
    const row = buildVisibleTranscriptRenderRows([message], new Set())[0]!;
    const navigation = createTranscriptVimState(createTranscriptBuffer([message]));
    return <TranscriptSourceRow
      row={row} navigation={navigation} focused fontScale={1} gutterWidth={32}
      sourceNavigationIndex={0} cursorNavigationIndex={0} onPress={() => {}}
      onToggleFold={() => {}} onApprovalDecision={() => {}} onOpenMedia={openMedia} onRecoverMessage={() => {}}
    />;
  };
  try {
    media.phase = 'failed';
    await act(async () => root.render(render()));
    const open = container.querySelector('[role="button"][aria-label="Open obsolete-attempt.png"]') as HTMLElement;
    const retry = container.querySelector('[role="button"][aria-label="Retry unavailable image obsolete-attempt.png"]') as HTMLElement;
    expect(open).not.toBeNull();
    expect(open.dataset.hasAccessibilityTap).toBe('true');
    expect(open.dataset.pointerEvents).toBe('none');
    expect(open.parentElement?.dataset.accessible).toBe('false');
    expect(retry).not.toBeNull();

    await act(async () => retry.click());
    expect(media.retry).toHaveBeenCalledTimes(1);
    expect(openMedia).not.toHaveBeenCalled();
    await act(async () => open.click());
    expect(openMedia).toHaveBeenCalledWith('obsolete');

    media.phase = 'decoded';
    await act(async () => root.render(render()));
    expect(container.querySelector('[role="button"][aria-label="Open obsolete-attempt.png"]')).not.toBeNull();
    expect(container.querySelector('[role="button"][aria-label="Retry unavailable image obsolete-attempt.png"]')).toBeNull();

    openMedia.mockClear();
    const disabledMessage = {
      ...message,
      id: 'disabled-media',
      attachments: [
        { id: 'missing', filename: 'missing.png', mimeType: 'image/png' },
        { id: 'nonimage', filename: 'notes.txt', uri: 'file:///fixture/notes.txt', mimeType: 'text/plain' },
      ],
    };
    const disabledRow = buildVisibleTranscriptRenderRows([disabledMessage], new Set())[0]!;
    const disabledNavigation = createTranscriptVimState(createTranscriptBuffer([disabledMessage]));
    await act(async () => root.render(<TranscriptSourceRow
      row={disabledRow} navigation={disabledNavigation} focused fontScale={1} gutterWidth={32}
      sourceNavigationIndex={0} cursorNavigationIndex={0} onPress={() => {}}
      onToggleFold={() => {}} onApprovalDecision={() => {}} onOpenMedia={openMedia} onRecoverMessage={() => {}}
    />));
    for (const filename of ['missing.png', 'notes.txt']) {
      const disabledOpen = container.querySelector(`[role="button"][aria-label="Open ${filename}"]`) as HTMLElement;
      expect(disabledOpen).not.toBeNull();
      expect(disabledOpen.getAttribute('aria-disabled')).toBe('true');
      expect(disabledOpen.dataset.hasAccessibilityTap).toBe('false');
      await act(async () => disabledOpen.click());
    }
    expect(openMedia).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    media.retry.mockReset();
  }
});

vi.mock('../questions/QuestionOtherEditor', () => ({ QuestionOtherEditor: () => null }));
