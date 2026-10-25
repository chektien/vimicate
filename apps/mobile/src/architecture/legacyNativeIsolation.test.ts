// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const productionExtensions = /\.(?:ts|tsx|swift|m|mm|h)$/;

function productionFiles(path: string): string[] {
  const absolutePath = resolve(process.cwd(), path);
  // SwiftPM emits a runner with absolute source paths here. It is generated
  // test output, never an input to the iOS pod or this package's source target.
  if (absolutePath === resolve(process.cwd(), 'modules/vimicate-file-links/.build')) return [];
  if (absolutePath === resolve(process.cwd(), 'modules/vimicate-diagnostics/.build')) return [];
  if (!lstatSync(absolutePath).isDirectory()) return [absolutePath];
  return readdirSync(absolutePath).flatMap((name: string) => productionFiles(resolve(path, name)));
}

describe('RN architecture isolation invariants', () => {
  it('compiles fatal diagnostic tests from the same Foundation leaf used by the native observer', () => {
    const manifest = source('modules/vimicate-diagnostics/Package.swift');
    expect(manifest).toContain('path: "ios"');
    expect(manifest).toContain('sources: ["VimicateFatalDiagnostic.swift"]');
    expect(manifest).not.toContain('.build');
    expect(productionFiles('modules')).toContain(resolve(process.cwd(), 'modules/vimicate-diagnostics/ios/VimicateFatalDiagnostic.swift'));
  });

  it('compiles the Files readiness native tests from the real iOS leaf', () => {
    const manifest = source('modules/vimicate-file-links/Package.swift');
    expect(manifest).toContain('path: "ios"');
    expect(manifest).toContain('"VimicateFileBookmarkStore.swift"');
    expect(manifest).toContain('"VimicateFilePreviewPreparation.swift"');
    expect(manifest).toContain('"VimicateFileProviderMapping.swift"');
    expect(manifest).not.toContain('.build');
    expect(productionFiles('modules')).toContain(resolve(process.cwd(), 'modules/vimicate-file-links/ios/VimicateFileBookmarkStore.swift'));
    expect(productionFiles('modules')).toContain(resolve(process.cwd(), 'modules/vimicate-file-links/ios/VimicateFilePreviewPreparation.swift'));
    expect(productionFiles('modules')).toContain(resolve(process.cwd(), 'modules/vimicate-file-links/ios/VimicateFileProviderMapping.swift'));
  });

  it('contains every production source physically inside the RN workspace with no native-repo import', () => {
    const workspace = `${realpathSync(process.cwd())}/`;
    const files = ['App.tsx', ...productionFiles('src'), ...productionFiles('modules')]
      .filter((path: string) => productionExtensions.test(path) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path));
    const failures = files.flatMap((path: string) => {
      const relativePath = path.slice(workspace.length);
      if (lstatSync(path).isSymbolicLink()) return [`${relativePath}: symlink`];
      if (!`${realpathSync(path)}`.startsWith(workspace)) return [`${relativePath}: outside RN workspace`];
      const contents = readFileSync(path, 'utf8');
      return /\/Users\/[^/]+\/repos\/vimicate(?:\/|['"])/.test(contents)
        || /(?:from|require\s*\()\s*['"][^'"]*\.\.\/vimicate(?:\/|['"])/.test(contents)
        ? [`${relativePath}: native-repo source reference`]
        : [];
    });

    expect(failures).toEqual([]);
  });

  it('keeps scene lifecycle out of the mounted workspace root', () => {
    const appShell = source('src/app/AppShell.tsx');
    expect(appShell).not.toMatch(/AppState|applicationState|useAppState/);
    expect(appShell).not.toMatch(/return\s+.*(?:active|inactive)/);
    expect(appShell).not.toMatch(/NavigationContainer|Stack\.Navigator|Scene/);
  });



  it('uses one recycler-level viewport observer rather than per-row measurement', () => {
    const pane = source('src/transcript/TranscriptPane.tsx');
    const row = source('src/transcript/TranscriptSourceRow.tsx');
    const viewport = source('src/transcript/useTranscriptViewport.ts');
    expect(pane).toContain('<FlashList');
    expect(pane.match(/onLayout=/g)).toHaveLength(1);
    expect(viewport).toContain('createTranscriptViewportDiagnostics');
    expect(viewport).toContain('recordViewportDiagnostic');
    expect(pane).not.toContain('recordViewportDiagnostic');
    expect(row).not.toMatch(/onLayout|measure\(|Geometry/);
    expect(row).not.toContain('recordViewportDiagnostic');
    expect(row).toContain('{ paddingTop: firstGap }');
    expect(row).not.toContain('{ marginTop: firstGap }');
  });

  it('separates FlashList recycler topology from current row presentation', () => {
    const pane = source('src/transcript/TranscriptPane.tsx');
    expect(pane).toContain('data={recyclerTopology}');
    expect(pane).toContain('rowGeneration: rows');
    expect(pane).toContain('const item = rows[index]');
    expect(pane).not.toContain('const item = rowsRef.current[index]');
    expect(pane).not.toContain('data={rows}');
  });

  it('retires queued viewport writers before a newly selected transcript can paint', () => {
    const viewport = source('src/transcript/useTranscriptViewport.ts');
    expect(viewport).toContain('useInsertionEffect(() => {');
    expect(viewport).toContain("cancelTailWriter('dataset')");
    expect(viewport).toContain("cancelIndexedWriter('dataset')");
    expect(viewport).toContain("cancelPostLayoutFrame('dataset')");
    expect(viewport).toContain('shouldRunTranscriptViewportWriter');
    expect(viewport).toContain('gesture.endMomentum()');
    expect(source('src/transcript/transcriptScrollGesture.ts')).toContain('transcriptMomentumBelongsToUser(this.momentumExpected)');
    expect(viewport).not.toContain('requestAnimationFrame(triggerNearTop)');
  });

  it('recovers a populated recycler that settles without any visible source row', () => {
    const viewport = source('src/transcript/useTranscriptViewport.ts');
    const scheduler = source('src/transcript/transcriptBlankRecoveryScheduler.ts');
    expect(scheduler).toContain('shouldRecoverTranscriptBlankViewport');
    expect(scheduler).toContain("tailRange ? 'partial-content' : 'blank-content'");
    expect(scheduler).toContain('shouldRestoreTranscriptTailRange');
    expect(scheduler).toContain('new TranscriptBlankViewportRecoveryOwner(requestFrame, cancelFrame)');
    expect(viewport).toContain('ownsGeneration: (owner) => owner === revisionRef.current');
    expect(viewport).toContain('blankRecovery.settledVisible()');
    expect(viewport).toContain('scheduleBlankRecovery();');
  });

  it('rearms blank recovery for recycler topology changes without treating presentation as geometry', () => {
    const viewport = source('src/transcript/useTranscriptViewport.ts');
    const pane = source('src/transcript/TranscriptPane.tsx');
    const revisionEffect = viewport.slice(
      viewport.indexOf('useEffect(() => {\n    // `onScroll` belongs to the content generation'),
      viewport.indexOf('useEffect(() => () => {'),
    );
    expect(revisionEffect).toContain('scheduleBlankRecovery();');
    expect(revisionEffect).toContain('scheduleBlankRecovery, schedulePostLayoutFrame');
    expect(pane).toContain('useTranscriptViewport<TranscriptRenderRow>(datasetKey, recyclerTopology, rows.length');
    expect(pane).not.toContain('useTranscriptViewport<TranscriptRenderRow>(datasetKey, rows, rows.length');
    expect(pane).not.toContain("tail?.message.text.length");
  });

  it('keeps folded source coordinates sparse until an exact hidden line is requested', () => {
    const buffer = source('src/transcript/transcriptBuffer.ts');
    const search = source('src/transcript/transcriptMessageSearch.ts');
    const vim = source('src/transcript/transcriptVim.ts');
    expect(buffer).toContain('transcriptMessageIsFoldedByDefault');
    expect(buffer).toContain('lines.length = first + lineCount');
    expect(buffer).toContain('const sourceLineIndexes = new WeakMap');
    expect(buffer).toContain('export function transcriptLineAt');
    expect(vim).toContain("from './transcriptBuffer'");
    expect(vim).toContain("from './transcriptMessageSearch'");
    expect(vim).not.toContain("sourceText.split('\\n')");
    expect(search).toContain('visitTranscriptMessageSearchMatches');
    expect(search).toContain('nextTranscriptSearchCursor');
    expect(search).not.toContain('matches: TranscriptSearchCursor[]');
    expect(search).not.toContain("source.split('\\n')");
  });

  it('contains asynchronous native viewport and delayed-final recovery failures', () => {
    const viewport = source('src/transcript/useTranscriptViewport.ts');
    const finalRecovery = source('src/gateway/useGatewayFinalAnswerRecovery.ts');
    const gateway = source('src/gateway/OpenClawClient.ts');
    const livePublication = source('src/gateway/liveMessagePublication.ts');
    expect(viewport).toContain('launchGuardedBackgroundTask');
    expect(viewport).toContain("action: 'indexed-failed'");
    expect(viewport).toContain("action: 'tail-failed'");
    expect(finalRecovery).toContain('launchGuardedBackgroundTask(async () => {');
    expect(finalRecovery).not.toContain('})().finally(');
    expect(gateway).toContain('() => this.handleFrame(String(event.data), generation)');
    expect(gateway).toContain("this.reportEventFailure(error, 'event.handler-failed')");
    expect(livePublication).toContain('launchGuardedBackgroundTask(publish, onFailure)');
  });

  it('keeps the transcript container out of the accessibility tree so source rows remain individually reachable', () => {
    const pane = source('src/transcript/TranscriptPane.tsx');
    const row = source('src/transcript/TranscriptSourceRow.tsx');
    expect(pane).toContain('<Pressable accessible={false} onPress={onFocus}');
    expect(row).toContain('accessibilityRole="button"');
    expect(row).toContain('const rowAccessibilityLabel = `${message.role}, line ${row.sourceRow + 1}');
    expect(row).toContain('accessibilityLabel={rowAccessibilityLabel}');
    expect(row).toContain('<Pressable accessible={false} onPress={onPress}');
  });

  it('stores bounded session projections in SQLite WAL rather than preferences', () => {
    const store = source('src/storage/workspaceStore.ts');
    const cache = source('src/gateway/persistentTranscriptCache.ts');
    expect(store).toContain("import * as SQLite from 'expo-sqlite'");
    expect(store).toContain('PRAGMA journal_mode = WAL');
    expect(store).not.toMatch(/UserDefaults|AsyncStorage/);
    expect(store).toContain(
      'const persistence = new WorkspacePersistenceQueue(withPersistenceActivity, false)',
    );
    expect(store).toContain('setWorkspacePersistenceActive');
    expect(store).not.toContain('withExclusiveTransactionAsync');
    expect(cache).toContain('const CACHE_MESSAGE_LIMIT = 200');
    expect(cache).toContain('const CACHE_BYTE_LIMIT = 512_000');
  });

  it('suppresses equal transcript publications before scheduling persistence', () => {
    const history = source('src/gateway/useGatewayHistory.ts');
    const publication = source('src/gateway/sessionMessagePublication.ts');
    expect(publication).toContain('if (!sameTranscriptPublication(latest, result.latest))');
    expect(publication).toContain('return visibleChanged ? result.visible : visible');
    expect(history).toContain('useTranscriptPersistence(publicationAuthority, promptRefusals)');
    expect(source('src/gateway/useTranscriptPersistence.ts')).toContain('pendingPersistentWrites.current.set(sessionKey, rows)');
  });

  it('does not rerun navigation projection merely because live rows were republished', () => {
    const pane = source('src/transcript/TranscriptPane.tsx');
    const projectionEffect = pane.slice(
      pane.indexOf('useEffect(() => {\n    if (projectedNavigation.cursor.row'),
      pane.indexOf('const tail = rows.at(-1)'),
    );
    expect(projectionEffect).toContain('}, [navigation, projectedNavigation]);');
    expect(projectionEffect).not.toContain('[navigation, navigationRows, projectedNavigation]');
  });

  it('settles completed runs against the merged transcript turn rather than raw history metadata', () => {
    const history = source('src/gateway/useGatewayHistory.ts');
    const latest = source('src/gateway/latestHistoryLoading.ts');
    const completion = source('src/gateway/runCompletionMessage.ts');
    const runMonitor = source('src/gateway/useGatewayRunMonitor.ts');
    const recovery = source('src/gateway/useGatewayFinalAnswerRecovery.ts');
    expect(history).toContain('createLatestHistoryActions(historyActionsContext)');
    expect(latest).toContain('const publication = latestHistoryRefreshAction(');
    expect(latest).toContain('const published = publication(currentTail)');
    expect(latest).toContain("setHistoryMessages(sessionKey, publication, 'latest', ownsLatest)");
    expect(history).toContain(".visible, 'older', ownsPublication)");
    expect(history).not.toContain(".visible, 'older', ownsRequest)");
    expect(latest).toContain('return published');
    expect(completion).toContain('hasRenderedAssistantFinalForRun');
    expect(completion).toContain("message.role === 'user' && message.runId === runId");
    expect(runMonitor).toContain('latest && hasRenderedAssistantFinalForRun(latest, acceptedRunId)');
    // This boundary checks the shared authority, not the loop variable name.
    // Recovery lifetime tests exercise independent run settlement behavior.
    expect(recovery).toContain('hasRenderedAssistantFinalForRun(latest,');
  });

  it('requires an explicit session owner for every workspace transcript mutation', () => {
    const history = source('src/gateway/useGatewayHistory.ts');
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const submission = source('src/gateway/useGatewaySubmission.ts');
    expect(history).toContain('sessionOwnsVisiblePublication(sessionKey, selectedRef.current, activeSessionKey.current)');
    expect(workspace).not.toMatch(/\bsetMessages\s*\(/);
    expect(submission).not.toMatch(/\bsetMessages\s*\(/);
    expect(workspace).toContain('updateSessionMessages(publicationSessionKey');
    expect(workspace).toContain('approvalReconciliationCandidates(messagesRef.current, sessionKey)');
    expect(workspace).toContain('approvalReconciliationAction(pending, sessionKey, reconciliationCandidates, reconciliationNow)');
    expect(workspace).not.toContain('updateSessionMessages(sessionKey, reconciliation.messages)');
    expect(workspace).toContain('bindRunLifecycleSignal(observedLifecycle');
    expect(workspace).toContain('projectRegisteredGatewayEvent(frame, projectsRef.current)');
    expect(submission).toContain('updateSessionMessages(sessionKey');
  });

  it('lets the history-view owner distinguish first entry from an intentional review round trip', () => {
    const history = source('src/gateway/useGatewayHistory.ts');
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const view = source('src/gateway/sessionHistoryView.ts');
    const persistence = source('src/gateway/persistentHistoryReview.ts');
    expect(history).toContain('return threadEntryHistoryPresentation(restored)');
    expect(history).toContain("reviewEntryIntent.current = 'deliberate'");
    expect(view).toContain("restored.reviewEntryIntent === 'deliberate'");
    expect(persistence).toContain("reviewEntryIntent: 'fallback'");
    expect(workspace).toContain('await loadHistory(sessionKey, historyPresentation)');
    expect(workspace).not.toContain("await loadHistory(sessionKey, 'reveal-current')");
  });

  it('stages an accepted optimistic prompt in the session owner before React can defer its paint', () => {
    const submission = source('src/gateway/useGatewaySubmission.ts');
    const publication = source('src/gateway/sessionMessagePublication.ts');
    expect(submission).toMatch(/updateSessionMessages\(sessionKey, \(current\) => [^\n]*, 'optimistic-prompt'\)/);
    expect(publication).toContain("if (intent === 'optimistic-prompt')");
    expect(publication.indexOf("if (intent === 'optimistic-prompt')"))
      .toBeLessThan(publication.indexOf('if (!ownsVisible()) { publishParked(); return; }'));
    expect(publication).toContain('const staged = latestTailCache.current.restore(sessionKey) ?? current');
  });

  it('stages the destination prompt draft before a project-switch frame can paint', () => {
    const history = source('src/prompt/usePromptHistoryController.ts');
    const hydration = source('src/prompt/draftHydration.ts');
    expect(history).toContain('useLayoutEffect(() => {');
    expect(history).toContain('draftMemory.current.enter(sessionKey');
    expect(hydration).toContain('export class SessionPromptDraftMemory');
    expect(hydration).toContain("source: 'memory' | 'empty'");
  });

  it('does not decode persistence from the Gateway event path', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const eventPath = workspace.slice(workspace.indexOf('client.onEvent ='), workspace.indexOf("const appStateSubscription = AppState.addEventListener"));
    expect(eventPath).not.toMatch(/loadValue|loadTranscriptCache|SQLite|JSON\.parse/);
    expect(source('src/gateway/historyWindow.ts')).toContain('MAX_VISIBLE_HISTORY_ROWS = 480');
  });

  it('releases hardware-key ownership whenever the app or window resigns activity', () => {
    const editor = source('modules/vimicate-editor/ios/VimicateEditorView.swift');
    expect(editor).toContain('UIApplication.willResignActiveNotification');
    expect(editor).toContain('UIWindow.didResignKeyNotification');
    expect(editor).toContain('UIApplication.shared.applicationState == .active');
    expect(editor).toContain('window.isKeyWindow');
    expect(editor).toContain('suspendKeyboardOwnership()');
  });

  it('keeps shifted find and till commands registered while preserving Insert uppercase text', () => {
    const editor = source('modules/vimicate-editor/ios/VimicateEditorView.swift');
    expect(editor).toContain('let shiftedFindCommands: [(String, UIKeyModifierFlags)] = [("f", .shift), ("t", .shift)]');
    expect(editor).toContain('let shiftedFindCommand = !control && !option && !command && ["f", "t"].contains(value)');
    expect(editor).toContain('let shift = sender.modifierFlags.contains(.shift) || shiftedFindCommand');
    expect(editor).toContain('if vimMode == "insert", shift, !control, !option, !command, ["f", "t"].contains(value)');
    expect(editor).toContain('insertText(value.uppercased())');
    expect(editor).toContain('let shiftedFindCommandOwnsPress = vimMode == "normal"');
    expect(editor).toContain('shift || semanticShiftFallback(key, normalized: value, flags: flags)');
    expect(editor).toContain('guard !value.isEmpty else { return }');
    expect(editor).toContain('if shiftedFindCommandOwnsPress {');
    expect(editor.indexOf('if shiftedFindCommandOwnsPress')).toBeLessThan(editor.indexOf('prepareImmediateModeTransition(key: value, control: control)'));
    const shiftedOwner = editor.slice(editor.indexOf('if shiftedFindCommandOwnsPress'), editor.indexOf('prepareImmediateModeTransition(key: value, control: control)'));
    expect(shiftedOwner).not.toContain('super.pressesBegan');
    expect(shiftedOwner).toContain('deliveredShiftedFindUntilRelease = value');
    expect(shiftedOwner).toContain('emitHardwareKey(value, shift: true');
    expect(editor).toContain('let deliveredKeyEnded = presses.compactMap(\\.key).contains');
    expect(editor).toContain('if vimMode == "normal", shiftedFindCommand {');
    expect(editor).toContain('if deliveredShiftedFindUntilRelease == value { return }');
    expect(editor).toContain('deliveredShiftedFindUntilRelease = nil');
    expect(editor).not.toContain('deferredRawFind');
  });

  it('suppresses the software keyboard while a public hardware-keyboard connection is present', () => {
    const editor = source('modules/vimicate-editor/ios/VimicateEditorView.swift');
    expect(editor).toContain('GCKeyboard.coalesced != nil');
    expect(editor).toContain('.GCKeyboardDidConnect');
    expect(editor).toContain('.GCKeyboardDidDisconnect');
    expect(editor).toContain('softwareKeyboardEnabled && (softwareKeyboardForced || !hardwareKeyboardConnected)');
  });







  it('observes prompt taps without taking UIKit word-selection ownership', () => {
    const editor = source('modules/vimicate-editor/ios/VimicateEditorView.swift');
    const promptPane = source('src/prompt/PromptPane.tsx');
    expect(editor).toContain('override func touchesBegan');
    expect(editor).toContain('override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView?');
    expect(editor).toContain('let nativeTouchOwnsSelection = CACurrentMediaTime() <= touchSelectionDeadline');
    expect(editor).toContain('onEditorTouchBegan?()');
    expect(editor).toContain('self.editor.vimMode = "insert"');
    expect(editor).toContain('onEditorTap([');
    expect(editor).toContain('handleEditorInteraction(selection: textView.selectedRange)');
    expect(editor).toContain('pendingViews.append(contentsOf: view.subviews)');
    expect(editor).toContain('recognizer.addTarget(self, action: #selector(observeNativeTextInteraction(_:)))');
    expect(editor).toContain('onTouchSelectionActivity?()');
    expect(promptPane).toContain('nativeEvent.selectionStart');
    expect(editor).not.toContain('addGestureRecognizer(interactionObserver)');
    expect(promptPane).not.toContain('onTouchStart={onFocusPrompt}');
  });

  it('lets UIKit authorize explicit paste and routes supplied providers without direct pasteboard reads', () => {
    const editor = source('modules/vimicate-editor/ios/VimicateEditorView.swift');
    const menu = editor.slice(editor.indexOf('override func canPerformAction'), editor.indexOf('@objc private func handleHardwareKeyCommand'));
    expect(editor).toContain('UITextView, UITextPasteDelegate');
    expect(editor).toContain('pasteDelegate = self');
    expect(editor).toContain('func textPasteConfigurationSupporting(');
    expect(editor).toContain('let providers = [item.itemProvider]');
    expect(editor).toContain('item.setNoResult()');
    expect(editor).toContain('item.setDefaultResult()');
    expect(editor).toContain('override func paste(itemProviders: [NSItemProvider])');
    expect(editor).toContain('super.paste(itemProviders: itemProviders)');
    expect(editor).toContain('override func paste(_ sender: Any?)');
    expect(editor).toContain('let providers = UIPasteboard.general.itemProviders');
    expect(editor).toContain('super.paste(sender)');
    expect(editor).toContain('loadDataRepresentation(forTypeIdentifier:');
    expect(editor).toContain('if command, value == "v" {');
    expect(editor).toContain('super.pressesBegan(presses, with: event)');
    expect(editor).toContain('action: #selector(handlePasteKeyCommand(_:))');
    expect(editor).toContain('paste(sender)');
    expect(editor).toContain('} + [systemPasteCommand] + (super.keyCommands ?? [])');
    expect(editor).not.toContain('super.paste(nil)');
    expect(editor).not.toContain('(\"v\", .command)');
    expect(editor).not.toContain('if sender.modifierFlags.contains(.command), value == "v"');
    expect(editor.match(/UIPasteboard\.general/g)).toHaveLength(1);
    expect(menu).not.toContain('UIPasteboard.general');
  });

  it('routes prompt toolbar arrows through the public UIKit text-position API instead of fake keys or selectors', () => {
    const editor = source('modules/vimicate-editor/ios/VimicateEditorView.swift');
    const promptPane = source('src/prompt/PromptPane.tsx');
    expect(editor).toContain('editor.position(from: selection.end, in: direction, offset: 1)');
    expect(editor).toContain('editor.textRange(from: destination, to: destination)');
    expect(editor).not.toContain('NSSelectorFromString("move');
    expect(editor).not.toContain('editor.perform(selector');
    expect(editor).toContain('"userInitiated": true');
    expect(promptPane).toContain('navigationCommand={serializedNavigationCommand}');
    expect(promptPane).toContain('onPress={() => navigateFromToolbar(key)}');
    expect(promptPane).toContain('promptToolbarNavigationTarget(key, { commandLineActive, commandHistoryActive })');
  });

  it('tags queued native text callbacks with their controlled prompt authority', () => {
    const editor = source('modules/vimicate-editor/ios/VimicateEditorView.swift');
    expect(editor).toContain('"textAuthority": appliedTextAuthority');
    expect(source('src/prompt/PromptPane.tsx')).toContain('nativeEvent.textAuthority');
    expect(source('src/app/AppShell.tsx')).toContain('event.textAuthority');
  });

  it('keeps prompt attachment previews inside the fixed toolbar instead of resizing the editor', () => {
    const promptPane = source('src/prompt/PromptPane.tsx');
    expect(promptPane).toContain('<PromptAttachmentRail attachments={attachments}');
    expect(promptPane.indexOf('<PromptAttachmentRail attachments={attachments}')).toBeLessThan(promptPane.indexOf('<View style={styles.editorShell}'));
    expect(promptPane).not.toContain('styles.attachments');
  });
});
