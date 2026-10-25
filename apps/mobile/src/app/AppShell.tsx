import { routeTranscriptQuestionKey } from '../questions/transcriptQuestionNavigation';
import { TranscriptActionsProvider } from '../transcript/TranscriptActionsProvider'; import { MAX_PROMPT_ATTACHMENTS } from '../prompt/promptAttachments'; import { handleTranscriptKeyWithDiagnostics as handleTranscriptKey } from '../transcript/transcriptKeyDiagnostics';
import { GatewayArtifactContext } from '../gateway/GatewayArtifactContext'; import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native'; import { SafeAreaView } from 'react-native-safe-area-context';
import VimicateEditor, { type HardwareKeyEvent } from '../../modules/vimicate-editor'; import { PairingBar } from '../gateway/PairingBar';
import { useAppShellGateway } from './useAppShellGateway'; import { handleCommandLineKey } from '../keyboard/commandLine';
import { workspaceCommandLineActions } from '../keyboard/workspaceCommandLineActions';
import { useCommandHistoryOwner } from '../keyboard/useCommandHistoryOwner';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { useWorkspaceHardwareKeys } from '../keyboard/useWorkspaceHardwareKeys';
import { acceptNativeText, applyBridgedNativeInsert, createPromptState, enterPromptInsertMode, handlePromptKey, insertPromptHandoff, movePromptSearchCursor, promptClipboardText, setNativeSelection, type PromptState } from '../prompt/vimPromptCore';
import { PromptPane, type PromptNavigationRequest } from '../prompt/PromptPane';
import { usePromptHistoryController } from '../prompt/usePromptHistoryController'; import { saveDraft } from '../storage/workspaceStore';
import { usePromptAttachmentController } from '../prompt/usePromptAttachmentController';
import { promptAttachmentViewer } from '../prompt/promptAttachmentViewer';
import { clearedForSubmission } from '../prompt/submissionDraft';
import { SessionSubmissionGate, SessionTailRevealRegistry, submissionOwnsSourceTailReveal } from '../prompt/sessionSubmissionGate';
import { colonCommandInput } from '../prompt/colonCommandInput';
import { guardedPromptSubmission } from '../prompt/guardedSubmission';
import { findTextSearchMatch, repeatedVimSearchDirection, vimSearchDirectionForKey } from '../search/paneSearch';
import { appShellStyles as styles } from './appShellStyles';
import { TranscriptLinkOpenerProvider } from '../transcript/TranscriptLinkOpener';
import { TranscriptPane, type TranscriptPaneHandle } from '../transcript/TranscriptPane';
import { TranscriptMediaViewer } from '../transcript/TranscriptMediaViewer';
import { useWorkspaceOverlays } from './useWorkspaceOverlays'; import { WorkspaceShortcuts, WorkspaceShortcutsButton } from '../ui/WorkspaceShortcuts';
import { useTranscriptDisplayOptions } from '../transcript/useTranscriptDisplayOptions';
import { transcriptDisclosureCommandForKey, transcriptFoldLineInMessage } from '../transcript/transcriptFoldCommand';
import { requestsOlderTranscriptAtReviewTop, requestsNewerTranscriptAtReviewBottom } from '../transcript/transcriptHistoryLoadKey';
import { authorizedTranscriptProjection } from '../transcript/transcriptProjectionAuthority';
import { composeTranscriptHandoff } from '../transcript/transcriptHandoff';
import { applyTranscriptSearch, clearTranscriptSearch, createTranscriptBuffer, createTranscriptVimState, focusTranscriptMessage, focusedTranscriptLine, transcriptLineAt, updatedTranscriptBuffer, type TranscriptHandoffVariant } from '../transcript/transcriptVim';
import { ProjectRail } from '../workspace/ProjectRail';
import { projectRailStartupPresentation } from '../workspace/projectRailStartupPresentation';
import { applyPaneShortcut, createFocusRouting, focusWorkspaceTarget, resolvePaneShortcutPrefix, type WorkspaceFocus } from '../workspace/focusRouting';
import { useProjectRailController } from '../workspace/useProjectRailController';
import { StatusLine } from '../ui/StatusLine';
import { WorkspaceHeader } from '../ui/WorkspaceHeader';
import { WorkspacePaneControls } from '../ui/WorkspacePaneControls';
import { useWorkspaceColumns } from '../layout/useWorkspaceColumns';
import { WorkspaceColumnDivider } from '../layout/WorkspaceColumnDivider';
import { WorkspaceCommandBar, type CommandSession, type SearchSession } from '../ui/WorkspaceCommandBar';
import { usePaneFontScales } from '../ui/usePaneFontScales';
import { projectRailPinchSurfaceStyle } from '../layout/projectRailGeometry';
import { sessionUsage, textPosition, workspaceModeLabel } from '../ui/statusProjection';
import { useSynchronousState } from './useSynchronousState';
import { WorkspaceDivider } from '../layout/WorkspaceDivider';
import { CompactProjectDrawer } from '../layout/CompactProjectDrawer';
import { compactProjectDrawerWidth, usesCompactWorkspace } from '../layout/compactWorkspace';
import { SoftwareKeyboardViewport } from '../layout/SoftwareKeyboardViewport';
import { useWorkspaceSplitController } from '../layout/useWorkspaceSplitController';
import type { WorkspaceAttachment, WorkspaceMessage } from '../workspace/workspaceTypes';
import type { GatewayStatus } from '../gateway/OpenClawClient';
import { providerQuotaForProject, type ProviderQuotaPresentation } from '../gateway/providerQuota';
import { PaneFontPinchSurface } from '../ui/PaneFontPinchSurface';
import { guardedBackgroundTaskDetail, launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { usePromptKeyboardController } from '../prompt/usePromptKeyboardController';
import { AppUpdateNotice } from '../updates/AppUpdateNotice';
import { useAppUpdateNotice } from '../updates/useAppUpdateNotice';
import { useSessionTranscriptNavigation } from '../transcript/useSessionTranscriptNavigation';
import type { AppShellFixtureProps } from './appShellFixtures';
import { BottomSafeAreaChrome } from './BottomSafeAreaChrome'; import { ProjectFilesPane } from '../projectFiles/ProjectFilesPane'; import { projectFilesPresentationForDevice } from '../projectFiles/projectFilesPresentation'; import { projectFilesStatusPosition } from '../projectFiles/projectFilesStatusPosition'; import { useAppShellProjectFiles } from './useAppShellProjectFiles';
export function AppShell({ fixtureMessages, fixtureRunActive = false, fixtureGatewayStatus, fixtureProviderQuota, fixturePromptAttachments, fixtureUpdateNotice, fixtureProjectRailStartup, fixtureProjectRail, fixtureProjectFiles, fixtureOlderHistory }: AppShellFixtureProps = {}) {
  const { gateway, displayedRunActive } = useAppShellGateway({ fixtureMessages, fixtureRunActive, fixtureGatewayStatus, fixtureProviderQuota, fixturePromptAttachments, fixtureUpdateNotice, fixtureProjectRailStartup, fixtureProjectRail, fixtureProjectFiles });
  const viewport = useWindowDimensions();
  const [projectsVisible, setProjectsVisible] = useState(true);
  const [columnContainerWidth, setColumnContainerWidth] = useState(viewport.width);
  const compactWorkspace = usesCompactWorkspace(viewport.width, viewport.height);
  const isPadDevice = Platform.OS === 'ios' && Platform.isPad;
  const projectDrawerWidth = compactProjectDrawerWidth(viewport.width, isPadDevice ? 'pad' : 'phone');
  const [fixtureSubmissions, setFixtureSubmissions] = useState<WorkspaceMessage[]>([]);
  const displayedMessages = useMemo(() => fixtureMessages ? [...fixtureMessages, ...fixtureSubmissions] : gateway.messages, [fixtureMessages, fixtureSubmissions, gateway.messages]);
  const transcriptDisplay = useTranscriptDisplayOptions(displayedMessages, gateway.messageSessionKey);
  const [prompt, setPrompt, promptRef] = useSynchronousState(() => createPromptState()); const [promptNavigationRequest, setPromptNavigationRequest] = useState<PromptNavigationRequest | null>(null);
  const displayedSelectedKey = fixtureProjectRail?.selectedKey ?? gateway.selectedKey; const displayedProjects = fixtureProjectRail?.projects ?? gateway.projects;
  const promptHistory = usePromptHistoryController(displayedSelectedKey, prompt, promptRef, setPrompt);
  const [focusRouting, setFocusRouting, focusRoutingRef] = useSynchronousState(() => createFocusRouting(fixtureMessages ? 'transcript' : 'prompt'));
  const projectFilesFocusOwner = useRef<{ releaseFocus: () => void } | null>(null); const focus = (target: WorkspaceFocus) => { projectFilesFocusOwner.current?.releaseFocus(); if (target === 'projects') setProjectsVisible(true); setFocusRouting((current) => focusWorkspaceTarget(current, target)); };
  const closeCompactProjects = () => setFocusRouting((current) => focusWorkspaceTarget(current, current.rememberedTerminal));
  const promptKeyboard = usePromptKeyboardController(
    (selection) => { setPrompt((current) => enterPromptInsertMode(selection ? setNativeSelection(current, selection) : current)); focus('prompt'); },
    () => setPrompt((current) => current.mode === 'insert' ? handlePromptKey(current, { key: 'escape' }).state : current),
  );
  const captureTranscriptBeforeProjectSwitch = useRef<() => void>(() => undefined);
  const railStartupAuthority = fixtureProjectRailStartup ?? (fixtureProjectRail ? { paired: true, registryReady: true } : { paired: Boolean(gateway.profile), registryReady: gateway.projectsReady });
  const railStartup = useMemo(() => projectRailStartupPresentation(displayedProjects, {
    paired: railStartupAuthority.paired, registryReady: railStartupAuthority.registryReady, fixture: Boolean(fixtureMessages || fixtureProjectRail),
  }), [displayedProjects, fixtureMessages, fixtureProjectRail, railStartupAuthority.paired, railStartupAuthority.registryReady]);
  const projectRail = useProjectRailController(railStartup.projects, displayedSelectedKey, (key) => {
    captureTranscriptBeforeProjectSwitch.current();
    if (!fixtureProjectRail) gateway.selectProject(key);
    focus('prompt');
  }, (key) => { if (!fixtureProjectRail) launchGuardedBackgroundTask(async () => { setVimStatus('removing thread…'); await gateway.submit(':close-thread', [], key); setVimStatus(''); }, (error) => setVimStatus(guardedBackgroundTaskDetail(error, 'close thread failed'))); });
  const [connectionEditing, setConnectionEditing] = useState(false);
  const transcriptBufferCache = useRef<{ messages: readonly WorkspaceMessage[]; buffer: ReturnType<typeof createTranscriptBuffer> }>({ messages: [], buffer: createTranscriptBuffer([]) });
  const transcriptBuffer = useMemo(() => {
    const cached = transcriptBufferCache.current;
    const next = updatedTranscriptBuffer(cached.messages, cached.buffer, transcriptDisplay.messages);
    transcriptBufferCache.current = { messages: transcriptDisplay.messages, buffer: next };
    return next;
  }, [transcriptDisplay.messages]);
  const activeTranscriptBufferRef = useRef(transcriptBuffer);
  useLayoutEffect(() => { activeTranscriptBufferRef.current = transcriptBuffer; }, [transcriptBuffer]);
  const [transcriptNavigation, setTranscriptNavigation, transcriptNavigationRef] = useSynchronousState(() => createTranscriptVimState(createTranscriptBuffer([])));
  const projectTranscriptNavigation = useCallback((expected: typeof transcriptNavigation, projected: typeof transcriptNavigation) => {
    setTranscriptNavigation((current) => authorizedTranscriptProjection(current, expected, projected));
  }, [setTranscriptNavigation]);
  const [search, setSearch, searchRef] = useSynchronousState<SearchSession | null>(null);
  const [command, setCommand, commandRef] = useSynchronousState<CommandSession | null>(null);
  const [vimStatus, setVimStatus] = useState('');
  const commandHistory = useCommandHistoryOwner(setVimStatus);
  const commandLineActions = workspaceCommandLineActions({ historyRef: commandHistory.historyRef, commandRef, searchRef, setCommand, setSearch, commands: gateway.commands, modelChoices: gateway.modelChoices });
  const [paneSearches, setPaneSearches, paneSearchesRef] = useSynchronousState<Record<WorkspaceFocus, string>>({ projects: '', transcript: '', prompt: '' });
  const [, setPaneSearchDirections, paneSearchDirectionsRef] = useSynchronousState<Record<WorkspaceFocus, 1 | -1>>({ projects: 1, transcript: 1, prompt: 1 });
  const launchWorkspaceTask = (task: () => unknown | Promise<unknown>, fallback: string) => launchGuardedBackgroundTask(task, (error) => setVimStatus(guardedBackgroundTaskDetail(error, fallback))); const restoreLatestHistory = () => launchWorkspaceTask(gateway.restoreLatestHistory, 'latest history restore failed');
  const paneFontScales = usePaneFontScales();
  const workspaceSplit = useWorkspaceSplitController(viewport.height);
  const [pendingSubmissions, setPendingSubmissions] = useState(0);
  const promptAttachments = usePromptAttachmentController(gateway.selectedKey, setVimStatus);
  const appUpdateNotice = useAppUpdateNotice(pendingSubmissions > 0 ? 'submission' : promptAttachments.pendingDrafts ? 'attachments' : null, () => gateway.selectedKey ? saveDraft(gateway.selectedKey, promptRef.current.text) : Promise.resolve());
  const paneShortcutPrefix = useRef(false);
  const submissionGate = useRef(new SessionSubmissionGate());
  const pendingSubmissionTailReveal = useRef(new SessionTailRevealRegistry());
  const displayedPromptAttachments = fixturePromptAttachments ?? promptAttachments.attachments;
  const transcript = useRef<TranscriptPaneHandle>(null);
  const olderHistory = fixtureOlderHistory ?? {
    canLoadOlder: gateway.canLoadOlder,
    loadingOlder: gateway.loadingOlder,
    historyProblem: gateway.historyProblem,
    loadOlderHistory: gateway.loadOlderHistory,
  };
  const { mediaViewer, setMediaViewer, shortcuts, showShortcuts, closeShortcuts, handleOverlayKey } = useWorkspaceOverlays(displayedSelectedKey, promptKeyboard.hide);
  const project = projectRail.orderedProjects.find((value) => value.sessionKey === displayedSelectedKey) ?? projectRail.projects[0];
  const projectFilesUI = useAppShellProjectFiles({ resolveFileLocation: gateway.resolveFileLocation, listLocatedFiles: gateway.listLocatedFiles, readLocatedFile: gateway.readLocatedFile, readLocatedFileForSharing: gateway.readLocatedFileForSharing, project, projects: projectRail.orderedProjects, fixture: fixtureProjectFiles, isPad: isPadDevice, listProjectFiles: gateway.listProjectFiles, readProjectFile: gateway.readProjectFile, resolveSharedFile: gateway.resolveSharedFile, listSharedFiles: gateway.listSharedFiles, readSharedFile: gateway.readSharedFile, setPrompt, setStatus: setVimStatus, focusPrompt: () => focus('prompt'), hidePromptKeyboard: promptKeyboard.hide, beforeOpen: () => { if (focusRoutingRef.current.target === 'projects') closeCompactProjects(); } });
  projectFilesFocusOwner.current = projectFilesUI; const projectFiles = projectFilesUI.browser; const projectFilesFocused = projectFilesUI.focused; const openProjectFiles = projectFilesUI.open;
  const columns = useWorkspaceColumns({ width: Math.min(columnContainerWidth, viewport.width), projectsVisible: !compactWorkspace && projectsVisible, filesVisible: isPadDevice && projectFiles.open });
  const compactConversation = compactWorkspace || columns.conversationWidth < 640;
  const focusConversation = () => { if (!isPadDevice) projectFiles.close(); focus(focusRoutingRef.current.rememberedTerminal); };
  const toggleProjects = () => {
    if (compactWorkspace) { if (focusRoutingRef.current.target === 'projects') closeCompactProjects(); else { if (!isPadDevice) projectFiles.close(); focus('projects'); } }
    else { setProjectsVisible(!projectsVisible); if (projectsVisible && focusRoutingRef.current.target === 'projects') focusConversation(); else if (!projectsVisible) focus('projects'); }
  };
  const focusedPane = focusRouting.target;
  const runPresentationCommand = (input: string) => {
    if (!colonCommandInput(input)) return false;
    const transcriptMessage = transcriptDisplay.applyCommand(input); if (transcriptMessage) { setVimStatus(transcriptMessage); return true; }
    const [name = '', ...argumentsList] = input.trim().split(/\s+/); if (name.toLocaleLowerCase() === ':update-notes') { setVimStatus(argumentsList.length ? 'usage: :update-notes' : (fixtureUpdateNotice ?? appUpdateNotice).showNotes()); return true; }
    if (name.toLocaleLowerCase() === ':files') { if (argumentsList.length) setVimStatus('usage: :files'); else openProjectFiles(); return true; }
    if ([':help', ':h', ':shortcuts'].includes(name.toLocaleLowerCase())) { if (argumentsList.length) setVimStatus('usage: :help'); else showShortcuts(); return true; }
    if (name.toLocaleLowerCase() !== ':thread-sort') return false; setVimStatus(projectRail.applyThreadSortCommand(argumentsList.join(' '))); return true;
  };
  const sessionTranscriptNavigation = useSessionTranscriptNavigation({ sessionKey: gateway.messageSessionKey, buffer: transcriptBuffer, navigationRef: transcriptNavigationRef, setNavigation: setTranscriptNavigation, viewportRef: transcript, tailReveal: pendingSubmissionTailReveal.current });
  captureTranscriptBeforeProjectSwitch.current = sessionTranscriptNavigation.captureCurrentSession;
  const submit = async () => {
    const currentPrompt = promptRef.current;
    const submissionSessionKey = gateway.selectedKey;
    const stagedAttachments = promptAttachments.snapshot(submissionSessionKey);
    if (!currentPrompt.text.trim() && !stagedAttachments.length) return;
    if (promptAttachments.isImporting(submissionSessionKey)) { setVimStatus('Still attaching media. Wait for the attachment chip before sending.'); return; }
    if (colonCommandInput(currentPrompt.text) && stagedAttachments.length) { setVimStatus('Remove attachments before running a colon command.'); return; }
    if (fixtureMessages) {
      if (!submissionGate.current.acquire(submissionSessionKey)) return; setPendingSubmissions((count) => count + 1);
      const sentText = currentPrompt.text;
      const startedAt = performance.now();
      try {
        setPrompt(clearedForSubmission(currentPrompt));
        pendingSubmissionTailReveal.current.arm(submissionSessionKey);
        setFixtureSubmissions((current) => [...current, {
          id: `fixture-local-${Date.now()}`,
          role: 'user',
          text: sentText,
          source: 'local',
          timestamp: new Date().toISOString(),
        }]);
        transcript.current?.reveal(Number.MAX_SAFE_INTEGER, true, 'tail');
        promptHistory.recordSubmitted(sentText);
        requestAnimationFrame(() => setVimStatus(`optimistic send painted in ${Math.round(performance.now() - startedAt)}ms`));
      } finally { submissionGate.current.release(submissionSessionKey); setPendingSubmissions((count) => count - 1); }
      return;
    }
    if ([':noh', ':nohlsearch'].includes(colonCommandInput(currentPrompt.text)?.toLocaleLowerCase() ?? '')) {
      setPaneSearches({ projects: '', transcript: '', prompt: '' });
      setTranscriptNavigation((current) => clearTranscriptSearch(current));
      setPrompt((current) => ({ ...createPromptState(''), authority: current.authority + 1, register: current.register, registerKind: current.registerKind, registerRevision: current.registerRevision }));
      setVimStatus('search highlights cleared');
      return;
    }
    if (runPresentationCommand(currentPrompt.text)) { setPrompt((current) => ({ ...createPromptState(''), authority: current.authority + 1, register: current.register, registerKind: current.registerKind, registerRevision: current.registerRevision })); return; }
    if (!submissionGate.current.acquire(submissionSessionKey)) return; setPendingSubmissions((count) => count + 1);
    const sentText = currentPrompt.text;
    setPrompt(clearedForSubmission(currentPrompt));
    const ownsSourceTailReveal = submissionOwnsSourceTailReveal(sentText); if (ownsSourceTailReveal) pendingSubmissionTailReveal.current.arm(submissionSessionKey);
    try {
      const outcome = await guardedPromptSubmission(() => {
        const submission = gateway.submit(sentText, () => promptAttachments.payloads(submissionSessionKey, stagedAttachments), submissionSessionKey, stagedAttachments);
        // Arm tail ownership alongside the optimistic row, before history refresh.
        if (ownsSourceTailReveal) transcript.current?.reveal(Number.MAX_SAFE_INTEGER, true, 'tail');
        return submission;
      });
      if (outcome.kind === 'accepted') {
        promptAttachments.clear(submissionSessionKey, stagedAttachments);
        promptHistory.recordSubmitted(sentText);
      } else {
        pendingSubmissionTailReveal.current.cancel(submissionSessionKey);
        promptHistory.restoreRejected(sentText);
        if (outcome.kind === 'failed') setVimStatus(outcome.detail);
      }
    } finally { submissionGate.current.release(submissionSessionKey); setPendingSubmissions((count) => count - 1); }
  };
  const onTranscriptKey = (event: HardwareKeyEvent) => {
    const buffer = activeTranscriptBufferRef.current;
    if (routeTranscriptQuestionKey({ buffer, navigation: transcriptNavigationRef.current, sourceRows: transcript.current?.navigationSourceRows() ?? [], messages: transcriptDisplay.messages, event, select: setTranscriptNavigation, reveal: row => transcript.current?.revealAfterRevision(row, 0),
      handle: (message, key, entry) => message.question ? gateway.questions.handleKey(message.question, key, entry) : gateway.asyncQuestions?.handleKey(message, key, entry) ?? false })) return;
    const normalizedKey = normalizedHardwareKey(event);
    const cleanNormalState = !transcriptNavigationRef.current.pending
      && !transcriptNavigationRef.current.count
      && !transcriptNavigationRef.current.visualMode;
    if (requestsOlderTranscriptAtReviewTop(
      event,
      transcriptNavigationRef.current.cursor.row,
      transcript.current?.navigationSourceRows() ?? [],
      cleanNormalState,
    ) && transcript.current?.requestOlderHistory()) return;
    if (requestsNewerTranscriptAtReviewBottom(event, transcriptNavigationRef.current.cursor.row, transcript.current?.navigationSourceRows() ?? [], cleanNormalState) && transcript.current?.requestNewerHistory()) return;
    const fold = transcript.current?.foldAtSourceRow(transcriptNavigationRef.current.cursor.row);
    const recovery = transcript.current?.recoveryAtSourceRow(transcriptNavigationRef.current.cursor.row);
    const disclosure = transcriptDisclosureCommandForKey(transcriptNavigationRef.current, event, fold, recovery);
    if (disclosure?.type === 'fold') {
      const next = focusTranscriptMessage(buffer, transcriptNavigationRef.current, disclosure.target.messageIndex, transcriptFoldLineInMessage(buffer, disclosure.target.messageIndex, disclosure.target.sourceRow));
      setTranscriptNavigation(next);
      transcript.current?.setFoldExpanded(disclosure.target.messageId, disclosure.expanded, disclosure.target.sourceRow);
      return;
    }
    if (disclosure?.type === 'recover') { launchWorkspaceTask(() => gateway.recoverMessage(disclosure.messageId), 'message recovery failed'); return; }
    if (normalizedKey === 'enter' && !event.shift && !event.control && !event.command && !event.option && cleanNormalState) { const cursor = transcriptNavigationRef.current.cursor; const link = transcript.current?.linkAtSourceCursor(cursor.row, cursor.column); if (link) { void projectFilesUI.linkOpener.openLink(link); return; } }
    if (normalizedKey === 'G' && !transcriptNavigationRef.current.pending && !transcriptNavigationRef.current.count) restoreLatestHistory();
    const previousNavigation = transcriptNavigationRef.current; const result = handleTranscriptKey(buffer, previousNavigation, event, transcript.current?.navigationSourceRows(), transcript.current?.renderedLineAtSourceRow);
    setTranscriptNavigation(result.state);
    if (result.effect.type === 'start-search') beginSearch('transcript');
    if (result.effect.type === 'yank' && result.effect.text) {
      setPrompt((current) => ({ ...current, register: result.effect.type === 'yank' ? result.effect.text : current.register, registerKind: result.effect.type === 'yank' ? 'character' : current.registerKind }));
      VimicateEditor.setClipboardText(result.effect.text);
      setVimStatus(`${result.effect.text.split('\n').length} line${result.effect.text.includes('\n') ? 's' : ''} yanked`);
    }
    if (result.effect.type === 'toggle-fold') {
      const line = transcriptLineAt(buffer, result.state.cursor.row);
      const target = transcript.current?.foldAtSourceRow(result.state.cursor.row);
      if (line?.messageId === result.effect.messageId) {
        setTranscriptNavigation(focusTranscriptMessage(buffer, result.state, line.messageIndex, transcriptFoldLineInMessage(buffer, line.messageIndex, target?.sourceRow ?? result.state.cursor.row)));
      }
      transcript.current?.toggleFold(target?.messageId ?? result.effect.messageId, result.state.cursor.row);
    }
    if (result.effect.type === 'handoff') handoffResponse(result.effect.variant);
    if (result.handled && !result.state.pending && !result.state.count) transcript.current?.reveal(result.state.cursor.row, false, result.state.followTail ? 'tail' : 'review', previousNavigation.cursor.row);
  };
  const handoffResponse = (variant: TranscriptHandoffVariant) => {
    const buffer = activeTranscriptBufferRef.current;
    const navigation = transcriptNavigationRef.current;
    const line = focusedTranscriptLine(buffer, navigation);
    const message = line ? transcriptDisplay.messages[line.messageIndex] : null;
    if (!line || !message) return;
    const payload = composeTranscriptHandoff(message, line.lineInMessage, navigation.cursor.column, variant);
    setPrompt((current) => insertPromptHandoff(current, payload.text, payload.caretOffset));
    setVimStatus(payload.shape === 'quoted' ? 'quoted text handed to prompt' : `${payload.shape} response handed to prompt`);
    focus('prompt');
  };
  const onProjectKey = (event: HardwareKeyEvent) => {
    projectRail.handleKey(event, () => { setProjectsVisible(false); closeCompactProjects(); });
  };
  const beginSearch = (scope: WorkspaceFocus, direction: 1 | -1 = 1) => {
    setSearch({ scope, query: '', direction, softwareKeyboardEnabled: false });
    setVimStatus('');
  };
  const clearSearchHighlights = () => {
    setPaneSearches({ projects: '', transcript: '', prompt: '' });
    setPaneSearchDirections({ projects: 1, transcript: 1, prompt: 1 });
    setTranscriptNavigation((current) => clearTranscriptSearch(current));
    setVimStatus('search highlights cleared');
  };
  const applySearch = (scope: WorkspaceFocus, query: string, direction: 1 | -1, rememberDirection = false) => {
    if (!query.trim()) return;
    setPaneSearches((current) => ({ ...current, [scope]: query }));
    if (rememberDirection) setPaneSearchDirections((current) => ({ ...current, [scope]: direction }));
    if (scope === 'projects') {
      const result = projectRail.revealSearch(query, direction);
      setVimStatus(result.matched ? `/${query}` : `pattern not found: ${query}`);
      return;
    }
    if (scope === 'prompt') {
      const currentPrompt = promptRef.current;
      const cursor = findTextSearchMatch(currentPrompt.text, query, currentPrompt.visualCursor ?? currentPrompt.selection.end, direction);
      if (cursor !== null) setPrompt((current) => movePromptSearchCursor(current, cursor));
      setVimStatus(cursor !== null ? `/${query}` : `pattern not found: ${query}`);
      return;
    }
    const buffer = activeTranscriptBufferRef.current;
    const result = applyTranscriptSearch(buffer, transcriptNavigationRef.current, query, direction, transcript.current?.navigationSourceRows());
    setTranscriptNavigation(result.state);
    if (result.matched) transcript.current?.reveal(result.state.cursor.row, true);
    setVimStatus(result.matched ? `/${query}` : `pattern not found: ${query}`);
  };
  const submitSearch = () => {
    const currentSearch = searchRef.current;
    if (!currentSearch) return;
    const query = currentSearch.query.trim() || paneSearchesRef.current[currentSearch.scope];
    const scope = currentSearch.scope;
    setSearch(null);
    if (query) applySearch(scope, query, currentSearch.direction, true);
  };
  const handleSearchKey = (event: HardwareKeyEvent) => {
    const current = searchRef.current; if (!current) return;
    const result = handleCommandLineKey(current, event);
    if (result.action === 'cancel') { setSearch(null); return; }
    if (result.action === 'submit') { submitSearch(); return; }
    setSearch(result.state);
  };
  const submitCommand = async () => {
    const name = commandRef.current?.query.trim() ?? '';
    setCommand(null);
    if (!name) return;
    const commandHistoryWrite = commandHistory.record(name);
    if (commandHistoryWrite) launchWorkspaceTask(() => commandHistoryWrite, 'command history save failed');
    if (name === 'noh' || name === 'nohlsearch') { clearSearchHighlights(); return; }
    if (['w', 'write', 'send'].includes(name.toLocaleLowerCase())) { await submit(); return; }
    if (runPresentationCommand(`:${name}`)) return;
    const submitted = await gateway.submit(`:${name}`);
    setVimStatus(submitted ? `:${name}` : gateway.detail);
  };
  const handleCommandKey = (event: HardwareKeyEvent) => {
    const action = commandLineActions.handleKey(event);
    if (action === 'cancel') setCommand(null);
    if (action === 'submit') launchWorkspaceTask(submitCommand, 'command failed');
  };
  const dispatchHardwareKey = (event: HardwareKeyEvent) => {
    const normalized = normalizedHardwareKey(event);
    if (handleOverlayKey(event)) return;
    if ((event.command || event.control) && !event.option && (normalized === '+' || normalized === '=' || normalized === '-')) {
      const direction = normalized === '-' ? -1 : 1;
      const pane = projectFilesUI.focusedRef.current ? (projectFiles.region === 'list' ? 'filesList' : 'filesPreview') : focusRoutingRef.current.target;
      const next = paneFontScales.adjust(pane, direction);
      setVimStatus(`${pane === 'filesList' ? 'file list' : pane === 'filesPreview' ? 'file preview' : pane} font ${Math.round(next * 100)}%`);
      return;
    }
    const filesFocused = projectFilesUI.focusedRef.current;
    if (!filesFocused && focusRoutingRef.current.target === 'prompt' && promptRef.current.mode === 'insert' && event.text !== undefined) {
      setPrompt((current) => acceptNativeText(current, event.text ?? current.text, {
        start: event.selectionStart ?? current.selection.start,
        end: event.selectionEnd ?? current.selection.end,
      }, event.textAuthority));
    }
    if (!filesFocused && focusRoutingRef.current.target === 'projects' && normalized === 'escape') { setCommand(null); setSearch(null); paneShortcutPrefix.current = false; onProjectKey(event); return; }
    if (commandRef.current) { handleCommandKey(event); return; }
    if (searchRef.current) { handleSearchKey(event); return; }
    const prefixed = resolvePaneShortcutPrefix(paneShortcutPrefix.current, event,
      filesFocused || focusRoutingRef.current.target !== 'prompt' || promptRef.current.mode !== 'insert');
    paneShortcutPrefix.current = prefixed.pending;
    if (!prefixed.input) return;
    const routed = applyPaneShortcut(focusRoutingRef.current, prefixed.input, { filesOpen: projectFiles.open, filesFocused });
    if (routed.handled) {
      if (routed.state.target === 'projects') setProjectsVisible(true);
      if (routed.fileFocus === 'open') openProjectFiles();
      if (routed.fileFocus === 'acquire') projectFilesUI.requestFocus();
      if (routed.fileFocus === 'release') { if (isPadDevice) projectFilesUI.releaseFocus(); else projectFiles.close(); }
      setFocusRouting(routed.state);
      return;
    }
    if (filesFocused) { projectFiles.handleKey(prefixed.input); return; }
    if (promptHistory.handleBrowserKey(event)) return;
    if (focusRoutingRef.current.target === 'prompt') {
      const bridgedInsert = applyBridgedNativeInsert(promptRef.current, event);
      if (bridgedInsert) { setPrompt(bridgedInsert); return; }
    }
    if (compactWorkspace && event.command && normalized.toLocaleLowerCase() === 'p') {
      if (focusRoutingRef.current.target === 'projects') closeCompactProjects();
      else focus('projects');
      return;
    }
    const activePane = focusRoutingRef.current.target, currentPrompt = promptRef.current, raw = normalized;
    if (activePane === 'transcript' && !event.control && !event.command && !event.option && [':', '/', '?', 'n', 'N'].includes(raw)) { gateway.questions.interact(null); gateway.asyncQuestions?.ui.interact(null); }
    if (!event.control && !event.command && !event.option && raw === ':' && (activePane !== 'prompt' || currentPrompt.mode === 'normal')) { setCommand({ query: '', softwareKeyboardEnabled: false }); setVimStatus(''); return; }
    const searchDirection = vimSearchDirectionForKey(raw);
    if (!event.control && !event.command && !event.option && searchDirection && (activePane !== 'prompt' || currentPrompt.mode === 'normal')) { beginSearch(activePane, searchDirection); return; }
    if (!event.control && !event.command && !event.option && (raw === 'n' || raw === 'N')) {
      const query = paneSearchesRef.current[activePane];
      const direction = paneSearchDirectionsRef.current[activePane];
      if (query) { applySearch(activePane, query, repeatedVimSearchDirection(direction, raw)); return; }
    }
    if (activePane === 'projects') { onProjectKey(event); return; }
    if (activePane === 'transcript') { onTranscriptKey(event); return; }
    const result = handlePromptKey(currentPrompt, event);
    const clipboardText = promptClipboardText(currentPrompt, result.state);
    if (clipboardText) VimicateEditor.setClipboardText(clipboardText);
    promptRef.current = result.state;
    setPrompt(result.state);
    if (result.effect === 'submit') launchWorkspaceTask(submit, 'send failed');
    if (result.effect === 'focus-transcript') focus('transcript');
    if (result.effect === 'history-previous') promptHistory.navigate(-1);
    if (result.effect === 'history-next') promptHistory.navigate(1);
    if (result.effect === 'half-page-up' || result.effect === 'half-page-down') setPromptNavigationRequest((current) => ({ revision: (current?.revision ?? 0) + 1, key: result.effect === 'half-page-up' ? 'halfPageUp' : 'halfPageDown', scope: displayedSelectedKey, state: result.state }));
  };
  const keyboardOwner = `${displayedSelectedKey}:${projectFilesFocused ? 'files' : focusedPane}`;
  const { onHardwareKey, repeating: workspaceNavigationRepeating } = useWorkspaceHardwareKeys(dispatchHardwareKey, () => {
    const pane = projectFilesUI.focusedRef.current ? 'files' : focusRoutingRef.current.target;
    return { pane, pending: pane === 'prompt' ? promptRef.current.pending : pane === 'transcript' ? transcriptNavigationRef.current.pending : '', commandLineActive: Boolean(commandRef.current || searchRef.current || (pane === 'files' && projectFiles.searchQuery !== null)), scope: displayedSelectedKey };
  }, keyboardOwner);
  useEffect(() => { paneShortcutPrefix.current = false; }, [keyboardOwner]);
  useEffect(() => { if (focusedPane !== 'prompt' || projectFilesFocused) { promptKeyboard.hide(); promptHistory.closeBrowser(); } }, [focusedPane, projectFilesFocused]);
  const lineColumn = useMemo(() => textPosition(prompt.text, prompt.selection.end), [prompt.selection.end, prompt.text]); const displayedMode = projectFilesFocused && projectFiles.open ? 'files' : promptHistory.browser.open ? 'history' : workspaceModeLabel(focusedPane, prompt, transcriptNavigation);
  const providerQuota = fixtureProviderQuota ?? providerQuotaForProject(gateway.providerUsage, project, Date.now(), gateway.status);
  const adjustPaneFont = (pane: WorkspaceFocus | 'filesList' | 'filesPreview', direction: 1 | -1) => {
    const next = paneFontScales.adjust(pane, direction);
    setVimStatus(`${pane === 'filesList' ? 'file list' : pane === 'filesPreview' ? 'file preview' : pane} font ${Math.round(next * 100)}%`);
  };
  const projectsPane = (drawer: boolean) => <PaneFontPinchSurface style={[projectRailPinchSurfaceStyle(drawer), !drawer && { width: columns.projectsWidth }]} onStep={(direction) => adjustPaneFont('projects', direction)}><ProjectRail projects={projectRail.projects} emptyLabel={railStartup.emptyLabel} activeKey={displayedSelectedKey} focusedKey={projectRail.focusedKey} focused={focusedPane === 'projects' && !projectFilesFocused} fontScale={paneFontScales.scales.projects} reflowSuppressed={workspaceNavigationRepeating} sortMode={projectRail.sortMode} collapsedRootKeys={projectRail.collapsedRootKeys} onToggleSort={projectRail.toggleSort} onSelect={projectRail.activate} onToggleFold={projectRail.toggleFold} onToggleStar={gateway.toggleStar} onRefresh={() => { setVimStatus('refreshing projects and checking updates…'); launchWorkspaceTask(async () => { await gateway.refresh(); setVimStatus(`projects refreshed · ${await appUpdateNotice.check()}`); }, 'project refresh failed'); }} compactDrawer={drawer} onClose={drawer ? closeCompactProjects : undefined} /></PaneFontPinchSurface>;
  return (
    <GatewayArtifactContext value={gateway.resolveArtifact}><View style={styles.root}>
    <SafeAreaView accessibilityElementsHidden={Boolean(mediaViewer)} importantForAccessibility={mediaViewer ? 'no-hide-descendants' : 'auto'} style={styles.safe} edges={['top', 'left', 'right']}>
      <SoftwareKeyboardViewport>
      <View style={styles.app}>
        <PairingBar gateway={gateway} statusOverride={fixtureGatewayStatus} onEditingChange={setConnectionEditing} helpControl={<WorkspaceShortcutsButton onPress={showShortcuts} />} paneControls={<WorkspacePaneControls projectsVisible={compactWorkspace ? focusedPane === 'projects' : projectsVisible} filesVisible={projectFiles.open} focusedPane={projectFilesFocused ? 'files' : focusedPane} onToggleProjects={toggleProjects} onFocusConversation={focusConversation} onToggleFiles={() => { if (projectFiles.open) projectFiles.close(); else openProjectFiles(); }} />} />
        <View style={styles.main} onLayout={(event) => { const width = event.nativeEvent.layout.width; if (width > 0) setColumnContainerWidth(width); }}>
          {compactWorkspace || !projectsVisible ? null : <>{projectsPane(false)}<WorkspaceColumnDivider side="projects" width={columns.projectsWidth} panHandlers={columns.leftDividerPanHandlers} onResize={columns.resizeProjects} /></>}
          <View accessibilityElementsHidden={(compactWorkspace && focusedPane === 'projects') || (!isPadDevice && projectFiles.open)} importantForAccessibility={(compactWorkspace && focusedPane === 'projects') || (!isPadDevice && projectFiles.open) ? 'no-hide-descendants' : 'auto'} style={styles.workspace}>
            <WorkspaceHeader project={project} compact={compactConversation} />
            <View style={styles.workspaceBody} onLayout={(event) => workspaceSplit.onLayoutHeight(event.nativeEvent.layout.height)}>
              <PaneFontPinchSurface onStep={(direction) => adjustPaneFont('transcript', direction)}><TranscriptLinkOpenerProvider value={projectFilesUI.linkOpener}><TranscriptActionsProvider gateway={gateway}><TranscriptPane questionNotice={gateway.questionNotice} onLoadNewer={fixtureMessages ? undefined : (expanded, retainedBoundaryMessageID) => gateway.loadNewerHistory({ retainedBoundaryMessageID, expandedMessageIDs: expanded, displayOptions: transcriptDisplay.options, previousProjectedMessages: transcriptDisplay.messages })} hasNewerHistory={!fixtureMessages && gateway.hasNewerHistory} responseMessages={fixtureMessages ? displayedMessages : gateway.latestMessages ?? gateway.messages} onJumpToLatest={() => { sessionTranscriptNavigation.jumpToLatest(); if (!fixtureMessages) restoreLatestHistory(); }} datasetKey={gateway.messageSessionKey} ref={transcript} messages={transcriptDisplay.messages} buffer={transcriptBuffer} navigation={transcriptNavigation} focused={focusedPane === 'transcript' && !projectFilesFocused} fontScale={paneFontScales.scales.transcript} onFocus={() => focus('transcript')} onSelect={(messageIndex, lineInMessage) => setTranscriptNavigation((current) => focusTranscriptMessage(transcriptBuffer, current, messageIndex, lineInMessage))} onNavigationProjection={projectTranscriptNavigation} onViewportReview={sessionTranscriptNavigation.onViewportReview} onApprovalDecision={(message, decision) => launchWorkspaceTask(() => gateway.decideApproval(message, decision), 'approval update failed')} onRecoverMessage={(messageID) => launchWorkspaceTask(() => gateway.recoverMessage(messageID), 'message recovery failed')} onOpenMedia={(attachments, initialID) => setMediaViewer({ attachments, initialID })} canLoadOlder={olderHistory.canLoadOlder} loadingOlder={olderHistory.loadingOlder} historyProblem={olderHistory.historyProblem ?? ''} onLoadOlder={(expanded) => fixtureOlderHistory ? fixtureOlderHistory.loadOlderHistory() : gateway.loadOlderHistory({ expandedMessageIDs: expanded, displayOptions: transcriptDisplay.options, previousProjectedMessages: transcriptDisplay.messages })} onRetryHistory={(expanded) => launchWorkspaceTask(() => gateway.retryHistory({ expandedMessageIDs: expanded, displayOptions: transcriptDisplay.options, previousProjectedMessages: transcriptDisplay.messages }), 'history retry failed')} /></TranscriptActionsProvider></TranscriptLinkOpenerProvider></PaneFontPinchSurface>
              <WorkspaceDivider promptHeight={workspaceSplit.promptHeight} panHandlers={workspaceSplit.dividerPanHandlers} onResize={workspaceSplit.resize} />
              <PaneFontPinchSurface style={{ flex: 0, height: workspaceSplit.promptHeight }} onStep={(direction) => adjustPaneFont('prompt', direction)}><PromptPane navigationRequest={promptNavigationRequest} dropEnabled={!connectionEditing && !shortcuts && !mediaViewer && !gateway.questions.textEditing && !gateway.asyncQuestions?.ui.textEditing} sessionKey={displayedSelectedKey} onDrop={(event) => launchWorkspaceTask(() => promptAttachments.importDrop(event), 'drop import failed')} state={prompt} focusedPane={focusedPane} keyboardCapture={!connectionEditing && !gateway.questions.textEditing && !gateway.asyncQuestions?.ui.textEditing} inputBlocked={Boolean(shortcuts || mediaViewer || projectFilesFocused)} commandLineActive={Boolean(command || search)} commandLineNativeInputActive={Boolean(command || search)} commandHistoryActive={Boolean(command)} softwareKeyboardRequested={promptKeyboard.requested} softwareKeyboardForced={promptKeyboard.forced} fontScale={paneFontScales.scales.prompt} height={workspaceSplit.promptHeight} sending={displayedRunActive} attachments={displayedPromptAttachments} importing={promptAttachments.importing} attachmentLimitReached={displayedPromptAttachments.length >= MAX_PROMPT_ATTACHMENTS} compact={compactConversation} historyBrowser={promptHistory.browser} onState={setPrompt} onFocusPrompt={promptKeyboard.activateFromTouch} onRequestPromptFocus={() => focus('prompt')} onHardwareKeyboardChange={promptKeyboard.recordHardware} onHardwareKey={onHardwareKey} onCommandHistory={commandLineActions.recall} onPastedAttachment={promptAttachments.stagePastedAttachment} onPastedCommandLineText={commandLineActions.paste} onSubmit={() => launchWorkspaceTask(submit, 'send failed')} onAbort={() => launchWorkspaceTask(gateway.abort, 'abort failed')} onPickDocument={() => launchWorkspaceTask(promptAttachments.pickDocument, 'document import failed')} onPickImage={() => launchWorkspaceTask(promptAttachments.pickImage, 'image import failed')} onPreviewAttachment={(id) => { const viewer = promptAttachmentViewer(displayedPromptAttachments, id); if (viewer) setMediaViewer(viewer); }} onRemoveAttachment={promptAttachments.remove} onOpenCommand={() => { setCommand({ query: '', softwareKeyboardEnabled: true }); setVimStatus(''); }} onOpenNewThread={() => { setCommand({ query: 'new-thread ', softwareKeyboardEnabled: true }); setVimStatus(''); }} onToggleHistory={promptHistory.toggleBrowser} onCloseHistory={promptHistory.closeBrowser} onAcceptHistory={promptHistory.acceptBrowser} /></PaneFontPinchSurface>
            </View>
          </View>
          {isPadDevice && projectFiles.open ? <WorkspaceColumnDivider side="files" width={columns.filesWidth} panHandlers={columns.rightDividerPanHandlers} onResize={columns.resizeFiles} /> : null}
          <ProjectFilesPane onFontStep={(region, direction) => adjustPaneFont(region === 'list' ? 'filesList' : 'filesPreview', direction)} controller={projectFiles} rootLabel={projectFilesUI.rootLabel} rootPath={projectFilesUI.rootPath} listFontScale={paneFontScales.scales.filesList} previewFontScale={paneFontScales.scales.filesPreview} presentation={projectFilesPresentationForDevice(Platform.OS, Boolean(isPadDevice))} width={columns.filesWidth} focused={projectFilesFocused} onRequestFocus={projectFilesUI.requestFocus} onOpenMedia={(attachments, initialID) => setMediaViewer({ attachments, initialID })} />
          {compactWorkspace ? <CompactProjectDrawer visible={focusedPane === 'projects'} width={projectDrawerWidth} onOpen={() => focus('projects')} onDismiss={closeCompactProjects}>{projectsPane(true)}</CompactProjectDrawer> : null}
        </View>
        <BottomSafeAreaChrome>
          <AppUpdateNotice notice={fixtureUpdateNotice ?? appUpdateNotice} />
          {search || command ? <WorkspaceCommandBar search={search} command={command} commands={gateway.commands} modelChoices={gateway.modelChoices} onQueryChange={commandLineActions.updateQuery} onSubmit={() => { if (commandRef.current) launchWorkspaceTask(submitCommand, 'command failed'); else submitSearch(); }} onCancel={commandLineActions.cancel} onComplete={commandLineActions.complete} onSelectCompletion={commandLineActions.selectCompletion} onHistory={commandLineActions.recall} /> : (
            <StatusLine mode={displayedMode} path={project?.path ?? '~'} branch={project?.branch ?? ''} detail={vimStatus || gateway.detail} quota={providerQuota} onRefreshQuota={() => launchWorkspaceTask(gateway.refreshProviderUsage, 'quota refresh failed')} usage={sessionUsage(project)} position={projectFilesFocused && projectFiles.open ? projectFilesStatusPosition(projectFiles) : focusedPane === 'transcript' ? `${transcriptNavigation.cursor.row + 1}:${transcriptNavigation.cursor.column + 1}` : `${lineColumn.line}:${lineColumn.column}`} compact={compactWorkspace} />
          )}
        </BottomSafeAreaChrome>
      </View>
      </SoftwareKeyboardViewport>
    </SafeAreaView>
    {mediaViewer ? <TranscriptMediaViewer attachments={mediaViewer.attachments} initialID={mediaViewer.initialID} onClose={() => setMediaViewer(null)} /> : null}{shortcuts ? <WorkspaceShortcuts commands={gateway.commands} onClose={closeShortcuts} /> : null}
    </View></GatewayArtifactContext>
  );
}
