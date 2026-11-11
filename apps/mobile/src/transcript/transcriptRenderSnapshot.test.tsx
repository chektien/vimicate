// @vitest-environment jsdom
import React, { act, startTransition, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { TranscriptRenderRow } from './transcriptRenderRows';

type ListSnapshot = {
  data: TranscriptRenderRow[];
  getItemType?: (item: TranscriptRenderRow, index: number) => string;
  extraData: unknown;
  onRefresh?: () => void;
  refreshing?: boolean;
  ListFooterComponent?: React.ReactNode;
  renderItem: (input: { item: TranscriptRenderRow; index: number; extraData: unknown }) => React.ReactElement<{ style?: { paddingBottom?: number }; children: React.ReactNode }> | null;
};
const probe = vi.hoisted(() => ({ committed: null as ListSnapshot | null, attempts: 0 }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
  return { View: Host, Text: Host, Pressable: Host, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
});
vi.mock('@shopify/flash-list', async () => {
  const { forwardRef, useLayoutEffect } = await import('react');
  return { FlashList: forwardRef((props: ListSnapshot, _ref) => {
    probe.attempts++;
    useLayoutEffect(() => { probe.committed = props; });
    return null;
  }) };
});
vi.mock('./useTranscriptViewport', () => {
  const noop = () => undefined;
  const viewport = { list: { current: null }, reveal: noop, revealAfterRevision: noop,
    viewPositionForRow: noop, holdReviewAnchor: noop, captureReviewAnchor: noop,
    captureOlderHistoryAnchor: noop, retireUnchangedOlderHistoryAnchor: noop, onOlderHistoryLayoutCommit: noop };
  return { useTranscriptViewport: () => viewport };
});
vi.mock('./TranscriptSourceRow', () => ({ TranscriptSourceRow: () => null }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: () => undefined }));
import { TranscriptHistoryOmission } from './TranscriptHistoryOmission';
import { TranscriptDateDivider } from './TranscriptDateDivider';
import { TranscriptPane, type TranscriptPaneHandle } from './TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';

const noop = () => undefined;
let root: Root;
let pending: Promise<never>;
const handle = React.createRef<TranscriptPaneHandle>();
function PendingSibling({ suspend }: { suspend: boolean }) { if (suspend) throw pending; return null; }
function Scene({ messages, suspend = false, session = 'a', onSelect = noop, onLoadOlder = noop, canLoadOlder = false, loadingOlder = false, archived = false, onLoadNewer }: { messages: WorkspaceMessage[]; suspend?: boolean; session?: string; onSelect?: () => void; onLoadOlder?: () => void; canLoadOlder?: boolean; loadingOlder?: boolean; archived?: boolean; onLoadNewer?: () => unknown }) {
  const buffer = createTranscriptBuffer(messages);
  return <Suspense fallback={<div>pending</div>}><TranscriptPane onLoadNewer={onLoadNewer} hasNewerHistory={archived} onJumpToLatest={noop} ref={handle} datasetKey={session} messages={messages}
    buffer={buffer} navigation={createTranscriptVimState(buffer)} focused fontScale={1}
    onFocus={noop} onSelect={onSelect} onNavigationProjection={noop} onViewportReview={noop}
    onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop}
    canLoadOlder={canLoadOlder} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder} onRetryHistory={noop} />
    <PendingSibling suspend={suspend} /></Suspense>;
}
function row(snapshot: ListSnapshot, index = 0) {
  const child = snapshot.renderItem({ item: snapshot.data[index]!, index, extraData: snapshot.extraData })?.props.children as React.ReactElement<{ row: TranscriptRenderRow }> | undefined;
  return child?.props.row;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  probe.committed = null; probe.attempts = 0;
  pending = new Promise<never>(() => {});
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const answer = (id: string, text: string): WorkspaceMessage => ({ id, role: 'assistant', text });

describe('transcript recycler presentation snapshot', () => {
  it.each(['text revision', 'history prepend', 'session replacement'] as const)(
    'keeps committed rows coherent during a suspended %s', async (change) => {
      const initial = [answer('first', 'Original answer'), answer('second', 'Second answer')];
      await act(async () => root.render(<Scene messages={initial} />));
      const committed = probe.committed!;
      const original = row(committed);
      const attempts = probe.attempts;
      const next = change === 'text revision' ? [answer('first', 'Longer replacement\nwith another line'), initial[1]!]
        : change === 'history prepend' ? [answer('older', 'Older history'), ...initial]
          : [answer('foreign', 'Other session')];
      await act(async () => startTransition(() => root.render(<Scene messages={next} suspend session={change === 'session replacement' ? 'b' : 'a'} />)));
      expect(probe.attempts).toBeGreaterThan(attempts);
      expect(probe.committed).toBe(committed); // React retained the old visible tree.
      expect(row(committed)).toBe(original);
      expect(row(committed)?.key).toBe(committed.data[0]?.key);
      expect(row(committed)?.compiled.source).toBe('Original answer');
    },
  );

  it('separates question-cell measurements from ordinary lines using the same current presentation as rendering', async () => {
    const messages = [answer('body', 'First line\nSecond line')];
    await act(async () => root.render(<Scene messages={messages} />));
    const initial = probe.committed!;
    expect(initial.getItemType).toBeTypeOf('function');
    const types = (snapshot: ListSnapshot) => snapshot.data.map((item, index) => snapshot.getItemType!(item, index));
    expect(types(initial)).toEqual(['source', 'source']);
    const updated = [{ ...messages[0]!, asyncQuestion: { itemId: 'optional', questions: [{ title: 'Optional question', options: ['Yes'] }] } }];
    await act(async () => startTransition(() => root.render(<Scene messages={updated} suspend />)));
    expect(probe.committed).toBe(initial);
    expect(types(initial)).toEqual(['source', 'source']);
    await act(async () => root.render(<Scene messages={updated} />));
    expect(probe.committed!.data).toBe(initial.data);
    expect(types(probe.committed!)).toEqual(['source', 'question']);
    expect(types(initial)).toEqual(['source', 'source']);
  });

  it('publishes fresh text on the next commit while preserving ordered-key topology', async () => {
    await act(async () => root.render(<Scene messages={[answer('same', 'Before')]} />));
    const previous = probe.committed!;
    await act(async () => root.render(<Scene messages={[answer('same', 'After')]} />));
    expect(probe.committed?.data).toBe(previous.data);
    expect(row(probe.committed!)?.compiled.source).toBe('After');
    expect(row(previous)?.compiled.source).toBe('Before');
  });

  it('exposes deliberate native pull refresh without automatic near-top ownership', async () => {
    const load = vi.fn();
    await act(async () => root.render(<Scene messages={[answer('same', 'Before')]} canLoadOlder onLoadOlder={load} />));
    expect(probe.committed?.onRefresh).toBeTypeOf('function');
    expect(probe.committed?.refreshing).toBe(false);
    await act(async () => probe.committed?.onRefresh?.());
    expect(load).toHaveBeenCalledOnce();
  });

  it('uses the date separator design after the older cell without shifting retained text within its cell', async () => {
    let finish!: () => void;
    const load = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const retained = answer('retained', 'Previously loaded top');
    await act(async () => root.render(<Scene messages={[retained, answer('tail', 'Tail')]} canLoadOlder onLoadOlder={load} />));
    await act(async () => probe.committed?.onRefresh?.());
    await act(async () => root.render(<Scene messages={[retained, answer('tail', 'Tail')]} canLoadOlder loadingOlder onLoadOlder={load} />));
    await act(async () => root.render(<Scene messages={[answer('older', 'Older page'), retained, answer('tail', 'Tail')]} canLoadOlder onLoadOlder={load} />));
    const snapshot = probe.committed!;
    const index = snapshot.data.findIndex(item => item.message.id === 'older' && item.lastInMessage);
    const cell = snapshot.renderItem({ item: snapshot.data[index]!, index, extraData: snapshot.extraData });
    const fragment = cell?.props.children as React.ReactElement<{ children: React.ReactNode }>;
    const boundary = React.Children.toArray(fragment.props.children)[1] as React.ReactElement<{ accessibilityLabel?: string; label?: string }>;
    expect(boundary.type).toBe(TranscriptDateDivider);
    expect(boundary.props.label).toBe('Previously loaded');
    expect(boundary.props.accessibilityLabel).toBe('Older history boundary');
    const retainedIndex = snapshot.data.findIndex(item => item.message.id === 'retained' && item.firstInMessage);
    expect(row(snapshot, retainedIndex)?.message.id).toBe('retained');
    expect(snapshot.extraData).toMatchObject({ boundaryMessageIDs: ['retained'] });
    finish();
  });

  it('keeps imperative keyboard navigation on the committed projection during suspension', async () => {
    const initial = [answer('first', 'First'), answer('second', 'Second')];
    await act(async () => root.render(<Scene messages={initial} />));
    expect(handle.current?.navigationSourceRows()).toEqual([0, 1]);
    await act(async () => startTransition(() => root.render(<Scene messages={[answer('first', 'First\nNew line'), initial[1]!]} suspend />)));
    expect(handle.current?.navigationSourceRows()).toEqual([0, 1]);
  });

  it('keeps the current fold target until a session replacement commits', async () => {
    const tool: WorkspaceMessage = { id: 'tool', role: 'tool', text: 'read file\nresult' };
    await act(async () => root.render(<Scene messages={[tool]} />));
    expect(handle.current?.foldAtSourceRow(0)?.messageId).toBe('tool');
    await act(async () => startTransition(() => root.render(<Scene messages={[answer('other', 'Other session')]} session="b" suspend />)));
    expect(handle.current?.foldAtSourceRow(0)?.messageId).toBe('tool');
  });

  it('opens an interior disclosure through the committed fold target and row tap', async () => {
    const message = answer('reply', 'Answer\n<details><summary>Sources</summary>\n- one\n</details>\nAfter');
    await act(async () => root.render(<Scene messages={[message]} />));
    expect(handle.current?.navigationSourceRows()).toEqual([0, 1, 4]);
    const target = handle.current?.foldAtSourceRow(2);
    expect(target).toMatchObject({ messageId: 'reply:details:1', sourceRow: 1, expanded: false });
    const snapshot = probe.committed!;
    const cell = snapshot.renderItem({ item: snapshot.data[1]!, index: 1, extraData: snapshot.extraData });
    const disclosure = cell?.props.children as React.ReactElement<{ onToggleFold: () => void }>;
    await act(async () => disclosure.props.onToggleFold());
    expect(handle.current?.foldAtSourceRow(1)).toMatchObject({ messageId: target?.messageId, expanded: true });
    expect(handle.current?.navigationSourceRows()).toEqual([0, 1, 2, 4]);
    await act(async () => handle.current?.setFoldExpanded(target!.messageId, false, 1));
    expect(handle.current?.navigationSourceRows()).toEqual([0, 1, 4]);
  });

  it('dispatches visible row actions to committed callbacks, not a suspended replacement', async () => {
    const before = vi.fn(); const after = vi.fn();
    const messages = [answer('same', 'Visible answer')];
    await act(async () => root.render(<Scene messages={messages} onSelect={before} />));
    const committed = probe.committed!;
    const element = committed.renderItem({ item: committed.data[0]!, index: 0, extraData: committed.extraData });
    await act(async () => startTransition(() => root.render(<Scene messages={messages} onSelect={after} suspend />)));
    (element?.props.children as React.ReactElement<{ onPress: () => void }> | undefined)?.props.onPress();
    expect(before).toHaveBeenCalledOnce();
    expect(after).not.toHaveBeenCalled();
  });
});

it('measures the bottom gap inside only the final current-history cell, including append and archive transitions', async () => {
  const first = answer('first', 'First answer');
  const second = answer('second', 'Second answer');
  const padding = () => { const s = probe.committed!; return s.data.map((item, index) => s.renderItem({ item, index, extraData: s.extraData })?.props.style?.paddingBottom ?? 0); };
  await act(async () => root.render(<Scene messages={[first]} />));
  expect(padding()).toEqual([24]); expect(probe.committed!.ListFooterComponent).toBeNull();
  await act(async () => root.render(<Scene messages={[first, second]} />));
  expect(padding()).toEqual([0, 24]);
  await act(async () => root.render(<Scene messages={[first, second]} archived />));
  expect(padding()).toEqual([0, 0]); expect(probe.committed!.ListFooterComponent).not.toBeNull();
  await act(async () => root.render(<Scene messages={[first, second]} />));
  expect(padding()).toEqual([0, 24]);
});


it('does not activate the native pull-to-refresh control while loading forward history at the bottom', async () => {
  const messages = [answer('edge', 'Review edge')];
  let release!: () => void;
  const work = new Promise<void>(resolve => { release = resolve; });
  const onLoadNewer = () => work;
  await act(async () => root.render(<Scene messages={messages} archived onLoadNewer={onLoadNewer} />));
  await act(async () => { handle.current!.requestNewerHistory(); });
  await act(async () => root.render(<Scene messages={messages} archived loadingOlder onLoadNewer={onLoadNewer} />));
  expect(probe.committed!.refreshing).toBe(false);
  expect(probe.committed!.onRefresh).toBeUndefined();
  await act(async () => { release(); await work; });
});

it('exposes a real-identity omission as an accessible older action without a canonical row', async () => {
  const load = vi.fn();
  const prompt = { ...answer('prompt', 'Context'), role: 'user' as const };
  const tail = { ...answer('tail', 'Retained tail'), historyOmission: { promptMessageId: prompt.id, firstTailMessageId: 'tail' } };
  await act(async () => root.render(<Scene messages={[prompt, tail]} canLoadOlder onLoadOlder={load} />));
  const snapshot = probe.committed!;
  expect(snapshot.data.map(row => row.message.id)).toEqual(['prompt', 'tail']);
  const cell = snapshot.renderItem({ item: snapshot.data[0]!, index: 0, extraData: snapshot.extraData });
  const fragment = cell?.props.children as React.ReactElement<{ children: React.ReactNode }>;
  const action = React.Children.toArray(fragment.props.children)[1] as React.ReactElement<{ onLoadOlder: () => void }>;
  expect(action.type).toBe(TranscriptHistoryOmission);
  await act(async () => action.props.onLoadOlder());
  expect(load).toHaveBeenCalledOnce();
});
