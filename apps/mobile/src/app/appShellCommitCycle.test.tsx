// @vitest-environment jsdom
import React, { act, startTransition, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presentWorkspaceProjects } from '../workspace/workspacePresentation';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';

// Exercise real React commits, AppShell hooks, TranscriptPane projection and
// the viewport hook. DOM host stubs do not simulate Fabric/recycler geometry.
const probe = vi.hoisted(() => ({
  gateway: {} as Record<string, unknown>,
  questionScope: false, questionRecords: [] as import('../questions/questionTypes').QuestionRecord[],
  showUpdateNotes: vi.fn(() => 'update notes opened'),
  commandBar: {} as Parameters<typeof import('../ui/WorkspaceCommandBar').WorkspaceCommandBar>[0],
  restores: 0, promptSending: false,
  prompt: {} as Parameters<typeof import('../prompt/PromptPane').PromptPane>[0],
  renderNativePrompt: false, nativeEditorState: '', nativeNavigationCommand: '',
  attachmentPayloads: vi.fn<() => Promise<import('../prompt/promptAttachments').GatewayPromptAttachment[]>>(), attachmentClear: vi.fn(),
  transmittedAttachments: [] as import('../prompt/promptAttachments').GatewayPromptAttachment[][],
  promptAttachments: [] as Parameters<typeof import('../prompt/PromptPane').PromptPane>[0]['attachments'],
  rail: {} as Record<string, unknown>,
  header: {} as Record<string, unknown>, paneControls: {} as Record<string, unknown>, status: {} as Record<string, unknown>, projectFiles: null as null | Parameters<typeof import('../projectFiles/ProjectFilesPane').ProjectFilesPane>[0],
  mediaViewer: null as null | Parameters<typeof import('../transcript/TranscriptMediaViewer').TranscriptMediaViewer>[0],
  transcriptLinkOpener: null as null | import('../transcript/TranscriptLinkOpener').TranscriptLinkOpener,
  nativeLink: vi.fn(),
  sharedResolve: vi.fn(), sharedList: vi.fn(), sharedRead: vi.fn(), locatedRequest: vi.fn(),
  appStateListeners: new Set<(state: string) => void>(),
  storage: new Map<string, string>(),
  commandHistory: [] as string[],
  paired: false, registry: null as Record<string, unknown> | null,
  historyReply: null as null | ((key: string, limit: number, offset: number) => Record<string, unknown>),
  renders: 0,
  isPad: true, viewport: { width: 1200, height: 900 },
  hardwareKey: null as null | ((event: { key: string; control?: boolean; command?: boolean; shift?: boolean; isRepeat?: boolean }) => void),
  scrolls: [] as number[],
  offsets: [] as number[], renderRows: false, flashProps: {} as Record<string, unknown>,
  sessions: [] as Record<string, unknown>[],
  requests: [] as Record<string, unknown>[],
  sends: [] as { sessionKey: string; body: string }[],
  updateMessages: null as null | ((key: string, action: React.SetStateAction<WorkspaceMessage[]>) => void),
  client: null as null | { onEvent?: (event: unknown) => void },
}));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
  return {
    View: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => createElement('div', { 'aria-label': accessibilityLabel }, children), ScrollView: Host, Text: Host, Pressable: ({ children, onPress, accessibilityLabel }: { children?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
    Platform: { OS: 'ios', get isPad() { return probe.isPad; } },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    useWindowDimensions: () => ({ ...probe.viewport, scale: 2, fontScale: 1 }),
    AppState: { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => { probe.appStateListeners.add(listener); return { remove() { probe.appStateListeners.delete(listener); } }; } },
  };
});
vi.mock('react-native-safe-area-context', async () => ({ SafeAreaView: (await import('react-native')).View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../../modules/vimicate-editor', async () => {
  const { createElement } = await import('react');
  return { PromptDropSurface: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children), default: { setClipboardText: vi.fn() }, VimicateEditorView: ({ editorState, navigationCommand }: { editorState: string; navigationCommand?: string }) => {
    probe.nativeEditorState = editorState;
    probe.nativeNavigationCommand = navigationCommand ?? '';
    return createElement('div', { 'data-testid': 'native-editor' });
  } };
});
vi.mock('expo-symbols', async () => ({ SymbolView: (await import('react-native')).View }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn(), latestFatalDiagnostic: () => null, recentViewportDiagnostics: () => [] }));
vi.mock('../gateway/useGatewayWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gateway/useGatewayWorkspace')>();
  return { useGatewayWorkspace: (...args: Parameters<typeof actual.useGatewayWorkspace>) => {
    const gateway = actual.useGatewayWorkspace(...args);
    probe.gateway = gateway;
    return gateway;
  } };
});
vi.mock('../gateway/useGatewayHistory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gateway/useGatewayHistory')>();
  return { useGatewayHistory: (...args: Parameters<typeof actual.useGatewayHistory>) => {
    const history = actual.useGatewayHistory(...args);
    probe.updateMessages = history.updateSessionMessages;
    return history;
  } };
});
vi.mock('expo-secure-store', () => ({ AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'fixture', getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixture-id' }));
vi.mock('../gateway/deviceIdentity', () => ({ resetLocalDeviceIdentityIfSimulator: async () => {} }));
vi.mock('../gateway/sharedPairing', () => ({ loadSharedGatewayProfile: async () => { probe.restores++; return probe.paired ? { url: 'ws://fixture.invalid' } : null; }, saveSharedPairedProfile: async () => {}, reattachSharedPairing: async () => {}, detachSharedPairing: async () => {} }));
vi.mock('../gateway/OpenClawClient', () => ({ OpenClawClient: class {
  status = 'idle';
  onStatus?: (status: string) => void;
  onEvent?: (event: unknown) => void;
  constructor() { probe.client = this; }
  async connect() { this.status = 'connected'; this.onStatus?.('connected'); }
  disconnect() { this.status = 'idle'; this.onStatus?.('idle'); }
  hasOperatorScope(scope: string) { return scope === 'operator.questions' && probe.questionScope; }
  async listSessions() { return { sessions: probe.sessions.map(row => ({ ...row })) }; }
  async request(method: string, params: Record<string, unknown>) {
    probe.requests.push({ method, ...params });
    if (method === 'question.list') return { questions: probe.questionRecords };
    if (method === 'question.resolve') { probe.questionRecords = probe.questionRecords.filter(q => q.id !== params.id); return { status: params.cancel ? 'cancelled' : 'answered', ...(params.answers ? { answers: params.answers } : {}) }; }
    if (method.startsWith('vimicate.files.')) return probe.locatedRequest(method, params);
    const row = probe.sessions.find(row => row.key === params.key);
    if (!row || row.sessionId !== params.expectedSessionId) throw new Error('Session changed');
    if ((row.markedUnreadAt ?? null) !== params.expectedMarkedUnreadAt) return { applied: false };
    row.unread = false; row.lastReadAt = Date.now(); row.updatedAt = Math.max(Number(row.updatedAt ?? 0), Date.now()); delete row.markedUnreadAt;
    return { applied: true };
  }
  async readRegistry() { return probe.registry ?? { version: 1, projects: [] }; }
  async listCommands() { return { commands: [] }; }
  async listProjectFiles(projectId: string, path: string) { return { projectId, path, entries: [] }; }
  async readProjectFile() { throw new Error('No fixture file'); }
  resolveSharedFile(sourcePath: string) { return probe.sharedResolve(sourcePath); }
  listSharedFiles(projectId: string, path: string) { return probe.sharedList(projectId, path); }
  readSharedFile(projectId: string, path: string) { return probe.sharedRead(projectId, path); }
  async listModels() { return { models: [] }; }
  async listApprovals() { return { approvals: [] }; }
  async providerUsage() { return {}; }
  async followSession() {}
  async send(sessionKey: string, body: string, attachments: import('../prompt/promptAttachments').GatewayPromptAttachment[] = []) { probe.transmittedAttachments.push(attachments); probe.sends.push({ sessionKey, body }); return { runId: `sent-${probe.sends.length}` }; }
  async history(key: string, limit: number, offset: number) { if (probe.historyReply) return probe.historyReply(key, limit, offset); return { sessionKey: 'agent:test:main', messages: [{ id: 'initial', role: 'assistant', content: 'Ready.' }] }; }
  decorateMessages(messages: WorkspaceMessage[]) { return messages; }
} }));
vi.mock('../storage/workspaceStore', () => ({
  loadValue: async (key: string) => probe.storage.get(key) ?? null, saveValue: async (key: string, value: string) => { probe.storage.set(key, value); },
  loadDraft: async () => '', saveDraft: async () => {},
  loadPromptHistory: async () => [], appendPromptHistory: async () => {},
  loadCommandHistory: async () => [...probe.commandHistory],
  appendCommandHistory: async (command: string) => {
    if (probe.commandHistory.at(-1) !== command) probe.commandHistory = [...probe.commandHistory.slice(-99), command];
  },
  setWorkspacePersistenceActive: () => {},
  saveTranscriptCache: async () => {}, loadTranscriptCache: async () => null,
  saveHistoryReviewCache: async () => {}, loadHistoryReviewCache: async () => null,
}));
vi.mock('../prompt/usePromptAttachmentController', () => ({ usePromptAttachmentController: () => ({ attachments: probe.promptAttachments, snapshot: () => probe.promptAttachments, isImporting: () => false, payloads: probe.attachmentPayloads, clear: probe.attachmentClear }) }));
vi.mock('../updates/useAppUpdateNotice', () => ({ useAppUpdateNotice: () => ({ showNotes: probe.showUpdateNotes }) }));
vi.mock('@shopify/flash-list', async () => {
  const { createElement, forwardRef, useImperativeHandle, useLayoutEffect } = await import('react');
  return { FlashList: forwardRef((props: Record<string, unknown>, ref) => {
    probe.renders += 1;
    useLayoutEffect(() => { probe.flashProps = props; });
    useImperativeHandle(ref, () => ({
      getLayout: () => undefined, getAbsoluteLastScrollOffset: () => 0,
      getWindowSize: () => ({ width: 900, height: 500 }), getChildContainerDimensions: () => ({ height: 2000 }), getFirstItemOffset: () => 0,
      scrollToIndex: async ({ index }: { index: number }) => { probe.scrolls.push(index); }, scrollToOffset: async ({ offset }: { offset: number }) => { probe.offsets.push(offset); },
    }), []);
    return createElement('div', { 'data-testid': 'transcript' }, String((props.data as unknown[]).length), props.ListFooterComponent as React.ReactNode, probe.renderRows ? (props.data as unknown[]).map((_, index) => createElement('span', { key: index }, (props.renderItem as (input: { index: number }) => React.ReactNode)({ index }))) : null);
  }) };
});
vi.mock('../transcript/openTranscriptLink', () => ({ openTranscriptLink: probe.nativeLink, transcriptLinkAccessibilityHint: () => 'Native file handling', transcriptLinkAccessibilityLabel: () => 'Open link' }));
vi.mock('../transcript/TranscriptSourceRow', async () => { const { createElement } = await import('react'); const { useTranscriptLinkOpener } = await import('../transcript/TranscriptLinkOpener'); return { TranscriptSourceRow: ({ row, onPress }: { row: { sourceRow: number }; onPress: () => void }) => { probe.transcriptLinkOpener = useTranscriptLinkOpener(); return createElement('button', { 'data-testid': `row-${row.sourceRow}`, onClick: onPress }); } }; });
vi.mock('../gateway/PairingBar', () => ({ PairingBar: ({ paneControls, helpControl }: { paneControls?: React.ReactNode; helpControl?: React.ReactNode }) => <>{helpControl}{paneControls}</> }));
vi.mock('../prompt/PromptPane', async (importOriginal) => {
  const { createElement, useLayoutEffect } = await import('react');
  const actual = await importOriginal<typeof import('../prompt/PromptPane')>();
  return { PromptPane: (props: Parameters<typeof import('../prompt/PromptPane').PromptPane>[0]) => {
    useLayoutEffect(() => { probe.hardwareKey = event => props.onHardwareKey({ shift: false, control: false, option: false, command: false, ...event }); probe.promptSending = props.sending; probe.prompt = props; });
    return probe.renderNativePrompt ? createElement(actual.PromptPane, props) : null;
  } };
});
vi.mock('../workspace/ProjectRail', () => ({ ProjectRail: (props: Record<string, unknown>) => { probe.rail = props; return null; } }));
vi.mock('../ui/StatusLine', () => ({ StatusLine: (props: Record<string, unknown>) => { probe.status = props; return null; } }));
vi.mock('../ui/WorkspaceHeader', () => ({ WorkspaceHeader: (props: Record<string, unknown>) => { probe.header = props; return null; } }));
vi.mock('../ui/WorkspacePaneControls', () => ({ WorkspacePaneControls: (props: Record<string, unknown>) => { probe.paneControls = props; return null; } }));
vi.mock('../projectFiles/ProjectFilesPane', () => ({ ProjectFilesPane: (props: Parameters<typeof import('../projectFiles/ProjectFilesPane').ProjectFilesPane>[0]) => { probe.projectFiles = props; return null; } }));
vi.mock('../ui/WorkspaceCommandBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/WorkspaceCommandBar')>();
  return { WorkspaceCommandBar: (props: Parameters<typeof actual.WorkspaceCommandBar>[0]) => { probe.commandBar = props; return null; } };
});
vi.mock('../updates/AppUpdateNotice', () => ({ AppUpdateNotice: () => null }));
vi.mock('../layout/WorkspaceDivider', () => ({ WorkspaceDivider: () => null }));
vi.mock('../layout/CompactProjectDrawer', () => ({ CompactProjectDrawer: () => null }));
vi.mock('../transcript/TranscriptMediaViewer', () => ({ TranscriptMediaViewer: (props: Parameters<typeof import('../transcript/TranscriptMediaViewer').TranscriptMediaViewer>[0]) => { probe.mediaViewer = props; return <div data-testid="media-viewer" />; } }));
vi.mock('../layout/SoftwareKeyboardViewport', async () => ({ SoftwareKeyboardViewport: (await import('react-native')).View }));
vi.mock('../ui/PaneFontPinchSurface', async () => ({ PaneFontPinchSurface: (await import('react-native')).View }));
vi.mock('./BottomSafeAreaChrome', async () => ({ BottomSafeAreaChrome: (await import('react-native')).View }));

import { AppShell } from './AppShell';
import { acceptNativeText, createPromptState } from '../prompt/vimPromptCore';
import { promptWithProjectContext } from '../gateway/projectPromptContext';
const expectedPromptBody = (body: string) => promptWithProjectContext(body, (probe.gateway.projects as WorkspaceProject[]).find(project => project.sessionKey === 'agent:test:main'));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('React', React);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  probe.showUpdateNotes.mockClear(); probe.nativeLink.mockReset(); probe.transcriptLinkOpener = null;
  probe.sharedResolve.mockReset(); probe.sharedList.mockReset(); probe.sharedRead.mockReset(); probe.locatedRequest.mockReset();
  probe.gateway = {}; probe.rail = {}; probe.header = {}; probe.paneControls = {}; probe.projectFiles = null; probe.mediaViewer = null; probe.storage.clear(); probe.commandHistory = []; probe.paired = false; probe.registry = null; probe.appStateListeners.clear();
  probe.client = null; probe.questionScope = false; probe.questionRecords = [];
  probe.isPad = true; probe.viewport = { width: 1200, height: 900 };
  probe.renders = 0; probe.restores = 0; probe.promptSending = false; probe.renderNativePrompt = false; probe.nativeEditorState = ''; probe.nativeNavigationCommand = '';
  probe.hardwareKey = null; probe.scrolls = []; probe.offsets = []; probe.renderRows = false; probe.flashProps = {};
  probe.sessions = [{ key: 'agent:test:main', displayName: 'test' }];
  probe.requests = []; probe.sends = []; probe.promptAttachments = []; probe.historyReply = null;
  probe.attachmentPayloads.mockReset().mockResolvedValue([]); probe.attachmentClear.mockReset(); probe.transmittedAttachments = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function rows(count: number): WorkspaceMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`, role: 'tool', text: `read file ${index}\nresult\nmore detail`,
    tool: { name: 'read', summary: `read file ${index}` },
  }));
}

describe('AppShell React commit convergence', () => {
  it('bridges Ctrl-U/D to scoped native prompt paging without editing text or undo', async () => {
    probe.renderNativePrompt = true;
    await act(async () => root.render(<AppShell fixtureMessages={rows(20)} />));
    await act(async () => probe.prompt.onRequestPromptFocus());
    const state = { ...createPromptState('one very long wrapped line '.repeat(100)), undo: [{ text: 'older draft', selection: { start: 0, end: 0 } }] };
    await act(async () => probe.prompt.onState(state));
    for (const [key, expected] of [['u', 'halfPageUp'], ['d', 'halfPageDown']] as const) {
      await act(async () => probe.hardwareKey!({ key, control: true }));
      expect(JSON.parse(probe.nativeNavigationCommand)).toMatchObject({ key: expected, scope: probe.prompt.sessionKey, editorRevision: JSON.parse(probe.nativeEditorState).revision });
      expect(probe.prompt.state.text).toBe(state.text);
      expect(probe.prompt.state.undo).toBe(state.undo);
      expect(probe.prompt.state.pending).toBe('');
    }
    expect(probe.sends).toEqual([]);
  });

  it('retains transcript, command-line and prompt-history ownership of Ctrl-U/D', async () => {
    await act(async () => root.render(<AppShell fixtureMessages={rows(20)} />));
    await act(async () => probe.hardwareKey!({ key: 'u', control: true }));
    await act(async () => probe.hardwareKey!({ key: 'd', control: true }));
    expect(probe.prompt.navigationRequest).toBeNull();
    await act(async () => probe.prompt.onRequestPromptFocus());
    await act(async () => probe.hardwareKey!({ key: ':' }));
    await act(async () => probe.hardwareKey!({ key: 'u', control: true }));
    await act(async () => probe.hardwareKey!({ key: 'd', control: true }));
    expect(probe.prompt.navigationRequest).toBeNull();
    await act(async () => probe.hardwareKey!({ key: 'escape' }));
    await act(async () => probe.prompt.onToggleHistory());
    expect(probe.prompt.historyBrowser.open).toBe(true);
    await act(async () => probe.hardwareKey!({ key: 'u', control: true }));
    await act(async () => probe.hardwareKey!({ key: 'd', control: true }));
    expect(probe.prompt.navigationRequest).toBeNull();
  });

  it('routes nonblocking async questions through the originating message and ordinary chat keyboard path', async () => {
    probe.registry = { projects: { markdown: '## Test\n- id: test\n- backend: openclaw\n- session: agent:test:main' } };
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.pair as (text: string) => Promise<void>)('ws://127.0.0.1:18789'); });
    await act(async () => { await (probe.gateway.connect as () => Promise<void>)(); });
    const wire = { role: 'assistant', content: 'Which route?', openclawAsyncDelivery: { itemId: 'async-real', questions: [{ title: 'Which route?', options: ['One', 'Two'] }] }, __openclaw: { id: 'async-source', runId: 'async-origin' } };
    await act(async () => probe.client!.onEvent!({ event: 'session.message', payload: { message: wire } }));
    expect((probe.gateway.messages as WorkspaceMessage[]).some(row => row.asyncQuestion)).toBe(false);
    probe.historyReply = () => ({ sessionKey: 'agent:test:main', messages: [{ id: 'initial', role: 'assistant', content: 'Ready.' }, wire] });
    await act(async () => probe.client!.onEvent!({ event: 'session.message', payload: { sessionKey: 'agent:test:main', message: wire } }));
    expect((probe.gateway.messages as WorkspaceMessage[]).filter(row => row.asyncQuestion)).toHaveLength(1);
    expect(probe.prompt.focusedPane).toBe('prompt'); expect(probe.sends).toEqual([]);
    await act(async () => probe.hardwareKey!({ key: 'k', control: true }));
    await act(async () => probe.hardwareKey!({ key: 'G' }));
    await act(async () => probe.hardwareKey!({ key: 'j' }));
    expect(probe.sends).toEqual([]); // Explicitly enter the question; do not submit its default.
    await act(async () => probe.hardwareKey!({ key: '2' })); expect(probe.sends).toEqual([]);
    const asyncOwner = probe.gateway.asyncQuestions as ReturnType<typeof import('../gateway/useAsyncGatewayQuestions').useAsyncGatewayQuestions>; const asyncRow = (probe.gateway.messages as WorkspaceMessage[]).find(row => row.asyncQuestion)!;
    expect(asyncOwner.loaded).toBe(true); expect(asyncOwner.ui.draft(asyncOwner.view(asyncRow)!.record).selected['0']).toEqual(['Two']);
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(probe.sends).toEqual([]); // Enter chooses the highlighted option, never sends the default.
    await act(async () => probe.hardwareKey!({ key: '/' }));
    for (const key of 'route') await act(async () => probe.hardwareKey!({ key }));
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    const currentAsync = () => probe.gateway.asyncQuestions as typeof asyncOwner;
    expect(currentAsync().ui.interaction).toBeNull(); // Even a same-anchor search returns to text.
    await act(async () => probe.hardwareKey!({ key: 'j' }));
    expect(currentAsync().ui.interaction).toBe(asyncOwner.view(asyncRow)!.record.id);
    await act(async () => probe.hardwareKey!({ key: 'k' }));
    expect(currentAsync().ui.interaction).toBeNull();
    await act(async () => probe.hardwareKey!({ key: 'j' }));

    await act(async () => probe.hardwareKey!({ key: 'tab' }));
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(probe.sends).toEqual([{ sessionKey: 'agent:test:main', body: '> Which route?\n\nTwo' }]);
    expect(probe.requests.some(row => row.method === 'question.resolve')).toBe(false);
  });

  it('routes scoped Gateway questions through committed transcript keyboard ownership without sending chat', async () => {
    probe.questionScope = true;
    probe.registry = { projects: { markdown: '## Test\n- id: test\n- backend: openclaw\n- session: agent:test:main' } };
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    const question: import('../questions/questionTypes').QuestionRecord = { id: 'input-regression', sessionKey: 'agent:test:main', runId: 'input-run', createdAtMs: Date.now(), expiresAtMs: Date.now() + 60000, status: 'pending', questions: [{ questionId: 'route', header: 'Route', question: 'Choose a route', options: [{ label: 'One' }, { label: 'Two' }] }] };
    probe.questionRecords = [question];
    await act(async () => probe.client!.onEvent!({ event: 'question.requested', payload: { ...question, sessionKey: undefined } }));
    expect((probe.gateway.messages as WorkspaceMessage[]).some(row => row.question)).toBe(false);
    await act(async () => probe.client!.onEvent!({ event: 'question.requested', payload: { ...question, id: 'another-session', sessionKey: 'agent:test:other' } }));
    expect((probe.gateway.messages as WorkspaceMessage[]).some(row => row.question)).toBe(false);
    await act(async () => probe.client!.onEvent!({ event: 'question.requested', payload: question }));
    expect((probe.gateway.messages as WorkspaceMessage[]).filter(row => row.question)).toHaveLength(1);
    const questionControls = probe.gateway.questions as { editing: (record: import('../questions/questionTypes').QuestionRecord, active: boolean) => void };
    await act(async () => questionControls.editing(question, true));
    expect(probe.prompt.keyboardCapture).toBe(false);
    await act(async () => questionControls.editing(question, false));
    expect(probe.prompt.keyboardCapture).toBe(true);
    await act(async () => probe.hardwareKey!({ key: 'k', control: true }));
    await act(async () => probe.hardwareKey!({ key: 'G' }));
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(probe.requests.filter(row => row.method === 'question.resolve')).toEqual([]);
    await act(async () => probe.hardwareKey!({ key: '2' }));
    await act(async () => probe.hardwareKey!({ key: 'tab' }));
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(probe.requests.filter(row => row.method === 'question.resolve')).toEqual([{ method: 'question.resolve', id: question.id, answers: { answers: { route: ['Two'] } }, resolvedBy: 'Vimicate' }]);
    expect((probe.gateway.messages as WorkspaceMessage[]).find(row => row.question)?.text).toBe('Question answered · Two');
    expect(probe.sends).toEqual([]);
  });

  it('extends prompt visual selection through hardware search and repeat without changing the draft', async () => {
    probe.renderNativePrompt = true;
    await act(async () => root.render(<AppShell />));
    const draft = 'alpha beta test gamma test';
    await act(async () => probe.prompt.onState(createPromptState(draft)));
    const key = async (value: string) => { await act(async () => probe.hardwareKey!({ key: value })); };
    await key('0'); await key('w'); await key('v');
    expect(probe.prompt.state).toMatchObject({ visualMode: 'character', visualAnchor: 6, visualCursor: 6, selection: { start: 6, end: 7 } });
    for (const value of ['/', ...'test', 'enter']) await key(value);
    expect(probe.prompt.state).toMatchObject({ text: draft, visualMode: 'character', visualAnchor: 6, visualCursor: 11, selection: { start: 6, end: 12 } });
    expect(JSON.parse(probe.nativeEditorState)).toMatchObject({ text: draft, selectionStart: 6, selectionEnd: 12 });
    await key('n');
    expect(probe.prompt.state).toMatchObject({ visualAnchor: 6, visualCursor: 22, selection: { start: 6, end: 23 } });
    await key('N');
    expect(probe.prompt.state).toMatchObject({ visualAnchor: 6, visualCursor: 11, selection: { start: 6, end: 12 } });
    for (const value of ['/', ...'missing', 'enter']) await key(value);
    expect(probe.prompt.state).toMatchObject({ text: draft, visualAnchor: 6, visualCursor: 11, selection: { start: 6, end: 12 } });
    await key('?'); await key('escape');
    expect(probe.prompt.commandLineActive).toBe(false);
    expect(probe.prompt.state).toMatchObject({ visualAnchor: 6, visualCursor: 11, selection: { start: 6, end: 12 } });
    expect(probe.sends).toEqual([]);
  });

  it('searches backward from the visual cursor, including reverse selections and n/N', async () => {
    await act(async () => root.render(<AppShell />));
    const draft = 'alpha beta test gamma test';
    await act(async () => probe.prompt.onState(createPromptState(draft)));
    const key = async (value: string) => { await act(async () => probe.hardwareKey!({ key: value })); };
    await key('0');
    for (let index = 0; index < 4; index += 1) await key('w');
    await key('v');
    for (const value of ['?', ...'test', 'enter']) await key(value);
    expect(probe.prompt.state).toMatchObject({ text: draft, visualAnchor: 22, visualCursor: 11, selection: { start: 11, end: 23 } });
    await key('n');
    expect(probe.prompt.state).toMatchObject({ visualAnchor: 22, visualCursor: 22, selection: { start: 22, end: 23 } });
    await key('N');
    expect(probe.prompt.state).toMatchObject({ visualAnchor: 22, visualCursor: 11, selection: { start: 11, end: 23 } });
    expect(probe.sends).toEqual([]);
  });
  it('passes the mounted fold state into real older-history page admission', async () => {
    probe.renderRows = true;
    const transcript = Array.from({ length: 401 }, (_, index) => ({ id: `fold-page-${index}`,
      role: 'tool', content: `tool ${index}\nresult ${index}`, timestamp: 1_800_000_000_000 + index }));
    const offsets: number[] = [];
    probe.historyReply = (sessionKey, limit, offset) => {
      offsets.push(offset);
      const end = transcript.length - offset;
      const messages = transcript.slice(Math.max(0, end - limit), end);
      const next = offset + messages.length;
      return { sessionKey, messages, totalMessages: transcript.length,
        hasMore: next < transcript.length, nextOffset: next < transcript.length ? next : null };
    };
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    expect(offsets).toEqual([0]);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="row-0"]')!.click(); });
    await act(async () => { (probe.flashProps.onRefresh as () => void)(); });
    expect(offsets).toEqual([0, 80]);
    expect((probe.gateway.messages as WorkspaceMessage[]).length).toBe(160);
    expect(probe.gateway.canLoadOlder).toBe(true);
  });

  it.each(['enter', 'button'])('sends a pasted diagnostics report via %s after fast Escape before React commits', async (route) => {
    probe.paired = true;
    await act(async () => root.render(<AppShell />));
    await act(async () => probe.hardwareKey!({ key: 'i' }));
    expect(probe.prompt.state.mode).toBe('insert');
    const report = ':diagnostics — retained fatal breadcrumb\nat=1789888492883 fatal.native Maximum update depth exceeded\nFlashList @ index.js:90343:7\n[diagnostic shortened]est';
    const authority = probe.prompt.state.authority;
    const hardware = probe.prompt.onHardwareKey;
    await act(async () => {
      // Native Escape carries the full text snapshot, even if paste's text
      // callback has not arrived. No React commit between Escape and Send.
      hardware({ key: 'escape', shift: false, control: false, option: false, command: false,
        text: report, selectionStart: report.length, selectionEnd: report.length, textAuthority: authority });
      if (route === 'enter') hardware({ key: 'enter', shift: false, control: false, option: false, command: false });
      else probe.prompt.onSubmit();
    });
    expect(probe.sends).toEqual([{ sessionKey: 'agent:test:main', body: expectedPromptBody(report) }]);
    expect(probe.prompt.state.text).toBe('');
    // A delayed paste acknowledgement cannot resurrect the submitted text.
    await act(async () => probe.prompt.onState(current => acceptNativeText(current, report,
      { start: report.length, end: report.length }, authority)));
    expect(probe.prompt.state.text).toBe('');
    await act(async () => {
      probe.prompt.onState(current => acceptNativeText(current, 'test', { start: 4, end: 4 }));
      probe.prompt.onSubmit();
    });
    expect(probe.sends.map(send => send.body)).toEqual([expectedPromptBody(report), expectedPromptBody('test')]);
  });

  it.each([':verbose off', ':progress off', ':thread-sort activity', ':update-notes', ':new', ':repair'])(
    'does not execute a multiline prompt beginning with %s', async (header) => {
      probe.paired = true;
      await act(async () => root.render(<AppShell />));
      const body = `${header}\nThis is quoted output to discuss, not a command.`;
      await act(async () => {
        probe.prompt.onState(current => acceptNativeText(current, body, { start: body.length, end: body.length }));
        probe.prompt.onSubmit();
      });
      expect(probe.sends).toEqual([{ sessionKey: 'agent:test:main', body: expectedPromptBody(body) }]);
      expect(probe.prompt.state.text).toBe('');
      expect(probe.showUpdateNotes).not.toHaveBeenCalled();
    },
  );

  it('allows attachments with a pasted report but preserves the explicit-command attachment gate', async () => {
    probe.paired = true;
    probe.promptAttachments = [{ id: 'screenshot', kind: 'image', filename: 'screenshot.png', uri: 'file:///fixture/screenshot.png', mimeType: 'image/png', byteCount: 68 }];
    await act(async () => root.render(<AppShell />));
    await act(async () => {
      probe.prompt.onState(current => acceptNativeText(current, ':diagnostics', { start: 12, end: 12 }));
      probe.prompt.onSubmit();
    });
    expect(probe.sends).toEqual([]);
    expect(probe.prompt.state.text).toBe(':diagnostics');
    const report = ':diagnostics — retained fatal breadcrumb\nat=1789888492883';
    await act(async () => {
      probe.prompt.onState(current => acceptNativeText(current, report, { start: report.length, end: report.length }));
      probe.prompt.onSubmit();
    });
    expect(probe.sends).toEqual([{ sessionKey: 'agent:test:main', body: expectedPromptBody(report) }]);
    expect(probe.prompt.state.text).toBe('');
  });

  it.each(['', 'review this image'])('does not start media preparation when scene admission rejects text=%j', async text => {
    probe.paired = true;
    probe.attachmentPayloads.mockImplementationOnce(() => Promise.reject(new Error('synthetic attachment read rejected')));
    probe.promptAttachments = [{ id: 'image', kind: 'image', filename: 'image.png', uri: 'file:///synthetic/image.png', mimeType: 'image/png', byteCount: 1 }];
    await act(async () => root.render(<AppShell />));
    await act(async () => probe.prompt.onState(createPromptState(text)));
    await act(async () => { for (const listener of probe.appStateListeners) listener('inactive'); });
    await act(async () => probe.prompt.onSubmit());
    expect(probe.attachmentPayloads).not.toHaveBeenCalled();
    expect(probe.attachmentClear).not.toHaveBeenCalled();
    expect(probe.sends).toEqual([]);
    expect(probe.prompt.state.text).toBe(text);
  });

  it('consumes only the submitted media snapshot after preparation and acceptance', async () => {
    probe.paired = true;
    const first = { id: 'first', kind: 'image' as const, filename: 'first.png', uri: 'file:///synthetic/first.png', mimeType: 'image/png', byteCount: 1 };
    const later = { ...first, id: 'later', uri: 'file:///synthetic/later.png' };
    const submitted = [first]; probe.promptAttachments = submitted;
    let resolve!: (value: import('../prompt/promptAttachments').GatewayPromptAttachment[]) => void;
    probe.attachmentPayloads.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await act(async () => root.render(<AppShell />));
    await act(async () => probe.prompt.onSubmit());
    expect(probe.attachmentClear).not.toHaveBeenCalled();
    probe.promptAttachments = [first, later];
    await act(async () => root.render(<AppShell />));
    await act(async () => resolve([{ ...first, dataBase64: 'AQ==' }]));
    expect(probe.sends).toHaveLength(1);
    expect(probe.attachmentClear).toHaveBeenCalledExactlyOnceWith('agent:test:main', submitted);
  });

  it.each(['', 'review both'])('captures synchronously staged media before the next React commit for text=%j', async text => {
    probe.paired = true;
    const first = { id: 'first', kind: 'image' as const, filename: 'first.png', uri: 'file:///synthetic/first.png', mimeType: 'image/png', byteCount: 1 };
    const added = { ...first, id: 'added', uri: 'file:///synthetic/added.png' };
    probe.promptAttachments = text ? [first] : [];
    probe.attachmentPayloads.mockImplementation(async () => probe.promptAttachments.map(item => ({ ...item, dataBase64: 'AQ==' })));
    await act(async () => root.render(<AppShell />));
    // Native staging updates its owner synchronously, before React commits a new array.
    const intended = [first, added];
    await act(async () => {
      probe.prompt.onState(createPromptState(text));
      probe.promptAttachments = intended;
      probe.prompt.onSubmit();
    });
    expect(probe.transmittedAttachments).toEqual([intended.map(item => ({ ...item, dataBase64: 'AQ==' }))]);
    expect(probe.attachmentPayloads).toHaveBeenCalledExactlyOnceWith('agent:test:main', intended);
    expect(probe.attachmentClear).toHaveBeenCalledExactlyOnceWith('agent:test:main', intended);
  });

  it('keeps attachment pickers available beyond four and stops at the shared ten-item capacity', async () => {
    const attachments = Array.from({ length: 10 }, (_, i) => ({ id: `image-${i}`, kind: 'image' as const, filename: `${i}.png`, uri: `file:///fixture/${i}.png`, mimeType: 'image/png', byteCount: 68 }));
    for (const count of [4, 9, 10, 3]) {
      await act(async () => root.render(<AppShell fixtureMessages={[]} fixturePromptAttachments={attachments.slice(0, count)} />));
      expect(probe.prompt.attachments).toHaveLength(count);
      expect(probe.prompt.attachmentLimitReached).toBe(count === 10);
    }
  });

  it('keeps prompt navigation working after handing off code and deleting its first two lines', async () => {
    const text = '```text\nReview the returned results.\nPreserve the original files.\n```';
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text }]} />));
    await act(async () => { probe.hardwareKey!({ key: 'i' }); });
    expect(probe.prompt.focusedPane).toBe('prompt');
    expect(probe.prompt.state.text).toContain('Below is the code');
    // Deliver a burst before React commits, exercising the synchronous prompt
    // owner rather than relying on a render between the two d keypresses.
    await act(async () => { for (const key of ['escape', 'g', 'g', 'd', 'd', 'd', 'd']) probe.hardwareKey!({ key }); });
    expect(probe.prompt.state).toMatchObject({ text, mode: 'normal', pending: '', selection: { start: 0, end: 0 } });
    await act(async () => { probe.hardwareKey!({ key: 'j' }); });
    expect(probe.prompt.state.selection.end).toBe(text.indexOf('Review'));
    await act(async () => { probe.hardwareKey!({ key: 'k' }); });
    expect(probe.prompt.state.selection.end).toBe(0);
    expect(probe.prompt.focusedPane).toBe('prompt');
  });

  it('restores the Example Research child conversation and its rail cursor across warm and cold foreground', async () => {
    const rootKey = 'agent:main:direct:vimicate-ios:project:example-research';
    const childKey = 'agent:main:dashboard:example-topic';
    probe.paired = true;
    probe.sessions = [{ key: rootKey }, { key: childKey, label: 'example review' }];
    probe.registry = { projects: { markdown: `## Example Research\n- id: example-research\n- backend: openclaw\n- session: ${rootKey}` },
      threads: { json: JSON.stringify({ threads: [{ threadID: 'durable-example-topic', parentProjectID: 'example-research', label: 'example review', state: 'active', currentBinding: { stableSessionKey: childKey } }] }) } };
    probe.storage.set('workspace.selectedSessionKey', JSON.stringify({ sessionKey: childKey, projectID: 'durable-example-topic' }));
    probe.historyReply = (sessionKey) => ({ sessionKey, messages: [{ id: sessionKey, role: 'assistant', content: sessionKey === childKey ? 'Child answer' : 'Root answer' }] });
    await act(async () => root.render(<AppShell />));
    expect(probe.gateway.selectedKey).toBe(childKey);
    expect(probe.gateway.messageSessionKey).toBe(childKey);
    expect(probe.rail.focusedKey).toBe(childKey);
    // A reconnect census may omit the child or report newer root activity;
    // neither is permission to replace the durable child selection.
    probe.sessions = [{ key: rootKey, updatedAt: Date.now() }];
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const state of ['inactive', 'background', 'active']) await act(async () => { [...probe.appStateListeners].forEach(listener => listener(state)); });
      expect(probe.gateway.selectedKey).toBe(childKey);
      expect(probe.gateway.messageSessionKey).toBe(childKey);
      expect(probe.rail.focusedKey).toBe(childKey);
    }
    expect(JSON.parse(probe.storage.get('workspace.selectedSessionKey')!)).toEqual({ sessionKey: childKey, projectID: 'durable-example-topic' });
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<AppShell />));
    expect(probe.gateway.selectedKey).toBe(childKey);
    expect(probe.gateway.messageSessionKey).toBe(childKey);
    expect(probe.rail.focusedKey).toBe(childKey);
  });

  it('recalls submitted colon commands through native and hardware routes without executing them', async () => {
    await act(async () => root.render(<AppShell />));
    for (const key of [':', ...'update-notes', 'enter', ':', ...'noh', 'enter', ':', ...'unfinished']) await act(async () => { probe.hardwareKey?.({ key }); });
    expect(probe.showUpdateNotes).toHaveBeenCalledOnce();
    await act(async () => probe.commandBar.onHistory(-1));
    expect(probe.commandBar.command?.query).toBe('noh');
    await act(async () => probe.hardwareKey?.({ key: 'up' }));
    expect(probe.commandBar.command?.query).toBe('update-notes');
    expect(probe.showUpdateNotes).toHaveBeenCalledOnce();
    await act(async () => probe.commandBar.onHistory(1));
    await act(async () => probe.commandBar.onHistory(1));
    expect(probe.commandBar.command?.query).toBe('unfinished');
    await act(async () => probe.commandBar.onHistory(-1));
    await act(async () => probe.commandBar.onQueryChange('edited'));
    await act(async () => probe.commandBar.onHistory(1));
    expect(probe.commandBar.command?.query).toBe('edited');
    await act(async () => probe.commandBar.onCancel());
    await act(async () => probe.hardwareKey?.({ key: ':' }));
    await act(async () => probe.commandBar.onHistory(-1));
    expect(probe.commandBar.command?.query).toBe('noh');
    await act(async () => probe.commandBar.onHistory(-1));
    await act(async () => probe.commandBar.onSubmit());
    expect(probe.showUpdateNotes).toHaveBeenCalledTimes(2);
    for (const key of ['/', ...'search']) await act(async () => { probe.hardwareKey?.({ key }); });
    await act(async () => probe.commandBar.onHistory(-1));
    expect(probe.commandBar.search?.query).toBe('search');
    await act(async () => probe.commandBar.onCancel());
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<AppShell />));
    await act(async () => probe.hardwareKey?.({ key: ':' }));
    await act(async () => probe.commandBar.onHistory(-1));
    expect(probe.commandBar.command?.query).toBe('update-notes');
    expect(probe.showUpdateNotes).toHaveBeenCalledTimes(2);
  });

  it('dispatches :update-notes locally without submitting a prompt or changing the transcript', async () => {
    await act(async () => root.render(<AppShell />));
    const messages = probe.gateway.messages;
    const requestCount = probe.requests.length;
    for (const key of [':', ...'update-notes', 'enter']) await act(async () => { probe.hardwareKey?.({ key }); });
    expect(probe.showUpdateNotes).toHaveBeenCalledOnce();
    expect(probe.gateway.messages).toBe(messages);
    expect(probe.requests).toHaveLength(requestCount);
  });

  it.each(['j', 'touch'] as const)('continues across a review end without skipping to latest (%s)', async (input) => {
    probe.renderRows = true;
    const time = 1_788_000_000_000;
    const transcript = Array.from({ length: 1200 }, (_, index) => ({ id: `forward-${index}`, role: 'user',
      content: `Message ${index}\nSecond line\nThird line`, timestamp: time + index * 1000 }));
    probe.historyReply = (sessionKey, limit, offset) => ({ sessionKey, totalMessages: transcript.length,
      hasMore: offset + limit < transcript.length, nextOffset: offset + limit < transcript.length ? offset + limit : null,
      messages: transcript.slice(Math.max(0, transcript.length - offset - limit), transcript.length - offset) });
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    for (let page = 0; page < 12 && (probe.gateway.messages as WorkspaceMessage[]).some(row => row.id === 'forward-1199'); page++) {
      await act(async () => { await (probe.gateway.loadOlderHistory as () => Promise<void>)(); });
    }
    for (let page = 0; page < 2; page++) await act(async () => { await (probe.gateway.loadOlderHistory as () => Promise<void>)(); });
    const before = probe.gateway.messages as WorkspaceMessage[];
    const edge = before.at(-1)!;
    const edgeIndex = Number(edge.id.split('-')[1]);
    expect(edgeIndex).toBeLessThan(1199);
    const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid^="row-"]');
    await act(async () => { buttons[buttons.length - 1]!.click(); });
    if (input === 'j') await act(async () => { probe.hardwareKey!({ key: 'j' }); });
    else await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Load newer transcript history"]')!.click(); });
    const after = probe.gateway.messages as WorkspaceMessage[];
    const at = after.findIndex(row => row.id === edge.id);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(after[at + 1]?.id).toBe(`forward-${edgeIndex + 1}`);
    expect(after.at(-1)?.id).not.toBe('forward-1199');
    const extra = probe.flashProps.extraData as { navigation: { cursor: { row: number }; followTail: boolean }; rowGeneration: { sourceRow: number; message: WorkspaceMessage }[] };
    expect(extra.navigation.followTail).toBe(false);
    expect(extra.rowGeneration.find(row => row.sourceRow === extra.navigation.cursor.row)?.message.id).toBe(edge.id);
    await act(async () => { probe.hardwareKey!({ key: 'j' }); });
    expect((probe.flashProps.extraData as typeof extra).navigation.cursor.row).toBeGreaterThan(extra.navigation.cursor.row);
  });

  it.each(['button', 'footer', 'G'] as const)('keeps an explicit way to the real end after deep upward pagination without new prose (%s)', async (input) => {
    probe.renderRows = true;
    probe.sessions.push({ key: 'agent:test:other', displayName: 'other' });
    const time = 1_788_000_000_000;
    const transcript = Array.from({ length: 960 }, (_, index) => ({ id: `deep-${index}`,
      role: index % 4 === 0 ? 'user' : 'assistant', content: `Message ${index}\nSecond line\nThird line`, timestamp: time + index * 1000 }));
    probe.historyReply = (sessionKey, limit, offset) => ({ sessionKey, totalMessages: transcript.length,
      hasMore: offset + limit < transcript.length, nextOffset: offset + limit < transcript.length ? offset + limit : null,
      messages: transcript.slice(Math.max(0, transcript.length - offset - limit), transcript.length - offset) });
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    const sessionKey = probe.gateway.selectedKey as string;
    const newestID = (probe.gateway.messages as WorkspaceMessage[]).filter(row => row.role !== 'run').at(-1)!.id;
    expect(newestID).toBe('deep-959');
    const jump = () => container.querySelector<HTMLButtonElement>('[aria-label="Older history — jump to latest"]');
    expect(jump()).toBeNull();
    for (let page = 0; page < 12 && (probe.gateway.messages as WorkspaceMessage[]).some(row => row.id === newestID); page++) {
      await act(async () => { await (probe.gateway.loadOlderHistory as () => Promise<void>)(); });
    }
    expect((probe.gateway.messages as WorkspaceMessage[]).some(row => row.id === newestID)).toBe(false);
    expect((probe.gateway.latestMessages as WorkspaceMessage[]).some(row => row.id === newestID)).toBe(true);
    expect(container.querySelector('[aria-label="New responses — jump to latest"]')).toBeNull();
    expect(jump()).not.toBeNull();
    // Counted G belongs to the loaded document, never to backend latest restore.
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid^="row-"]')!.click(); });
    const beforeCountedEnd = (probe.gateway.messages as WorkspaceMessage[]).map(row => row.id);
    for (const key of ['9', '9', '9', '9', '9', 'G']) await act(async () => { probe.hardwareKey!({ key }); });
    expect((probe.gateway.messages as WorkspaceMessage[]).map(row => row.id)).toEqual(beforeCountedEnd);
    expect(jump()).not.toBeNull();
    expect(container.textContent).toContain('Newer messages are available');
    const reviewIDs = (probe.gateway.messages as WorkspaceMessage[]).map(row => row.id);
    await act(async () => { await (probe.gateway.refresh as () => Promise<void>)(); });
    expect((probe.gateway.messages as WorkspaceMessage[]).map(row => row.id)).toEqual(reviewIDs);
    expect(jump()).not.toBeNull();
    await act(async () => { (probe.gateway.selectProject as (key: string) => void)('agent:test:other'); });
    expect(jump()).toBeNull();
    await act(async () => { (probe.gateway.selectProject as (key: string) => void)(sessionKey); });
    expect((probe.gateway.messages as WorkspaceMessage[]).map(row => row.id)).toEqual(reviewIDs);
    expect(jump()).not.toBeNull();
    if (input === 'button') {
      const reply = probe.historyReply;
      probe.historyReply = () => { throw new Error('offline'); };
      await act(async () => { jump()!.click(); });
      expect((probe.gateway.messages as WorkspaceMessage[]).map(row => row.id)).toEqual(reviewIDs);
      expect(jump()).not.toBeNull();
      expect(container.textContent).toContain('Latest history unavailable');
      probe.historyReply = reply;
      await act(async () => { jump()!.click(); });
    } else if (input === 'footer') {
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Jump to latest transcript messages"]')!.click(); });
    } else {
      await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid^="row-"]')!.click(); });
      await act(async () => { probe.hardwareKey!({ key: 'G' }); });
    }
    expect((probe.gateway.messages as WorkspaceMessage[]).some(row => row.id === newestID)).toBe(true);
    expect(jump()).toBeNull();
    expect(container.textContent).not.toContain('Newer messages are available');
  });

  it('keeps the selected grouped-history cell and subsequent j/k motion through repeated prepends', async () => {
    probe.renderRows = true;
    const tool = (id: string): WorkspaceMessage => ({ id, role: 'tool', text: 'read\n' + 'detail\n'.repeat(1400), tool: { name: 'read', summary: 'Read' } });
    const after: WorkspaceMessage = { id: 'after', role: 'narration', text: 'After the calls' };
    let messages = [tool('c'), tool('d'), after];
    const render = async () => { await act(async () => root.render(<AppShell fixtureMessages={messages} />)); };
    type Extra = { navigation: { cursor: { row: number }; followTail: boolean }; rowGeneration: { key: string; sourceRow: number; message: WorkspaceMessage }[] };
    const extra = () => probe.flashProps.extraData as Extra;
    const selected = () => extra().rowGeneration.find(row => row.sourceRow === extra().navigation.cursor.row)!;
    const key = async (key: string) => { await act(async () => probe.hardwareKey!({ key })); };
    await render();
    await key('g'); await key('g');
    const original = selected().key;
    for (const id of ['b', 'a']) {
      messages = [tool(id), ...messages];
      await render();
      expect(selected().key).toBe(original);
      expect(extra().navigation.followTail).toBe(false);
      await key('j'); expect(selected().message.id).toBe('after');
      await key('k'); expect(selected().key).toBe(original);
    }
    messages = [{ id: 'older-preamble', role: 'narration', text: 'Before the calls' }, ...messages];
    await render(); expect(selected().key).toBe(original);
    expect(extra().navigation.cursor.row).toBe(1);
    await key('k'); expect(selected().message.id).toBe('older-preamble');
    await key('j'); expect(selected().key).toBe(original);
  });

  it.each([false, true])('holds touch review then lets New responses supersede scrolling (momentum=%s)', async momentum => {
    const messages: WorkspaceMessage[] = Array.from({ length: 20 }, (_, index) => ({ id: `prose-${index}`, role: 'assistant', text: `Plain prose ${index}` }));
    const render = async (rows: WorkspaceMessage[]) => { await act(async () => root.render(<AppShell fixtureMessages={rows} fixtureRunActive />)); };
    await render(messages);
    const content = (height: number) => (probe.flashProps.onContentSizeChange as (width: number, height: number) => void)(900, height);
    const event = (offset: number) => ({ nativeEvent: { contentOffset: { x: 0, y: offset }, contentSize: { width: 900, height: 2000 }, layoutMeasurement: { width: 900, height: 500 } } });
    await act(async () => {
      (probe.flashProps.onLayout as (event: unknown) => void)({ nativeEvent: { layout: { height: 500 } } });
      content(2000); await new Promise(resolve => setTimeout(resolve, 20));
      (probe.flashProps.onScrollBeginDrag as () => void)();
      (probe.flashProps.onScroll as (event: unknown) => void)(event(500));
      (probe.flashProps.onViewableItemsChanged as (event: unknown) => void)({ viewableItems: Array.from({ length: 10 }, (_, i) => ({ index: i + 5 })), changed: [] });
      (probe.flashProps.onScrollEndDrag as (event: unknown) => void)(event(500));
    });
    probe.offsets = []; probe.scrolls = [];
    expect(container.querySelector('[aria-label="New responses — jump to latest"]')).toBeNull();
    const preamble: WorkspaceMessage = { id: 'preamble', role: 'narration', text: 'Checking the next step' };
    await render([...messages, preamble]);
    await act(async () => { content(2200); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.offsets).toEqual([]); expect(probe.scrolls).toEqual([]);
    const notice = () => container.querySelector<HTMLButtonElement>('[aria-label="New responses — jump to latest"]');
    expect(notice()).not.toBeNull();
    await render([...messages, preamble, { id: 'final', role: 'assistant', text: 'Finished' }]);
    await act(async () => { content(2400); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.offsets).toEqual([]);
    if (momentum) await act(async () => {
      (probe.flashProps.onScrollBeginDrag as () => void)();
      (probe.flashProps.onScroll as (event: unknown) => void)({ nativeEvent: {
        ...event(700).nativeEvent, contentSize: { width: 900, height: 2400 },
      } });
      (probe.flashProps.onScrollEndDrag as (event: unknown) => void)({ nativeEvent: { velocity: { y: 2 } } });
      (probe.flashProps.onMomentumScrollBegin as () => void)();
    });
    await act(async () => { notice()!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.offsets).toContain(1900); expect(notice()).toBeNull();
    if (momentum) await act(async () => {
      (probe.flashProps.onMomentumScrollEnd as () => void)();
      expect((probe.flashProps.extraData as { navigation: { followTail: boolean } }).navigation.followTail).toBe(true);
    });
  });

  it.each([false, true])('dismisses new responses after manual bottom arrival (momentum=%s) without following later prose', async (momentum) => {
    let messages: WorkspaceMessage[] = Array.from({ length: 20 }, (_, index) => ({ id: `prose-${index}`, role: 'assistant', text: `Plain prose ${index}` }));
    const render = async () => { await act(async () => root.render(<AppShell fixtureMessages={messages} fixtureRunActive />)); };
    const notice = () => container.querySelector('[aria-label="New responses — jump to latest"]');
    const event = (y: number, velocity = 0) => ({ nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 900, height: 2000 }, layoutMeasurement: { width: 900, height: 500 }, velocity: { x: 0, y: velocity } } });
    const send = async (name: string, value?: unknown) => { await act(async () => (probe.flashProps[name] as (value?: unknown) => void)(value)); };
    await render();
    await send('onLayout', { nativeEvent: { layout: { height: 500 } } });
    await act(async () => { (probe.flashProps.onContentSizeChange as (w: number, h: number) => void)(900, 2000); await new Promise(resolve => setTimeout(resolve, 20)); });
    await send('onScrollBeginDrag'); await send('onScroll', event(500)); await send('onScrollEndDrag', event(500));
    messages = [...messages, { id: 'new', role: 'narration', text: 'New response' }]; await render();
    expect(notice()).not.toBeNull();
    // A passive bottom sample is not a reader acknowledgement.
    await send('onScroll', event(1500)); expect(notice()).not.toBeNull();
    await send('onScrollBeginDrag'); await send('onScroll', event(1450));
    await send('onScrollEndDrag', event(1450)); expect(notice()).not.toBeNull();
    await send('onScrollBeginDrag'); await send('onScroll', event(momentum ? 1450 : 1500));
    await send('onScrollEndDrag', event(momentum ? 1450 : 1500, momentum ? 2 : 0));
    if (momentum) { expect(notice()).not.toBeNull(); await send('onMomentumScrollBegin'); await send('onScroll', event(1500)); await send('onMomentumScrollEnd', event(1500)); }
    expect(notice()).toBeNull();
    await send('onViewableItemsChanged', { viewableItems: Array.from({ length: 5 }, (_, i) => ({ index: i + 16 })), changed: [] });
    probe.offsets = []; probe.scrolls = [];
    messages = messages.map(message => message.id === 'new' ? { ...message, text: 'New response grows' } : message); await render();
    await act(async () => { (probe.flashProps.onContentSizeChange as (w: number, h: number) => void)(900, 2200); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(notice()).not.toBeNull(); expect(probe.offsets).toEqual([]); expect(probe.scrolls).toEqual([]);
  });

  it('does not consume prose that arrived after the last manual scroll sample', async () => {
    probe.renderRows = true;
    let messages: WorkspaceMessage[] = [{ id: 'old', role: 'assistant', text: 'Old response' }];
    const render = async () => { await act(async () => root.render(<AppShell fixtureMessages={messages} />)); };
    const send = async (name: string, value?: unknown) => { await act(async () => (probe.flashProps[name] as (value?: unknown) => void)(value)); };
    const event = { nativeEvent: { contentOffset: { x: 0, y: 1500 }, contentSize: { width: 900, height: 2000 }, layoutMeasurement: { width: 900, height: 500 } } };
    const notice = () => container.querySelector('[aria-label="New responses — jump to latest"]');
    await render(); await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="row-0"]')!.click());
    messages = [...messages, { id: 'new', role: 'narration', text: 'New response' }]; await render();
    await send('onScrollBeginDrag'); await send('onScroll', event);
    messages = messages.map(message => message.id === 'new' ? { ...message, text: 'New response grows' } : message); await render();
    await send('onScrollEndDrag', event); expect(notice()).not.toBeNull();
    await send('onScrollBeginDrag'); await send('onScroll', event); await send('onScrollEndDrag', event);
    expect(notice()).toBeNull();
  });

  it('acknowledges new responses when j reaches latest without granting streaming tail ownership', async () => {
    probe.renderRows = true;
    let messages: WorkspaceMessage[] = Array.from({ length: 4 }, (_, index) => ({ id: `prose-${index}`, role: 'assistant', text: `Plain prose ${index}` }));
    const render = async () => { await act(async () => root.render(<AppShell fixtureMessages={messages} fixtureRunActive />)); };
    const key = async (key: string) => { await act(async () => { probe.hardwareKey!({ key }); await new Promise(resolve => setTimeout(resolve, 20)); }); };
    const notice = () => container.querySelector('[aria-label="New responses — jump to latest"]');
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="row-1"]')!.click());
    messages = [...messages, { id: 'new', role: 'narration', text: 'New response' }];
    await render(); expect(notice()).not.toBeNull();
    await key('j'); expect(notice()).not.toBeNull();
    await key('j'); expect(notice()).not.toBeNull();
    await key('j'); expect(notice()).toBeNull();
    await key('k'); expect(notice()).toBeNull();
    probe.offsets = [];
    messages = [...messages, { id: 'next', role: 'assistant', text: 'Another response' }];
    await render();
    expect(notice()).not.toBeNull(); expect(probe.offsets).toEqual([]);
    await key('j'); expect(notice()).not.toBeNull();
    await key('j'); expect(notice()).toBeNull();
    // Same-row streaming after acknowledgement is new prose, not permission to follow.
    messages = messages.map(message => message.id === 'next' ? { ...message, text: 'Another response grows' } : message);
    await render(); expect(notice()).not.toBeNull();
    await key('j'); expect(notice()).toBeNull();
    expect(probe.offsets).toEqual([]);
  });

  it('clears the notice at a folded tool tail using its visible navigation stop', async () => {
    probe.renderRows = true;
    const messages: WorkspaceMessage[] = [{ id: 'old', role: 'assistant', text: 'Old prose' }];
    await act(async () => root.render(<AppShell fixtureMessages={messages} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="row-0"]')!.click());
    await act(async () => root.render(<AppShell fixtureMessages={[...messages,
      { id: 'new', role: 'narration', text: 'New prose' }, ...rows(3)]} />));
    const notice = () => container.querySelector('[aria-label="New responses — jump to latest"]');
    expect(notice()).not.toBeNull();
    await act(async () => probe.hardwareKey!({ key: 'j' })); expect(notice()).not.toBeNull();
    await act(async () => probe.hardwareKey!({ key: 'j' })); expect(notice()).toBeNull();
  });

  it.each(['keyboard resize', 'content growth'])('plain-row touch owns review instead of letting %s follow the tail', async (change) => {
    probe.renderRows = true;
    const messages: WorkspaceMessage[] = Array.from({ length: 20 }, (_, index) => ({ id: `prose-${index}`, role: 'assistant', text: `Plain prose ${index}` }));
    await act(async () => root.render(<AppShell fixtureMessages={messages} />));
    const layout = (height: number) => (probe.flashProps.onLayout as (event: unknown) => void)({ nativeEvent: { layout: { width: 900, height } } });
    const content = (height: number) => (probe.flashProps.onContentSizeChange as (width: number, height: number) => void)(900, height);
    await act(async () => { content(2000); layout(500); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.offsets).toContain(1500); // Established tail-follow control.
    probe.offsets = [];
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="row-5"]')!.click(); });
    await act(async () => { change === 'keyboard resize' ? layout(300) : content(2200); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.offsets).toEqual([]);
    await act(async () => { probe.hardwareKey!({ key: 'G' }); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.offsets).toContain(1700); // Explicit latest navigation still owns tail following.
  });

  it.each([false, true])('reconciles provisional prompt order at a queued-run handoff (message burst: %s)', async (messageBurst) => {
    const sessionKey = 'agent:test:main';
    probe.registry = { projects: { markdown: `## Test\n- id: test\n- backend: openclaw\n- session: ${sessionKey}` } };
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    const oldAnswer: WorkspaceMessage = { id: 'old-answer', role: 'assistant', text: 'Earlier answer', source: 'history', runId: 'old-run', sessionKey, timestamp: '3000', displayPosition: { source: 'fixture', rawSeq: 10 } };
    await act(async () => probe.updateMessages!(sessionKey, [
      { id: 'local-question', idempotencyKey: 'question', role: 'user', text: 'Later question', source: 'local', runId: 'old-run', sessionKey, timestamp: '2000' }, oldAnswer,
    ]));
    const event = (runId: string, phase: string) => probe.client!.onEvent!({ event: 'agent', payload: { sessionKey, runId, stream: 'lifecycle', data: { phase } } });
    await act(async () => event('old-run', 'start'));
    let historyReads = 0;
    probe.historyReply = () => { historyReads++; return { sessionKey, messages: [
      { ...oldAnswer, content: oldAnswer.text, __openclaw: { transcriptPosition: oldAnswer.displayPosition } },
      { id: 'canonical-question', idempotencyKey: 'question:user', role: 'user', content: 'Later question', runId: 'next-run', timestamp: '2000', __openclaw: { transcriptPosition: { source: 'fixture', rawSeq: 20 } } },
    ] }; };
    probe.sessions = [{ key: sessionKey, hasActiveRun: true, activeRunIds: ['next-run'] }];
    await act(async () => {
      event('old-run', 'end');
      event('next-run', 'start');
      if (messageBurst) probe.client!.onEvent!({ event: 'session.message', payload: { sessionKey } });
      await new Promise(resolve => setTimeout(resolve, 180));
    });
    expect(historyReads).toBe(1);
    const messages = probe.gateway.messages as WorkspaceMessage[];
    expect(messages.filter(row => row.text === 'Later question')).toHaveLength(1);
    expect(messages.find(row => row.text === 'Later question')).toMatchObject({ id: 'canonical-question', source: 'history', runId: 'next-run' });
    expect(messages.findIndex(row => row.id === 'canonical-question')).toBeGreaterThan(messages.findIndex(row => row.id === 'old-answer'));
    expect(probe.gateway.sending).toBe(true);
    // Routine publication in the continuing run must still avoid history churn.
    await act(async () => {
      probe.client!.onEvent!({ event: 'session.message', payload: { sessionKey } });
      await new Promise(resolve => setTimeout(resolve, 180));
    });
    expect(historyReads).toBe(1);
  });

  it('does not append an older pending-final marker beneath a newer active run', async () => {
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    const sessionKey = probe.gateway.selectedKey as string;
    await act(async () => probe.updateMessages!(sessionKey, [
      { id: 'old-prompt', role: 'user', text: 'Earlier request', source: 'local', runId: 'old-run', sessionKey },
      { id: 'live-run-old-run', role: 'run', text: '… run completed · final answer pending', state: 'streaming', source: 'live', runId: 'old-run', sessionKey },
      { id: 'new-prompt', role: 'user', text: 'Current request', source: 'local', runId: 'current-run', sessionKey },
    ]));
    const event = (runId: string, phase: string) => probe.client!.onEvent!({ event: 'agent', payload: { sessionKey, runId, stream: 'lifecycle', data: { phase } } });
    await act(async () => event('current-run', 'start'));
    expect(probe.gateway.sending).toBe(true);
    expect((probe.gateway.messages as WorkspaceMessage[]).some(row => row.runId === 'old-run' && row.role === 'run')).toBe(false);
    await act(async () => event('old-run', 'end'));
    expect(probe.gateway.sending).toBe(true); // The lifecycle registry already rejects the stale terminal.
    expect((probe.gateway.messages as WorkspaceMessage[]).filter(row => row.runId === 'old-run' && row.role === 'run')).toEqual([]);
    await act(async () => event('current-run', 'end'));
    expect((probe.gateway.messages as WorkspaceMessage[]).some(row => row.runId === 'current-run' && row.text.includes('final answer pending'))).toBe(true);
  });

  it('stacks tools in the actual shell with independently clickable inner folds', async () => {
    probe.renderRows = true;
    const tool = (id: string): WorkspaceMessage => ({ id, role: 'tool', text: 'exec\ndetails' });
    let messages = [tool('first'), tool('second')];
    await act(async () => root.render(<AppShell fixtureMessages={messages} />));
    expect(container.querySelectorAll('[data-testid^="row-"]')).toHaveLength(1);
    await act(async () => (container.querySelector('[data-testid="row-0"]') as HTMLButtonElement).click());
    expect(container.querySelectorAll('[data-testid^="row-"]')).toHaveLength(3);
    await act(async () => (container.querySelector('[data-testid="row-1"]') as HTMLButtonElement).click());
    expect(container.querySelectorAll('[data-testid^="row-"]')).toHaveLength(4);
    messages = [...messages, tool('third')];
    await act(async () => root.render(<AppShell fixtureMessages={messages} />));
    expect(container.querySelectorAll('[data-testid^="row-"]')).toHaveLength(5);
    await act(async () => (container.querySelector('[data-testid="row-0"]') as HTMLButtonElement).click());
    expect(container.querySelectorAll('[data-testid^="row-"]')).toHaveLength(1);
    await act(async () => { probe.hardwareKey!({ key: 'enter' }); });
    expect(container.querySelectorAll('[data-testid^="row-"]')).toHaveLength(5);
  });

  it('applies a key on the retained transcript to its committed buffer during a suspended shrink', async () => {
    const pending = new Promise<never>(() => {});
    function Pause({ suspend }: { suspend: boolean }) { if (suspend) throw pending; return null; }
    function Scene({ messages, suspend = false }: { messages: WorkspaceMessage[]; suspend?: boolean }) {
      return <Suspense fallback={null}><AppShell fixtureMessages={messages} /><Pause suspend={suspend} /></Suspense>;
    }
    await act(async () => root.render(<Scene messages={rows(20).map(m => ({ ...m, role: 'narration' as const, text: m.id }))} />));
    await act(async () => { probe.hardwareKey!({ key: 'k' }); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.scrolls).toContain(18);
    const committedKey = probe.hardwareKey; const attempts = probe.renders;
    await act(async () => startTransition(() => root.render(<Scene messages={rows(2).map(m => ({ ...m, role: 'narration' as const, text: m.id }))} suspend />)));
    expect(probe.renders).toBeGreaterThan(attempts);
    expect(container.querySelector('[data-testid="transcript"]')?.textContent).toBe('20');
    expect(probe.hardwareKey).toBe(committedKey);
    probe.scrolls = [];
    await act(async () => { committedKey!({ key: 'k' }); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.scrolls).toEqual([17]);
  });

  it.each(['g', '2', 'y', 'z', '[', ']'])('does not scroll the reviewed transcript for unfinished command %s', async (prefix) => {
    await act(async () => root.render(<AppShell fixtureMessages={rows(20)} />));
    await act(async () => { probe.hardwareKey!({ key: 'k' }); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.scrolls.length).toBeGreaterThan(0); // Real completed motion reaches the viewport writer.
    probe.scrolls = [];
    await act(async () => { probe.hardwareKey!({ key: prefix }); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(probe.scrolls).toEqual([]);
    if (prefix === 'g') {
      await act(async () => { probe.hardwareKey!({ key: 'g' }); await new Promise(resolve => setTimeout(resolve, 20)); });
      expect(probe.scrolls).toEqual([0]); // Complete gg still reveals the first row.
    }
  });

  it('keeps an opened idle thread read through repeated authoritative refreshes without clearing its sibling', async () => {
    probe.sessions = [
      { key: 'agent:test:main', displayName: 'test', sessionId: 'generation-read', unread: true, hasActiveRun: false, activeRunIds: [], updatedAt: 1_800_000_000_000 },
      { key: 'agent:test:other', displayName: 'sibling', sessionId: 'generation-sibling', unread: true, hasActiveRun: false, activeRunIds: [], updatedAt: 1_800_000_000_000 },
    ];
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    await act(async () => { (probe.gateway.selectProject as (key: string) => void)('agent:test:main'); });
    for (let index = 0; index < 3; index += 1) {
      await act(async () => { await (probe.gateway.refresh as () => Promise<void>)(); });
      const projects = probe.gateway.projects as Array<{ sessionKey: string; unread?: boolean }>;
      expect(projects.find(row => row.sessionKey === 'agent:test:main')?.unread).not.toBe(true);
      expect(projects.find(row => row.sessionKey === 'agent:test:other')?.unread).toBe(true);
    }
    expect(probe.requests).toEqual([{ method: 'sessions.patch', key: 'agent:test:main', unread: false,
      expectedSessionId: 'generation-read', expectedMarkedUnreadAt: null }]);
    // A later real background completion must not be masked by a local read override.
    await act(async () => { (probe.gateway.selectProject as (key: string) => void)('agent:test:other'); });
    probe.sessions[0]!.unread = true; probe.sessions[0]!.updatedAt = 1_800_000_001_000;
    await act(async () => { await (probe.gateway.refresh as () => Promise<void>)(); });
    expect((probe.gateway.projects as Array<{ sessionKey: string; unread?: boolean }>).find(row => row.sessionKey === 'agent:test:main')?.unread).toBe(true);
  });

  it('keeps activity age and sorting stable through open/read/refresh but advances for real activity', async () => {
    const base = 1_700_000_000_000;
    probe.sessions = [
      { key: 'agent:test:main', sessionId: 'main-generation', unread: true, hasActiveRun: false, activeRunIds: [], updatedAt: base, lastInteractionAt: base - 100, lastActivityAt: base },
      { key: 'agent:test:other', sessionId: 'other-generation', unread: true, hasActiveRun: false, activeRunIds: [], updatedAt: base + 1000, lastInteractionAt: base + 1000, lastActivityAt: base + 500 },
    ];
    const projects = () => probe.gateway.projects as import('../workspace/workspaceTypes').WorkspaceProject[];
    const times = () => projects().map(row => row.updatedAt);
    const order = () => presentWorkspaceProjects(projects(), 'activity').map(row => row.sessionKey);
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    expect(times()).toEqual([base, base + 1000]);
    expect(order()).toEqual(['agent:test:other', 'agent:test:main']);
    for (const key of ['agent:test:main', 'agent:test:other', 'agent:test:main']) {
      await act(async () => { (probe.gateway.selectProject as (key: string) => void)(key); });
      await act(async () => { await (probe.gateway.refresh as () => Promise<void>)(); });
      expect(times()).toEqual([base, base + 1000]);
      expect(order()).toEqual(['agent:test:other', 'agent:test:main']);
      expect(projects().find(row => row.sessionKey === key)?.unread).not.toBe(true);
    }
    expect(probe.sessions[0]!.updatedAt).toBeGreaterThan(base + 1000); // Real installed read-patch behavior.
    expect(probe.requests).toHaveLength(3); // Read acknowledgement remains durable, including reopen.
    await act(async () => { (probe.gateway.selectProject as (key: string) => void)('agent:test:other'); });
    probe.sessions[0]!.lastInteractionAt = base + 2000;
    await act(async () => { await (probe.gateway.refresh as () => Promise<void>)(); });
    expect(order()).toEqual(['agent:test:main', 'agent:test:other']);
    expect(times()).toEqual([base + 2000, base + 1000]);
    probe.sessions[0]!.lastActivityAt = base + 3000; probe.sessions[0]!.unread = true;
    await act(async () => { await (probe.gateway.refresh as () => Promise<void>)(); });
    expect(times()).toEqual([base + 3000, base + 1000]);
    expect(projects()[0]!.unread).toBe(true);
  });

  it('settles overlapping transition and urgent folded-tool publications through the real history owner', async () => {
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    const key = probe.gateway.selectedKey as string;
    await act(async () => probe.updateMessages!(key, rows(2)));
    const before = probe.renders;
    await act(async () => {
      startTransition(() => probe.updateMessages!(key, current => [...current, ...rows(3).slice(2)]));
      probe.updateMessages!(key, current => current.map(message => ({ ...message, text: `${message.text}\nrevision` })));
    });
    expect(probe.renders - before).toBeLessThan(10);
    expect((probe.gateway.messages as WorkspaceMessage[]).map(message => message.id)).toEqual(['message-0', 'message-1', 'message-2']);
  });

  it('settles the real workspace hook on connect and live tool publication', async () => {
    await act(async () => root.render(<AppShell />));
    await act(async () => { await (probe.gateway.connect as (profile: unknown) => Promise<void>)({ url: 'ws://fixture.invalid', token: 'fixture' }); });
    expect(probe.gateway.status).toBe('connected');
    const sessionKey = probe.gateway.selectedKey as string;
    expect(sessionKey).toBe('agent:test:main');
    expect((probe.gateway.messages as WorkspaceMessage[]).some((message) => message.text === 'Ready.')).toBe(true);
    for (let index = 0; index < 10; index += 1) {
      const before = probe.renders;
      await act(async () => {
        probe.client?.onEvent?.({ event: 'agent', payload: { sessionKey, runId: 'fixture-run', stream: 'tool',
          data: { name: 'read', phase: 'start', toolCallId: `call-${index}`, args: { path: `/fixture/${index}` } } } });
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(probe.renders - before).toBeLessThan(10);
    }
    expect((probe.gateway.messages as WorkspaceMessage[]).filter((message) => message.role === 'tool').map((message) => message.id))
      .toEqual(Array.from({ length: 10 }, (_, index) => `live-tool-fixture-run-call-${index}`));
  });

  it('settles folded-tail projection across appends, equivalent snapshots and final replacement', async () => {
    let messages = rows(458);
    await act(async () => root.render(<AppShell fixtureMessages={messages} />));
    expect(container.querySelector('[data-testid="transcript"]')?.textContent).toBe('1');
    for (let step = 0; step < 40; step += 1) {
      messages = step < 2 ? rows(459 + step) : messages.map((message) => ({ ...message }));
      const before = probe.renders;
      await act(async () => root.render(<AppShell fixtureMessages={messages} />));
      expect(probe.renders - before).toBeLessThan(8);
    }
    messages = [...messages.slice(0, -1), { id: 'final', role: 'assistant', text: 'Complete.\n\nThe result is ready.' }];
    await act(async () => root.render(<AppShell fixtureMessages={messages} />));
    const settled = probe.renders;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(probe.renders).toBe(settled);
    expect(container.querySelector('[data-testid="transcript"]')).not.toBeNull();
  });
});


describe('isolated AppShell fixtures', () => {
  it('opens global shortcuts from the header, Cmd-/ and :help without hijacking backward search or a draft', async () => {
    await act(async () => root.render(<AppShell fixtureMessages={[]} />));
    await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'Keep draft', { start: 10, end: 10 })));
    const original = probe.prompt.state;
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Keyboard shortcuts"]')!;
    expect(button).not.toBeNull();
    act(() => button.click());
    expect(container.querySelector('[aria-label="Keyboard shortcut reference"]')).not.toBeNull();
    expect(probe.prompt.inputBlocked).toBe(true);
    act(() => probe.hardwareKey?.({ key: 'enter' }));
    act(() => probe.hardwareKey?.({ key: 'escape' }));
    expect(container.querySelector('[aria-label="Keyboard shortcut reference"]')).toBeNull();
    act(() => probe.hardwareKey?.({ key: '/', command: true, shift: true }));
    expect(container.querySelector('[aria-label="Keyboard shortcut reference"]')).toBeNull();
    act(() => probe.hardwareKey?.({ key: '/', command: true, shift: false }));
    expect(container.querySelector('[aria-label="Keyboard shortcut reference"]')).not.toBeNull();
    act(() => probe.hardwareKey?.({ key: '/', command: true, shift: false, isRepeat: true }));
    expect(container.querySelector('[aria-label="Keyboard shortcut reference"]')).not.toBeNull();
    act(() => probe.hardwareKey?.({ key: 'escape' }));
    act(() => probe.hardwareKey?.({ key: ':', control: false }));
    act(() => probe.commandBar.onQueryChange('help'));
    act(() => probe.commandBar.onSubmit());
    expect(container.querySelector('[aria-label="Keyboard shortcut reference"]')).not.toBeNull();
    act(() => probe.hardwareKey?.({ key: 'q' }));
    expect(probe.prompt.state).toEqual(original);
    expect(probe.sends).toEqual([]);
    act(() => probe.hardwareKey?.({ key: '?' }));
    expect(container.querySelector('[aria-label="Keyboard shortcut reference"]')).toBeNull();
    expect(probe.commandBar.search?.direction).toBe(-1);
  });

  it('Files images use the existing viewer and its Escape key without closing Files or editing the draft', async () => {
    await act(async () => root.render(<AppShell fixtureMessages={[]} />));
    const attachment = { id: 'file:image', filename: 'phone.png', uri: 'data:image/png;base64,iVBORw==', mimeType: 'image/png', byteCount: 4 };
    await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'Keep draft', { start: 10, end: 10 })));
    const original = probe.prompt.state;
    await act(async () => probe.projectFiles!.onOpenMedia([attachment], attachment.id));
    expect(probe.mediaViewer).toMatchObject({ attachments: [attachment], initialID: attachment.id });
    expect(container.querySelector('[data-testid="media-viewer"]')).not.toBeNull();
    expect(probe.prompt.inputBlocked).toBe(true);
    act(() => probe.hardwareKey?.({ key: 'j' }));
    expect(probe.prompt.state).toEqual(original);
    act(() => probe.hardwareKey?.({ key: 'escape' }));
    expect(container.querySelector('[data-testid="media-viewer"]')).toBeNull();
    expect(probe.prompt.state).toEqual(original);
    expect(probe.sends).toEqual([]);
  });

  it.each([
    ['participant/grades.xlsx', 'document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['participant.zip', 'document', 'application/zip'],
    ['facilitator.zip', 'document', 'application/zip'],
    ['findings.md', 'text', 'text/markdown'],
    ['opaque.bin', 'unsupported', undefined],
  ] as const)('opens an exact generated-artifact link without the old Files mapping: %s', async (suffix, kind, mimeType) => {
    probe.renderRows = true;
    const project: WorkspaceProject = { id: 'project', sessionKey: 'project-root', name: 'project', path: '/repo/project', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const path = `demo/${suffix}`; const sourcePath = `/fixture/artifacts/${path}`;
    const directory = path.slice(0, path.lastIndexOf('/'));
    const projectList = vi.fn();
    probe.locatedRequest.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      const scope = { schemaVersion: 1, location: 'assistant-artifacts', projectId: 'assistant-artifacts' };
      if (method.endsWith('.resolve')) return { ...scope, rootPath: '/fixture/artifacts', path };
      const entry = { name: suffix.split('/').pop(), path, kind, ...(mimeType ? { mimeType } : {}), size: 4, mtimeMs: 1 };
      if (method.endsWith('.list')) return { ...scope, path: params.path, entries: [entry] };
      if (kind === 'unsupported') throw new Error('Unsupported bytes must not be read');
      return { ...scope, ...entry, ...(kind === 'text' ? { text: 'demo' } : { dataBase64: 'ZGVtbw==' }) };
    });
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: `[file](<${sourcePath}>)` }]}
      fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory: projectList, readFile: vi.fn() } }} />));
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: sourcePath }));
    expect(probe.locatedRequest).toHaveBeenCalledWith('vimicate.files.resolve', { sourcePath, projectId: 'project' });
    expect(probe.locatedRequest).toHaveBeenCalledWith('vimicate.files.list', expect.objectContaining({ location: 'assistant-artifacts', projectId: 'assistant-artifacts', path: directory }));
    expect(probe.projectFiles?.rootLabel).toBe('Artifacts');
    expect(probe.projectFiles?.controller.selectedEntry?.path).toBe(path);
    expect(probe.projectFiles?.controller.path).toBe(directory);
    if (kind === 'unsupported') {
      expect(probe.projectFiles?.controller.content).toBeNull();
      expect(probe.locatedRequest.mock.calls.some(([method]) => method.endsWith('.read'))).toBe(false);
    } else expect(probe.projectFiles?.controller.content).toMatchObject({ path, kind });
    expect(probe.nativeLink).not.toHaveBeenCalled(); expect(projectList).not.toHaveBeenCalled();
    // Keyboard activation uses the same route and never sends a chat message.
    await act(async () => probe.projectFiles?.controller.close());
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(probe.projectFiles?.controller.selectedEntry?.path).toBe(path);
    expect(probe.sends).toEqual([]);
  });

  it.each(['root', 'child'])('an open Downloads image returns to the new %s thread project directory', async (kind) => {
    probe.renderRows = true;
    const first: WorkspaceProject = { id: 'first', sessionKey: 'first-root', name: 'first', path: '/repo/first', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const second: WorkspaceProject = kind === 'root' ? { ...first, id: 'second', sessionKey: 'second-root', path: '/repo/second' }
      : { ...first, id: 'first-child', sessionKey: 'first-child', kind: 'thread', rootSessionKey: first.sessionKey };
    const projects = [first, second];
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [] }));
    const fixtureProjectFiles = { port: { listDirectory, readFile: vi.fn() } };
    const renderThread = async (selectedKey: string) => act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: 'Ready.' }]}
      fixtureProjectRail={{ projects, selectedKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    probe.sharedResolve.mockResolvedValue({ path: 'phone.png' });
    probe.sharedList.mockImplementation(async (projectId: string, path: string) => ({ projectId, path, entries: [{ name: 'phone.png', path: 'phone.png', kind: 'image', mimeType: 'image/png', size: 4, mtimeMs: 1 }] }));
    probe.sharedRead.mockImplementation(async (projectId: string, path: string) => ({ projectId, path, kind: 'image', mimeType: 'image/png', size: 4, mtimeMs: 1, dataBase64: 'iVBORw==' }));
    await renderThread(first.sessionKey);
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: '~/icloud/Downloads/phone.png' }));
    expect(probe.projectFiles?.rootLabel).toBe('iCloud Downloads');
    expect(probe.projectFiles?.controller.content?.kind).toBe('image');
    await renderThread(second.sessionKey);
    expect(probe.projectFiles?.rootLabel).toBe('Project');
    expect(probe.projectFiles?.rootPath).toBe(second.path);
    expect(probe.projectFiles?.controller).toMatchObject({ open: true, path: '', content: null });
    expect(listDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: kind === 'root' ? second.id : first.id, path: '' }));
    expect(probe.sharedList).toHaveBeenCalledTimes(1);
    await renderThread(first.sessionKey);
    expect(probe.projectFiles?.rootLabel).toBe('iCloud Downloads');
    expect(probe.projectFiles?.controller).toMatchObject({ open: true, content: { path: 'phone.png', kind: 'image' } });
    expect(probe.sends).toEqual([]);
  });

  it('opens the exact iCloud Downloads link by tap and Enter in a distinct Files location', async () => {
    probe.renderRows = true;
    const project: WorkspaceProject = { id: 'example-product', sessionKey: 'example-product-root', name: 'example-product', path: '/repo/example-product', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const target = '/Users/fixture/icloud/Downloads/Sessions plan.md';
    const projectList = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [] }));
    probe.sharedResolve.mockResolvedValue({ path: 'Sessions plan.md' });
    probe.sharedList.mockImplementation(async (projectId: string, path: string) => ({ projectId, path, entries: [{ name: 'Sessions plan.md', path: 'Sessions plan.md', kind: 'text', mimeType: 'text/markdown', size: 10, mtimeMs: 1 }] }));
    probe.sharedRead.mockImplementation(async (projectId: string, path: string) => ({ projectId, path, kind: 'text', mimeType: 'text/markdown', size: 10, mtimeMs: 1, text: '# sessions' }));
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: `[Sessions plan](<${target}>)` }]}
      fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory: projectList, readFile: vi.fn() } }} />));
    await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'Retain this draft', { start: 6, end: 6 })));
    const draft = probe.prompt.state;
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: target }));
    expect(probe.sharedResolve).toHaveBeenCalledWith(target);
    expect(probe.sharedList).toHaveBeenCalledWith('shared-icloud-downloads', '');
    expect(probe.sharedRead).toHaveBeenCalledWith('shared-icloud-downloads', 'Sessions plan.md');
    expect(probe.projectFiles?.rootLabel).toBe('iCloud Downloads');
    expect(probe.projectFiles?.controller.selectedEntry?.path).toBe('Sessions plan.md');
    expect(probe.projectFiles?.controller.content?.path).toBe('Sessions plan.md');
    expect(projectList).not.toHaveBeenCalled();
    expect(probe.nativeLink).not.toHaveBeenCalled();
    await act(async () => probe.projectFiles?.controller.close());
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(probe.sharedResolve).toHaveBeenCalledTimes(2);
    expect(probe.sharedResolve).toHaveBeenLastCalledWith(target);
    expect(probe.sharedList).toHaveBeenCalledTimes(2);
    expect(probe.prompt.state).toEqual(draft);
    expect(probe.sends).toEqual([]);
    await act(async () => probe.projectFiles?.controller.close());
    await act(async () => probe.hardwareKey!({ key: ':' }));
    await act(async () => probe.commandBar.onQueryChange('files'));
    await act(async () => probe.commandBar.onSubmit());
    expect(probe.projectFiles?.rootLabel).toBe('iCloud Downloads');
    expect(probe.projectFiles?.controller.content?.path).toBe('Sessions plan.md');
    expect(projectList).not.toHaveBeenCalled();
  });

  it('routes retained PDF reopen keys to Files without editing or sending the draft', async () => {
    const project: WorkspaceProject = { id: 'synthetic', sessionKey: 'synthetic-root', name: 'synthetic', path: '/synthetic', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: ['a.pdf', 'b.pdf'].map((name, index) => ({ name, path: name, kind: 'document' as const, mimeType: 'application/pdf', size: 3, mtimeMs: 2 - index })) }));
    const readFile = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, kind: 'document' as const, mimeType: 'application/pdf', size: 3, mtimeMs: 1, dataBase64: 'JVBE' }));
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    await act(async () => probe.prompt.onState(current => acceptNativeText(current, 'synthetic unsent draft', { start: 5, end: 5 })));
    const draft = probe.prompt.state;
    const key = async (key: string, control = false) => act(async () => probe.hardwareKey!({ key, control }));
    await key('escape');
    const normalDraft = probe.prompt.state;
    await key('l', true);
    expect(probe.projectFiles?.controller).toMatchObject({ open: true, previewPhase: 'ready', selectedEntry: { path: 'a.pdf' } });
    for (let cycle = 0; cycle < 3; cycle++) {
      await key('j', true); // Ctrl-J enters the preview region before each close.
      expect(probe.projectFiles?.controller.region).toBe('preview');
      await key('q');
      expect(probe.projectFiles?.controller.open).toBe(false);
      await key('l', true);
      expect(probe.projectFiles).toMatchObject({ focused: true, controller: { open: true, selectedEntry: { path: 'a.pdf' }, content: { path: 'a.pdf' }, previewPhase: 'ready' } });
      expect(probe.prompt).toMatchObject({ keyboardCapture: true, inputBlocked: true });
      // Reopen retains the preview region. A settled non-text preview yields j/k to the list.
      expect(probe.projectFiles?.controller.region).toBe('preview');
      await key('j');
      expect(probe.projectFiles?.controller).toMatchObject({ region: 'list', selectedEntry: { path: 'b.pdf' } });
      await key('k');
      expect(probe.projectFiles?.controller.selectedEntry?.path).toBe('a.pdf');
      await key('h', true);
      expect(probe.projectFiles?.focused).toBe(false);
      await key('l', true);
      expect(probe.projectFiles?.focused).toBe(true);
    }
    expect(probe.prompt.state).toEqual(normalDraft);
    expect(probe.prompt.state.text).toBe(draft.text);
    expect(probe.sends).toEqual([]);
    expect(listDirectory).toHaveBeenCalledTimes(1);
  });

  it.each(['project', 'shared', 'located'] as const)('resumes %s folder and preview per thread through Ctrl-L and command reopen', async location => {
    probe.renderRows = true;
    const first: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const second: WorkspaceProject = { ...first, id: 'notes-child', sessionKey: 'notes-child', kind: 'thread', rootSessionKey: first.sessionKey };
    const entry = (path: string) => ({ name: 'guide.md', path: `${path}/guide.md`, kind: 'text' as const, mimeType: 'text/markdown', size: 18, mtimeMs: 1 });
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: path ? [entry(path)] : [] }));
    const readFile = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, kind: 'text' as const, mimeType: 'text/markdown', size: 18, mtimeMs: 1, text: 'first\nsecond\nthird' }));
    probe.sharedResolve.mockImplementation(async (path: string) => ({ path: path.split('/Downloads/')[1] }));
    probe.sharedList.mockImplementation(async (projectId: string, path: string) => listDirectory({ projectId, path }));
    probe.sharedRead.mockImplementation(async (projectId: string, path: string) => readFile({ projectId, path }));
    probe.locatedRequest.mockImplementation(async (method: string, params: Record<string, string>) => {
      const scope = { schemaVersion: 1, location: 'assistant-artifacts', projectId: 'assistant-artifacts' };
      if (method.endsWith('.resolve')) return { ...scope, rootPath: '/synthetic/artifacts', path: params.sourcePath!.split('/artifacts/')[1] };
      if (method.endsWith('.list')) return { ...scope, path: params.path, entries: [entry(params.path!)] };
      return { ...scope, path: params.path, kind: 'text', mimeType: 'text/markdown', size: 18, mtimeMs: 1, text: 'first\nsecond\nthird' };
    });
    const fixtureProjectFiles = { port: { listDirectory, readFile } };
    const renderThread = async (selectedKey: string) => act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [first, second], selectedKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    const open = async (folder: string, line: number) => act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: location === 'shared' ? `~/icloud/Downloads/${folder}/guide.md` : location === 'located' ? `/synthetic/artifacts/${folder}/guide.md` : `${folder}/guide.md`, line }));
    const expectView = (folder: string, row: number) => {
      expect(probe.projectFiles?.rootLabel).toBe(location === 'shared' ? 'iCloud Downloads' : location === 'located' ? 'Artifacts' : 'Project');
      expect(probe.projectFiles?.controller).toMatchObject({ open: true, path: folder, region: 'preview', selectedEntry: { path: `${folder}/guide.md` }, content: { path: `${folder}/guide.md` }, previewNavigation: { cursor: { row } } });
    };
    await renderThread(first.sessionKey); await open('alpha', 2); expectView('alpha', 1);
    await act(async () => probe.projectFiles!.controller.close());
    await act(async () => probe.hardwareKey!({ key: 'l', control: true })); expectView('alpha', 1);
    await renderThread(second.sessionKey);
    expect(probe.projectFiles?.rootLabel).toBe('Project');
    expect(probe.projectFiles?.controller.path).toBe('');
    await open('beta', 3); expectView('beta', 2);
    await renderThread(first.sessionKey); expectView('alpha', 1);
    await act(async () => probe.projectFiles!.controller.close());
    await act(async () => probe.hardwareKey!({ key: ':' }));
    await act(async () => probe.commandBar.onQueryChange('files'));
    await act(async () => probe.commandBar.onSubmit()); expectView('alpha', 1);
    await act(async () => (probe.paneControls.onToggleFiles as () => void)());
    expect(probe.projectFiles?.controller.open).toBe(false);
    await act(async () => (probe.paneControls.onToggleFiles as () => void)()); expectView('alpha', 1);
    await renderThread(second.sessionKey); expectView('beta', 2);
    await act(async () => probe.projectFiles!.controller.close());
    const readsBeforeSwitch = readFile.mock.calls.length + probe.locatedRequest.mock.calls.length;
    await renderThread(first.sessionKey);
    expect(probe.projectFiles?.controller.open).toBe(false);
    expect(readFile.mock.calls.length + probe.locatedRequest.mock.calls.length).toBe(readsBeforeSwitch);
    await act(async () => probe.hardwareKey!({ key: 'l', control: true })); expectView('alpha', 1);
    expect(probe.sends).toEqual([]);
  });

  it('reports an unavailable shared location without falling back to native Files or project reads', async () => {
    const project: WorkspaceProject = { id: 'example-product', sessionKey: 'example-product-root', name: 'example-product', path: '/repo/example-product', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const projectList = vi.fn();
    probe.sharedResolve.mockRejectedValue(new Error('Unknown method'));
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: '[Sessions plan](<~/icloud/Downloads/Sessions plan.md>)' }]}
      fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory: projectList, readFile: vi.fn() } }} />));
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(probe.sharedResolve).toHaveBeenCalledWith('~/icloud/Downloads/Sessions plan.md');
    expect(probe.projectFiles?.controller.open).toBe(false);
    expect(probe.status.detail).toContain('could not be opened through the Gateway');
    expect(probe.nativeLink).not.toHaveBeenCalled();
    expect(projectList).not.toHaveBeenCalled();
    expect(probe.sharedList).not.toHaveBeenCalled();
  });

  it.each(['thread', 'newer-link', 'close', 'unmount'] as const)('discards pending artifact resolution after %s', async (action) => {
    probe.renderRows = true;
    const first: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const second = { ...first, id: 'other', sessionKey: 'other-root', path: '/repo/other' };
    let finish!: (value: unknown) => void;
    probe.locatedRequest.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [{ name: 'guide.md', path: path ? `${path}/guide.md` : 'guide.md', kind: 'text' as const, mimeType: 'text/markdown', size: 5, mtimeMs: 1 }] }));
    const readFile = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, kind: 'text' as const, mimeType: 'text/markdown', size: 5, mtimeMs: 1, text: 'Guide' }));
    const fixture = { port: { listDirectory, readFile }, initiallyOpen: true };
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [first], selectedKey: first.sessionKey }} fixtureProjectFiles={fixture} />));
    const pending = probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: '/fixture/artifacts/demo/report.pdf' });
    if (action === 'thread') await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [second], selectedKey: second.sessionKey }} fixtureProjectFiles={fixture} />));
    if (action === 'newer-link') await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: 'docs/guide.md' }));
    if (action === 'close') act(() => probe.projectFiles!.controller.close());
    if (action === 'unmount') await act(async () => root.unmount());
    await act(async () => { finish({ schemaVersion: 1, location: 'assistant-artifacts', projectId: 'assistant-artifacts', rootPath: '/fixture/artifacts', path: 'demo/report.pdf' }); await pending; });
    expect(probe.locatedRequest).toHaveBeenCalledTimes(1);
    expect(probe.nativeLink).not.toHaveBeenCalled();
    if (action === 'close') expect(probe.projectFiles!.controller.open).toBe(false);
    if (action === 'newer-link') expect(probe.projectFiles!.controller.content?.path).toBe('docs/guide.md');
  });

  it('does not map another account absolute path onto a home-relative project', async () => {
    probe.renderRows = true;
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '~/repos/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    probe.locatedRequest.mockRejectedValue(new Error('Outside host home'));
    const listDirectory = vi.fn(); const readFile = vi.fn();
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: '/Users/other/repos/notes/report.xlsx' }));
    expect(probe.locatedRequest).toHaveBeenCalledWith('vimicate.files.resolve', { sourcePath: '/Users/other/repos/notes/report.xlsx', projectId: 'notes' });
    expect(listDirectory).not.toHaveBeenCalled(); expect(readFile).not.toHaveBeenCalled();
    expect(probe.nativeLink).not.toHaveBeenCalled();
    expect(probe.status.detail).toContain('No other folder was opened');
  });

  it('discards a shared-link resolution after the owning project scope changes', async () => {
    probe.renderRows = true;
    const first: WorkspaceProject = { id: 'first', sessionKey: 'first-root', name: 'first', path: '/repo/first', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const second: WorkspaceProject = { ...first, id: 'second', sessionKey: 'second-root', name: 'second', path: '/repo/second' };
    let finish!: (value: { path: string }) => void;
    probe.sharedResolve.mockReturnValue(new Promise<{ path: string }>((resolve) => { finish = resolve; }));
    const fixtureProjectFiles = { port: { listDirectory: vi.fn(), readFile: vi.fn() } };
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: 'Ready.' }]}
      fixtureProjectRail={{ projects: [first], selectedKey: first.sessionKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    const pending = probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: '~/icloud/Downloads/Sessions plan.md' });
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: 'Ready.' }]}
      fixtureProjectRail={{ projects: [second], selectedKey: second.sessionKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    await act(async () => { finish({ path: 'Sessions plan.md' }); await pending; });
    expect(probe.sharedList).not.toHaveBeenCalled();
    expect(probe.projectFiles?.controller.open).toBe(false);
    expect(probe.nativeLink).not.toHaveBeenCalled();
  });

  it('does not let a late Downloads resolution displace a newer project-file link', async () => {
    probe.renderRows = true;
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    let finish!: (value: { path: string }) => void;
    probe.sharedResolve.mockReturnValue(new Promise<{ path: string }>((resolve) => { finish = resolve; }));
    const projectList = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'text' as const, size: 5, mtimeMs: 1 }] }));
    const projectRead = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, kind: 'text' as const, mimeType: 'text/markdown', size: 5, mtimeMs: 1, text: 'Guide' }));
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: 'Ready.' }]}
      fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory: projectList, readFile: projectRead } }} />));
    const pending = probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: '~/icloud/Downloads/Sessions plan.md' });
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: 'docs/guide.md' }));
    expect(probe.projectFiles?.rootLabel).toBe('Project');
    expect(probe.projectFiles?.controller.content?.path).toBe('docs/guide.md');
    await act(async () => { finish({ path: 'Sessions plan.md' }); await pending; });
    expect(probe.sharedList).not.toHaveBeenCalled();
    expect(probe.projectFiles?.rootLabel).toBe('Project');
    expect(probe.projectFiles?.controller.content?.path).toBe('docs/guide.md');
  });

  it('opens the readable local link at the transcript cursor in Files without handing the message to the prompt', async () => {
    probe.renderRows = true;
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'text' as const, size: 18, mtimeMs: 1 }] }));
    const readFile = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, kind: 'text' as const, mimeType: 'text/markdown', size: 20, mtimeMs: 1, text: '# Guide\n\nTarget line' }));
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: '[Guide](docs/guide.md#L3)\nPlain text' }]}
      fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'Keep this draft', { start: 4, end: 4 })));
    const draft = probe.prompt.state;
    await act(async () => probe.hardwareKey!({ key: 'g' }));
    await act(async () => probe.hardwareKey!({ key: 'g' }));
    expect(probe.paneControls.focusedPane).toBe('transcript');
    expect(probe.status).toMatchObject({ position: '1:1' });
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(listDirectory).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'notes', path: 'docs' }));
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'notes', path: 'docs/guide.md' }));
    expect(probe.projectFiles?.controller.selectedEntry?.path).toBe('docs/guide.md');
    expect(probe.projectFiles?.controller.content?.path).toBe('docs/guide.md');
    expect(probe.projectFiles?.controller.previewNavigation.cursor.row).toBe(2);
    expect(probe.projectFiles?.focused).toBe(true);
    expect(probe.prompt.state).toEqual(draft);
    expect(probe.sends).toEqual([]);
    expect(probe.nativeLink).not.toHaveBeenCalled();
  });

  it('searches a visible link label and moves h/l across its hidden URL before opening it', async () => {
    probe.renderRows = true;
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant',
      text: 'I checked the live [guide](https://example.test/guide). Its findings are covered.' }]} />));
    const key = async (value: string) => { await act(async () => probe.hardwareKey!({ key: value })); };
    await key('g'); await key('g'); await key('$');
    for (const value of ['?', ...'guide', 'enter', 'n']) await key(value);
    await key('enter');
    expect(probe.nativeLink).toHaveBeenCalledExactlyOnceWith({ kind: 'web', url: 'https://example.test/guide' });
    probe.nativeLink.mockClear();
    // Five visible steps leave the five-letter label and reach the period.
    await key('5'); await key('l'); await key('enter');
    expect(probe.nativeLink).not.toHaveBeenCalled();
    await key('h'); await key('enter');
    expect(probe.nativeLink).toHaveBeenCalledExactlyOnceWith({ kind: 'web', url: 'https://example.test/guide' });
    expect(probe.sends).toEqual([]);
  });

  it('keeps modified, visual and non-link Enter inert while an external link uses the existing opener', async () => {
    probe.renderRows = true;
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const listDirectory = vi.fn();
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: '[Guide](docs/guide.md)\nPlain text\n[Web](https://example.com/)' }]}
      fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile: vi.fn() } }} />));
    await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'Untouched', { start: 3, end: 3 })));
    const draft = probe.prompt.state;
    const key = async (value: string, modifiers = {}) => { await act(async () => probe.hardwareKey!({ key: value, ...modifiers })); };
    await key('g'); await key('g');
    await key('enter', { shift: true });
    await key('enter', { control: true });
    await key('v'); await key('enter'); await key('escape');
    expect(listDirectory).not.toHaveBeenCalled();
    await key('j'); await key('enter');
    expect(listDirectory).not.toHaveBeenCalled();
    expect(probe.nativeLink).not.toHaveBeenCalled();
    await key('j'); await key('enter');
    expect(probe.nativeLink).toHaveBeenCalledExactlyOnceWith({ kind: 'web', url: 'https://example.com/' });
    expect(probe.projectFiles?.controller.open).toBe(false);
    expect(probe.prompt.state).toEqual(draft);
    expect(probe.sends).toEqual([]);
  });

  it('does not select or preview a neighbouring file when an Enter link target is unavailable', async () => {
    probe.renderRows = true;
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [{ name: 'other.md', path: 'docs/other.md', kind: 'text' as const, size: 18, mtimeMs: 1 }] }));
    const readFile = vi.fn();
    await act(async () => root.render(<AppShell fixtureMessages={[{ id: 'answer', role: 'assistant', text: '[Missing](docs/missing.md)' }]}
      fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    expect(listDirectory).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'notes', path: 'docs' }));
    expect(probe.projectFiles?.controller.phase).toBe('ready');
    expect(probe.projectFiles?.controller.selectedEntry).toBeNull();
    expect(probe.projectFiles?.controller.content).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
    expect(probe.nativeLink).not.toHaveBeenCalled();
    expect(probe.sends).toEqual([]);
  });

  function resolvedProjectFixture(project: WorkspaceProject, listDirectory: (input: { projectId: string; path: string }) => Promise<{ entries: unknown[] }>, readFile: (input: { projectId: string; path: string }) => Promise<unknown>) {
    probe.locatedRequest.mockImplementation(async (method: string, params: { sourcePath: string; path: string }) => {
      const scope = { schemaVersion: 1, location: 'project', projectId: project.id };
      if (method.endsWith('.resolve')) {
        if (!params.sourcePath.startsWith(`${project.path}/`)) throw new Error('Unavailable location');
        return { ...scope, rootPath: project.path, path: params.sourcePath.slice(project.path.length + 1) };
      }
      const request = { projectId: project.id, path: params.path };
      if (method.endsWith('.list')) {
        const result = await listDirectory(request);
        return { ...scope, ...result, entries: result.entries.map(entry => ({ ...(entry as { kind: string }).kind === 'text' ? { mimeType: 'text/markdown' } : {}, ...(entry as object) })) };
      }
      return { ...scope, ...await readFile(request) as object };
    });
  }

  it('routes an absolute directory link through its parent project and exposes the complete root path', async () => {
    probe.renderRows = true;
    const folder = 'venepuncture-ntfgh/snaic/recommendation-materials';
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const thread: WorkspaceProject = { ...project, id: 'thread', sessionKey: 'notes-thread', kind: 'thread', rootSessionKey: project.sessionKey, path: '/wrong-thread-path' };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: path === 'venepuncture-ntfgh/snaic'
      ? [{ name: 'recommendation-materials', path: folder, kind: 'directory' as const, size: 0, mtimeMs: 1 }]
      : [{ name: 'plan.md', path: `${folder}/plan.md`, kind: 'text' as const, size: 10, mtimeMs: 1 }] }));
    const readFile = vi.fn();
    resolvedProjectFixture(project, listDirectory, readFile);
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [project, thread], selectedKey: thread.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: `/repo/notes/${folder}` }));
    expect(listDirectory.mock.calls.map(([request]) => [request.projectId, request.path])).toEqual([['notes', 'venepuncture-ntfgh/snaic'], ['notes', folder]]);
    expect(probe.projectFiles?.controller).toMatchObject({ path: folder, phase: 'ready', region: 'list', problem: '', selectedEntry: null });
    expect(probe.projectFiles?.rootPath).toBe(project.path);
    expect(readFile).not.toHaveBeenCalled(); expect(probe.nativeLink).not.toHaveBeenCalled(); expect(probe.sends).toEqual([]);
  });

  it('opens the folder and selects a PDF link without transport or preview fallthrough', async () => {
    probe.renderRows = true;
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 0, state: 'idle', kind: 'project' };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [
      { name: 'letter.pdf', path: 'docs/letter.pdf', kind: 'unsupported' as const, size: 12, mtimeMs: 1 },
    ] }));
    const readFile = vi.fn();
    resolvedProjectFixture(project, listDirectory, readFile);
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: '/repo/notes/docs/letter.pdf' }));
    expect(probe.projectFiles?.controller).toMatchObject({ path: 'docs', phase: 'ready', problem: '', selectedEntry: expect.objectContaining({ path: 'docs/letter.pdf' }), content: null });
    expect(readFile).not.toHaveBeenCalled(); expect(probe.nativeLink).not.toHaveBeenCalled(); expect(probe.sends).toEqual([]);
  });

  it.each([true, false])('opens linked documents in the owning project Files pane (isPad=%s)', async (isPad) => {
    probe.isPad = isPad; probe.renderRows = true;
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-root', name: 'notes', path: '/repo/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const thread: WorkspaceProject = { ...project, id: 'thread', sessionKey: 'notes-thread', kind: 'thread', rootSessionKey: project.sessionKey, path: '/wrong-thread-path' };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'text' as const, size: 18, mtimeMs: 1 }] }));
    const readFile = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, kind: 'text' as const, mimeType: 'text/markdown', size: 20, mtimeMs: 1, text: '# Guide\n\nTarget line' }));
    resolvedProjectFixture(project, listDirectory, readFile);
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [project, thread], selectedKey: thread.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    expect(probe.projectFiles?.controller.open).toBe(false);
    await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'Keep this draft', { start: 4, end: 4 })));
    const draft = probe.prompt.state;
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: '/repo/notes/docs/guide.md', line: 3 }));
    expect(probe.projectFiles?.controller.open).toBe(true);
    expect(probe.projectFiles?.focused).toBe(true);
    expect(probe.projectFiles?.presentation).toBe(isPad ? 'sidebar' : 'overlay');
    expect(listDirectory).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'notes', path: 'docs' }));
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'notes', path: 'docs/guide.md' }));
    expect(probe.projectFiles?.controller.content?.path).toBe('docs/guide.md');
    expect(probe.projectFiles?.controller.previewNavigation.cursor.row).toBe(2);
    expect(probe.status).toMatchObject({ mode: 'files', position: '3:1' });
    await act(async () => probe.prompt.onHardwareKey({ key: 'k', control: true, shift: false, option: false, command: false }));
    expect(probe.status).toMatchObject({ mode: 'files', position: '1' });
    expect(probe.prompt.state).toEqual(draft);
    expect(probe.sends).toEqual([]); expect(probe.nativeLink).not.toHaveBeenCalled();
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'web', url: 'https://example.com/' }));
    expect(probe.nativeLink).toHaveBeenCalledWith({ kind: 'web', url: 'https://example.com/' });
    await act(async () => probe.transcriptLinkOpener!.openLink({ kind: 'local-file', path: '/outside/report.pdf' }));
    expect(probe.nativeLink).toHaveBeenCalledTimes(1); // Only the preceding web link, never a guessed Files mapping.
    expect(probe.status.detail).toContain('No other folder was opened');
    const oldOpener = probe.transcriptLinkOpener!;
    const other = { ...project, id: 'other', sessionKey: 'other-root', path: '/repo/other' };
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [other], selectedKey: other.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    const requestsAfterSwitch = listDirectory.mock.calls.length;
    await act(async () => oldOpener.openLink({ kind: 'local-file', path: '/repo/notes/docs/guide.md', line: 3 }));
    expect(listDirectory.mock.calls).toHaveLength(requestsAfterSwitch);

  });

  it('opens the project file owner from both the header and :files without transport fallthrough', async () => {
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [] }));
    const rootProject: WorkspaceProject = { id: 'fixture-notes', sessionKey: 'fixture-notes-session', name: 'notes', path: '/not-shared', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const fixtureProjectFiles = { port: { listDirectory, readFile: vi.fn() } };
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [rootProject], selectedKey: rootProject.sessionKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    await act(async () => (probe.paneControls.onToggleFiles as () => void)());
    expect(probe.projectFiles?.controller.open).toBe(true);
    expect(probe.projectFiles?.presentation).toBe('sidebar');
    expect(listDirectory).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'fixture-notes', path: '' }));
    await act(async () => probe.projectFiles?.controller.close());
    await act(async () => probe.hardwareKey!({ key: ':' }));
    await act(async () => probe.commandBar.onQueryChange('files'));
    await act(async () => probe.commandBar.onSubmit());
    expect(probe.projectFiles?.controller.open).toBe(true);
    expect(probe.sends).toEqual([]);
  });
  it('keeps Files visible when Enter activates another project and transfers focus to its prompt', async () => {
    const first: WorkspaceProject = { id: 'notes', sessionKey: 'notes-session', name: 'notes', path: '/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const second: WorkspaceProject = { ...first, id: 'code', sessionKey: 'code-session', name: 'code', path: '/code' };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [] }));
    const fixtureProjectFiles = { initiallyOpen: true, port: { listDirectory, readFile: vi.fn() } };
    const renderProject = (selectedKey: string) => <AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [first, second], selectedKey }} fixtureProjectFiles={fixtureProjectFiles} />;
    await act(async () => root.render(renderProject(first.sessionKey)));
    await act(async () => probe.prompt.onHardwareKey({ key: 'h', shift: false, control: true, command: false, option: false }));
    await act(async () => probe.prompt.onHardwareKey({ key: 'h', shift: false, control: true, command: false, option: false }));
    await act(async () => probe.hardwareKey!({ key: 'j' }));
    await act(async () => probe.hardwareKey!({ key: 'enter' }));
    await act(async () => root.render(renderProject(second.sessionKey)));
    expect(probe.projectFiles?.controller.open).toBe(true);
    expect(probe.paneControls.focusedPane).toBe('prompt');
    expect(listDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'code', path: '' }));
    expect(probe.projectFiles?.controller.content).toBeNull();
    await act(async () => probe.projectFiles?.onRequestFocus());
    expect(probe.paneControls.focusedPane).toBe('files');
    await act(async () => (probe.rail.onSelect as (key: string) => void)(second.sessionKey));
    expect(probe.paneControls.focusedPane).toBe('prompt');
    expect(probe.projectFiles?.controller.open).toBe(true);
  });
  it.each(['command', 'control'] as const)('sizes Files list and preview fonts independently with %s plus/minus', async (modifier) => {
    const project: WorkspaceProject = { id: 'notes', sessionKey: 'notes-session', name: 'notes', path: '/notes', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const fixtureProjectFiles = { initiallyOpen: true, port: { listDirectory: async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [] }), readFile: vi.fn() } };
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    const scales = () => probe.projectFiles as unknown as { listFontScale: number; previewFontScale: number };
    const list = scales().listFontScale; const preview = scales().previewFontScale;
    await act(async () => probe.prompt.onHardwareKey({ key: '+', shift: true, command: modifier === 'command', control: modifier === 'control', option: false }));
    expect(scales().listFontScale).toBeCloseTo(1.1);
    expect(scales().previewFontScale).toBe(preview);
    await act(async () => probe.prompt.onHardwareKey({ key: 'j', shift: false, command: false, control: true, option: false }));
    await act(async () => probe.prompt.onHardwareKey({ key: '-', shift: false, command: modifier === 'command', control: modifier === 'control', option: false }));
    expect(scales().previewFontScale).toBeCloseTo(0.8);
    expect(scales().listFontScale).toBeCloseTo(1.1);
    expect(list).toBe(1);
    expect(probe.prompt.fontScale).toBe(0.9);
    await act(async () => probe.projectFiles!.onFontStep!('list', -1));
    await act(async () => probe.projectFiles!.onFontStep!('preview', 1));
    expect(scales().listFontScale).toBeCloseTo(1);
    expect(scales().previewFontScale).toBeCloseTo(0.9);
    expect(probe.prompt.fontScale).toBe(0.9);
    expect([...probe.storage.values()].some(value => {
      try { const saved = JSON.parse(value); return saved.filesList === 1 && saved.filesPreview === 0.9; }
      catch { return false; }
    })).toBe(true);
    await act(async () => probe.prompt.onHardwareKey({ key: 'h', shift: false, command: false, control: true, option: false }));
    await act(async () => probe.prompt.onHardwareKey({ key: '-', shift: false, command: false, control: false, option: false }));
    expect(scales().listFontScale).toBeCloseTo(1);
    expect(scales().previewFontScale).toBeCloseTo(0.9);
  });
  it('keeps file keys out of an Insert draft and releases file ownership when the prompt is focused', async () => {
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [
      { name: 'first', path: 'first', kind: 'directory' as const, size: 0, mtimeMs: 2 },
      { name: 'second', path: 'second', kind: 'directory' as const, size: 0, mtimeMs: 1 },
    ] }));
    const rootProject: WorkspaceProject = { id: 'fixture-notes', sessionKey: 'fixture-notes-session', name: 'notes', path: '/not-shared', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const fixtureProjectFiles = { port: { listDirectory, readFile: vi.fn() } };
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [rootProject], selectedKey: rootProject.sessionKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    await act(async () => probe.hardwareKey!({ key: 'i' }));
    await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'draft', { start: 5, end: 5 })));
    expect(probe.prompt.state).toMatchObject({ mode: 'insert', text: 'draft' });

    await act(async () => (probe.paneControls.onToggleFiles as () => void)());
    await act(async () => { await Promise.resolve(); });
    expect(probe.prompt.inputBlocked).toBe(true);
    expect(probe.projectFiles?.controller.selectedIndex).toBe(0);
    await act(async () => probe.prompt.onHardwareKey({ key: 'j', shift: false, control: false, option: false, command: false,
      text: 'draftj', selectionStart: 6, selectionEnd: 6, textAuthority: probe.prompt.state.authority }));
    expect(probe.projectFiles?.controller.selectedIndex).toBe(1);
    expect(probe.prompt.state.text).toBe('draft');

    await act(async () => probe.prompt.onRequestPromptFocus());
    expect(probe.projectFiles?.focused).toBe(false);
    expect(probe.prompt.inputBlocked).toBe(false);
  });
  it('routes direct and control-w pane motions through visible panes without draft leakage', async () => {
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [
      { name: 'notes.md', path: 'notes.md', kind: 'text' as const, mimeType: 'text/markdown', size: 7, mtimeMs: 1 },
    ] }));
    const readFile = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, kind: 'text' as const, mimeType: 'text/markdown', size: 7, mtimeMs: 1, text: '# Notes' }));
    const rootProject: WorkspaceProject = { id: 'fixture-notes', sessionKey: 'fixture-notes-session', name: 'notes', path: '/not-shared', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [rootProject], selectedKey: rootProject.sessionKey }} fixtureProjectFiles={{ port: { listDirectory, readFile } }} />));
    await act(async () => (probe.paneControls.onToggleFiles as () => void)());
    await act(async () => { await Promise.resolve(); });
    expect(probe.paneControls.focusedPane).toBe('files');

    await act(async () => probe.prompt.onHardwareKey({ key: 'h', shift: false, control: true, option: false, command: false }));
    expect(probe.paneControls.focusedPane).toBe('transcript');
    expect(probe.projectFiles?.controller.open).toBe(true);
    await act(async () => probe.prompt.onHardwareKey({ key: 'j', shift: false, control: true, option: false, command: false }));
    await act(async () => probe.prompt.onHardwareKey({ key: 'i', shift: false, control: false, option: false, command: false }));
    await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'draft', { start: 5, end: 5 })));
    expect(probe.prompt.state).toMatchObject({ mode: 'insert', text: 'draft' });

    const authority = probe.prompt.state.authority;
    await act(async () => probe.prompt.onHardwareKey({ key: 'l', shift: false, control: true, option: false, command: false,
      text: 'draft!', selectionStart: 6, selectionEnd: 6, textAuthority: authority }));
    expect(probe.paneControls.focusedPane).toBe('files');
    expect(probe.prompt.state.text).toBe('draft!');
    await act(async () => probe.prompt.onHardwareKey({ key: 'h', shift: false, control: true, option: false, command: false,
      text: 'leaked', selectionStart: 6, selectionEnd: 6, textAuthority: probe.prompt.state.authority }));
    expect(probe.paneControls.focusedPane).toBe('prompt');
    expect(probe.prompt.state.text).toBe('draft!');

    await act(async () => probe.prompt.onHardwareKey({ key: 'escape', shift: false, control: false, option: false, command: false }));
    await act(async () => probe.prompt.onHardwareKey({ key: 'w', shift: false, control: true, option: false, command: false }));
    await act(async () => probe.prompt.onHardwareKey({ key: 'l', shift: false, control: false, option: false, command: false }));
    expect(probe.paneControls.focusedPane).toBe('files');
    await act(async () => probe.prompt.onHardwareKey({ key: 'j', shift: false, control: true, option: false, command: false }));
    expect(probe.projectFiles?.controller.region).toBe('preview');
    await act(async () => probe.prompt.onHardwareKey({ key: 'up', shift: false, control: true, option: false, command: false }));
    expect(probe.projectFiles?.controller.region).toBe('list');
    await act(async () => probe.prompt.onHardwareKey({ key: 'h', shift: false, control: true, option: false, command: false }));
    await act(async () => (probe.paneControls.onToggleProjects as () => void)());
    expect(probe.paneControls.projectsVisible).toBe(false);
    await act(async () => probe.prompt.onHardwareKey({ key: 'h', shift: false, control: true, option: false, command: false }));
    expect(probe.paneControls).toMatchObject({ projectsVisible: true, focusedPane: 'projects' });
  });
  it.each([
    { compact: false, pane: 'transcript', closeKey: 'escape' }, { compact: false, pane: 'prompt', closeKey: 'escape' },
    { compact: true, pane: 'transcript', closeKey: 'escape' }, { compact: true, pane: 'prompt', closeKey: 'escape' },
    { compact: false, pane: 'transcript', closeKey: 'q' }, { compact: false, pane: 'prompt', closeKey: 'q' },
    { compact: true, pane: 'transcript', closeKey: 'q' }, { compact: true, pane: 'prompt', closeKey: 'q' },
  ] as const)('$closeKey closes Projects and returns to $pane (compact=$compact)', async ({ compact, pane, closeKey }) => {
    if (compact) { probe.isPad = false; probe.viewport = { width: 390, height: 844 }; }
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} />));
    if (pane === 'prompt') {
      await act(async () => probe.hardwareKey!({ key: 'j', control: true }));
      await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'Keep my draft', { start: 5, end: 5 })));
    }
    await act(async () => probe.hardwareKey!({ key: 'h', control: true }));
    expect(probe.paneControls).toMatchObject({ projectsVisible: true, focusedPane: 'projects' });
    const selectedKey = probe.rail.focusedKey;
    if (closeKey === 'escape') await act(async () => probe.hardwareKey!({ key: 'w', control: true }));
    await act(async () => probe.hardwareKey!({ key: closeKey }));
    expect(probe.paneControls).toMatchObject({ projectsVisible: false, focusedPane: pane });
    if (pane === 'prompt') expect(probe.prompt.state).toMatchObject({ text: 'Keep my draft', selection: { start: 5, end: 5 } });
    await act(async () => probe.hardwareKey!({ key: 'h', control: true }));
    expect(probe.paneControls).toMatchObject({ projectsVisible: true, focusedPane: 'projects' });
    expect(probe.rail.focusedKey).toBe(selectedKey);
    if (closeKey === 'escape') {
      await act(async () => probe.hardwareKey!({ key: '/' }));
      await act(async () => probe.hardwareKey!({ key: 'escape' }));
      expect(probe.paneControls).toMatchObject({ projectsVisible: false, focusedPane: pane });
      expect(probe.prompt.commandLineActive).toBe(false);
    }
  });
  it('keeps q in Projects search and command inputs, and does not close Projects while another pane is focused', async () => {
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} />));
    expect(probe.paneControls).toMatchObject({ projectsVisible: true, focusedPane: 'transcript' });
    await act(async () => probe.hardwareKey!({ key: 'q' }));
    expect(probe.paneControls).toMatchObject({ projectsVisible: true, focusedPane: 'transcript' });
    await act(async () => probe.hardwareKey!({ key: 'h', control: true }));
    await act(async () => probe.hardwareKey!({ key: '/' }));
    await act(async () => probe.hardwareKey!({ key: 'q' }));
    expect(probe.commandBar.search?.query).toBe('q');
    expect(probe.paneControls).toMatchObject({ projectsVisible: true, focusedPane: 'projects' });
    await act(async () => probe.commandBar.onCancel());
    await act(async () => probe.hardwareKey!({ key: ':' }));
    await act(async () => probe.hardwareKey!({ key: 'q' }));
    expect(probe.commandBar.command?.query).toBe('q');
    expect(probe.paneControls).toMatchObject({ projectsVisible: true, focusedPane: 'projects' });
    await act(async () => probe.hardwareKey!({ key: 'escape' }));
    expect(probe.paneControls).toMatchObject({ projectsVisible: false, focusedPane: 'transcript' });
    expect(probe.prompt.commandLineActive).toBe(false);
  });
  it.each(['transcript', 'prompt'] as const)('opens Files with Ctrl-l from %s and returns there with Escape', async (pane) => {
    const project: WorkspaceProject = { id: 'fixture-notes', sessionKey: 'fixture-notes-session', name: 'notes', path: '/not-shared', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const fixtureProjectFiles = { port: { listDirectory: async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [] }), readFile: vi.fn() } };
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [project], selectedKey: project.sessionKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    if (pane === 'prompt') {
      await act(async () => probe.prompt.onHardwareKey({ key: 'j', shift: false, control: true, option: false, command: false }));
      await act(async () => probe.prompt.onHardwareKey({ key: 'i', shift: false, control: false, option: false, command: false }));
      await act(async () => probe.prompt.onState((current) => acceptNativeText(current, 'Unsent draft', { start: 6, end: 6 })));
    }
    expect(probe.paneControls.focusedPane).toBe(pane);
    expect(probe.projectFiles?.controller.open).toBe(false);
    await act(async () => probe.prompt.onHardwareKey({ key: 'l', shift: false, control: true, option: false, command: false }));
    expect(probe.projectFiles?.controller.open).toBe(true);
    expect(probe.paneControls.focusedPane).toBe('files');
    await act(async () => probe.prompt.onHardwareKey({ key: 'escape', shift: false, control: false, option: false, command: false }));
    expect(probe.projectFiles?.controller.open).toBe(false);
    expect(probe.paneControls.focusedPane).toBe(pane);
    if (pane === 'prompt') expect(probe.prompt.state).toMatchObject({ text: 'Unsent draft', mode: 'insert', selection: { start: 6, end: 6 } });
    await act(async () => probe.prompt.onHardwareKey({ key: 'l', shift: false, control: true, option: false, command: false }));
    expect(probe.projectFiles?.controller.open).toBe(true);
    expect(probe.paneControls.focusedPane).toBe('files');
  });
  it('closes the phone files overlay when keyboard focus returns to the conversation', async () => {
    probe.isPad = false;
    const rootProject: WorkspaceProject = { id: 'fixture-notes', sessionKey: 'fixture-notes-session', name: 'notes', path: '/not-shared', branch: 'main', starred: false, threadCount: 1, state: 'idle', kind: 'project' };
    const fixtureProjectFiles = { port: { listDirectory: async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: [] }), readFile: vi.fn() } };
    await act(async () => root.render(<AppShell fixtureMessages={rows(1)} fixtureProjectRail={{ projects: [rootProject], selectedKey: rootProject.sessionKey }} fixtureProjectFiles={fixtureProjectFiles} />));
    await act(async () => (probe.paneControls.onToggleFiles as () => void)());
    expect(probe.projectFiles?.controller.open).toBe(true);
    await act(async () => probe.prompt.onHardwareKey({ key: 'h', shift: false, control: true, option: false, command: false }));
    expect(probe.projectFiles?.controller.open).toBe(false);
    expect(probe.paneControls.focusedPane).toBe('transcript');
  });
  it('does not restore shared pairing or a real project into local fixture data', async () => {
    await act(async () => root.render(<AppShell fixtureMessages={rows(2)} />));
    expect(probe.restores).toBe(0);
  });
  it('settles local fixture controls independently of an unrelated Gateway run', async () => {
    await act(async () => root.render(<AppShell fixtureMessages={rows(2)} fixtureRunActive={false} />));
    const sessionKey = probe.gateway.selectedKey as string;
    await act(async () => probe.client!.onEvent!({ event: 'agent', payload: { sessionKey, runId: 'external-run', stream: 'lifecycle', data: { phase: 'start' } } }));
    expect(probe.gateway.sending).toBe(true);
    expect(probe.promptSending).toBe(false);
  });
  it('retains normal persisted startup outside fixtures', async () => {
    await act(async () => root.render(<AppShell />));
    expect(probe.restores).toBeGreaterThan(0);
  });
});
