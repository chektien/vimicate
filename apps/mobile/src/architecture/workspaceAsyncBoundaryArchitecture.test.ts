// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('workspace fire-and-forget ownership architecture', () => {
  it('arms source-tail handoff only for submissions that publish into that source transcript', () => {
    const shell = source('src/app/AppShell.tsx');

    expect(shell).toContain('const ownsSourceTailReveal = submissionOwnsSourceTailReveal(sentText);');
    expect(shell).toContain('if (ownsSourceTailReveal) pendingSubmissionTailReveal.current.arm(submissionSessionKey);');
    expect(shell).toContain("if (ownsSourceTailReveal) transcript.current?.reveal(Number.MAX_SAFE_INTEGER, true, 'tail');");
  });

  it('contains history restore and registry refresh failures at the workspace boundary', () => {
    const shell = source('src/app/AppShell.tsx');

    expect(shell).not.toContain('void gateway.restoreLatestHistory()');
    expect(shell).not.toContain('void gateway.refresh()');
    expect(shell.match(/launchWorkspaceTask\(gateway\.restoreLatestHistory, 'latest history restore failed'\)/g)).toHaveLength(1);
    expect(shell).toContain("onRefresh={() => { setVimStatus('refreshing projects and checking updates…'); launchWorkspaceTask(async () => { await gateway.refresh(); setVimStatus(`projects refreshed · ${await appUpdateNotice.check()}`); }, 'project refresh failed'); }}");
  });

  it('contains every pairing and camera permission callback at the pairing boundary', () => {
    const pairing = source('src/gateway/PairingBar.tsx');

    expect(pairing).not.toContain('onPress={async');
    expect(pairing).not.toMatch(/void (?:pairAndConnect|connectPrimary)\(/);
    expect(pairing).toContain("launchPairingTask(requestScanner, 'camera permission failed')");
    expect(pairing).toContain("launchPairingTask(connectPrimary, 'connection failed')");
    expect(pairing).toContain("launchPairingTask(() => pairAndConnect(data), 'pairing failed')");
  });

  it('discards live publication work while suspending and rejects inactive Gateway frames', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const suspendBranch = workspace.slice(
      workspace.indexOf("if (action === 'suspend')"),
      workspace.indexOf("} else if (action === 'resume')"),
    );

    expect(workspace.match(/if \(!gatewayAllowsLivePublication\(appActive\.current, suspendedByBackground\.current\)\) return;/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    const eventError = workspace.slice(workspace.indexOf('client.onEventError ='), workspace.indexOf('client.onIssuedDeviceToken ='));
    const issuedToken = workspace.slice(workspace.indexOf('client.onIssuedDeviceToken ='), workspace.indexOf('client.onEvent ='));
    expect(eventError).toContain('if (!gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) return;');
    expect(issuedToken).toContain('if (!gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) return;');
    expect(issuedToken).toContain("if (gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) setDetail('paired; shared Keychain update failed')");
    expect(suspendBranch).toContain('suspendLiveMessagePublication(');
    expect(suspendBranch).toContain('suspendHistoryPublication();');
    expect(suspendBranch).not.toContain('flushBufferedLiveMessages(');
  });

  it('rechecks transcript scene authority when React applies a queued live update', () => {
    const history = source('src/gateway/useGatewayHistory.ts');
    const update = source('src/gateway/sessionMessagePublication.ts');

    expect(history).toContain('useMemo(() => createSessionMessagePublisher({');
    expect(update).toContain('const activityRevision = publicationAuthority.current.capture();');
    expect(update).toContain('if (!publicationAuthority.current?.owns(activityRevision)) return current;');
  });

  it('does not publish an intentional disconnect through a late run monitor continuation', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const runMonitor = source('src/gateway/useGatewayRunMonitor.ts');
    const settlement = runMonitor.slice(
      runMonitor.indexOf('const waitForRunCompletion'),
      runMonitor.indexOf('const recoverActiveRuns'),
    );

    expect(workspace).toContain('scenePublicationAuthority: scenePublicationAuthority');
    expect(runMonitor).toContain('scenePublicationAuthority: { current: HistoryPublicationAuthority };');
    expect(settlement).toContain('const ownsContinuation = () => scenePublicationAuthority.current.owns(activityRevision)');
    expect(settlement).toContain('recoveryTasks.current.owns(sessionKey, owner)');
    expect(settlement).toContain('runRegistry.current.ownsRun(sessionKey, acceptedRunId)');
    expect(settlement.match(/if \(!ownsContinuation\(\)\) return;/g)).toHaveLength(4);
    expect(settlement).toContain('const publish = ownsContinuation();');
    expect(settlement).toContain('if (publish) publishSelectedRun(sessionKey);');
  });

  it('retires both fulfilled and rejected submit continuations at the scene boundary', () => {
    const submission = source('src/gateway/useGatewaySubmission.ts');

    expect(submission).toContain('scenePublicationAuthority: MutableRefObject<HistoryPublicationAuthority>;');
    expect(submission).toContain('const activityRevision = scenePublicationAuthority.current.capture();');
    expect(submission).toContain('submissionScene(ownsScene)');
    expect(source('src/gateway/submissionScene.ts')).toContain('if (!ownsScene()) throw sceneRetired;');
    expect(submission).toContain("if (error === sceneRetired) { delivery?.onState?.('unconfirmed'); return promptRowStands; }");
    expect(submission).toContain('if (ownsNewRunLifecycle) runRegistry.current.finishSubmission(sessionKey);');
    expect(submission).toContain('if (ownsScene()) {');
  });

  it('withdraws a standing prompt row only while the prompt provably never reached the Gateway', () => {
    const submission = source('src/gateway/useGatewaySubmission.ts');
    const client = source('src/gateway/OpenClawClient.ts');

    // A submission may not tell the prompt owner something its own transcript
    // publication has already claimed. Scene retirement is one way to lose the
    // answer to a frame that is already on the wire; a timeout or the reconnect
    // that rejects every pending request are the others, and none of them is a
    // refusal the app may answer by restoring the draft.
    expect(submission).toContain('const promptReachedGateway = promptRowStands && gatewayRequestReachedGateway(error);');
    expect(submission).toContain('if (!acceptedRunId && !promptReachedGateway) {');
    expect(client).toContain("throw gatewayRequestFailure('Gateway is not connected', false);");
    expect(client).toContain('pending.reachedGateway = true;');
    expect(client).toContain("gatewayRequestFailure('Gateway disconnected', entry.reachedGateway)");
  });

  it('rechecks the scene epoch after workspace registry and approval awaits', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const loadSessions = source('src/gateway/useGatewaySessionRefresh.ts');
    const approvals = workspace.slice(
      workspace.indexOf('const loadPendingApprovals = useCallback'),
      workspace.indexOf('const { startRunMonitor'),
    );

    expect(loadSessions).toContain('const activityRevision = scenePublicationAuthority.current.capture();');
    expect(loadSessions).toContain('client.connectionRevision === connectionRevision && scenePublicationAuthority.current.owns(activityRevision)');
    expect(loadSessions.match(/if \(!ownsPublication\(\)\) return/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(approvals).toContain('const activityRevision = scenePublicationAuthority.current.capture();');
    expect(approvals.match(/scenePublicationAuthority\.current\.owns\(activityRevision\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('synchronizes cold-launch history authority and gates persisted restore publication', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const persistedStartup = source('src/gateway/useGatewayPersistedStartup.ts');

    expect(workspace).toContain('new HistoryPublicationAuthority(appActive.current)');
    expect(workspace).toContain("appActive.current = mountAction === 'resume';");
    expect(workspace).toContain('suspendedByBackground.current = !appActive.current;');
    expect(workspace).toContain('if (appActive.current) resumeHistoryPublication(); else suspendHistoryPublication();');
    expect(workspace).toContain('useGatewayPersistedStartup({ enabled: restorePersisted, canPublish: canPublishScene');
    expect(persistedStartup).toContain('!pending.current || !canPublish()');
    expect(persistedStartup).toContain('parsedPersistedWorkspaceSelection(restoredSelection)');
    expect(persistedStartup).toContain('selectedProjectIDRef.current = selection.projectID');
    expect(source('src/gateway/useGatewaySessionRefresh.ts')).toContain('persistWorkspaceSelection(key, selectedProjectIDRef.current)');
    expect(workspace).toContain('serializedPersistedWorkspaceSelection(sessionKey, projectID)');
  });

  it('does not retire the saved Gateway during reactive lifecycle-listener replacement', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const unmountOwner = source('src/gateway/useGatewayWorkspaceUnmount.ts');
    const lifecycle = workspace.slice(
      workspace.indexOf("  useEffect(() => {\n    const mountAction"),
      workspace.indexOf('  const pair = useCallback'),
    );
    const reactiveCleanup = lifecycle.slice(
      lifecycle.indexOf('    return () => {'),
      lifecycle.indexOf('  }, ['),
    );
    expect(reactiveCleanup).toContain('appStateSubscription.remove()');
    expect(reactiveCleanup).not.toContain('reconnectEnabled.current = false');
    expect(reactiveCleanup).not.toContain('client.disconnect()');

    expect(workspace).toContain('useGatewayWorkspaceUnmount({ client, scenePublicationAuthority');
    expect(unmountOwner).toContain('useEffect(() => () => {');
    expect(unmountOwner).toContain('reconnectEnabled.current = false');
    expect(unmountOwner).toContain('client.disconnect()');
  });

  it('keeps unstable Gateway reconnects on the escalating ladder until a connection holds', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');

    expect(workspace).toContain('new GatewayReconnectLadder()');
    expect(workspace).toContain('reconnectLadder.current.delayMs()');
    expect(workspace).toContain('reconnectLadder.current.attempted()');
    expect(workspace).toContain("if (next === 'connected') { reconnectLadder.current.connected();");
    expect(workspace).toContain('reconnectLadder.current.dropped(); scheduleReconnect();');
    expect(workspace).not.toContain('reconnectAttempt.current');
    expect(workspace).not.toContain("if (next === 'connected') { reconnectLadder.current.reset()");
  });

  it('admits quota and project-age intervals only while the scene is active', () => {
    const providerUsage = source('src/gateway/useProviderUsage.ts');
    const activeInterval = source('src/lifecycle/useActiveInterval.ts');
    const projectRail = source('src/workspace/ProjectRail.tsx');

    expect(providerUsage).toContain("useActiveInterval(() => void refresh(), REFRESH_INTERVAL_MS, status === 'connected' && Boolean(authority), true, authority)");
    expect(providerUsage).not.toContain('setInterval(');
    expect(providerUsage).toContain('scenePublicationAuthority.current.owns(activityRevision)');
    expect(providerUsage).toContain('requestSequence.current === sequence');
    expect(providerUsage).toContain('snapshot: current.state.snapshot');
    expect(activeInterval).toContain('queueMicrotask');
    expect(activeInterval).toContain('[activationKey, enabled, intervalMs, runOnActivation]');
    expect(projectRail).toContain("useActiveInterval(() => { if (!reflowSuppressed) setClock(Date.now()); }, 30_000, true, true)");
    expect(projectRail).not.toContain('setInterval(');
  });

  it('never lets a first-seen ordinary Gateway row bypass the coalescing cadence', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const eventPath = workspace.slice(workspace.indexOf('client.onEvent ='), workspace.indexOf('void Promise.all'));

    expect(eventPath).not.toContain('firstPendingFrame');
    expect(eventPath).toContain('liveMessagePublicationMode(projectedMessage, Boolean(terminalPhase))');
    expect(eventPath).toContain("publicationMode === 'schedule'");
  });

  it('reconciles advancing terminal session census attention before projecting the rail', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const loadSessions = source('src/gateway/useGatewaySessionRefresh.ts');

    expect(loadSessions).toContain('acceptSessionCensusAttention(attentionLedger.current, payload, selectedRef.current, recordLocalInteraction)');
    expect(loadSessions.indexOf('acceptSessionCensusAttention(')).toBeLessThan(loadSessions.indexOf('const sessionProjection = projectsFromPayload(payload)'));
  });

  it('publishes a definitive failed agent.wait result into its owning transcript', () => {
    const runMonitor = source('src/gateway/useGatewayRunMonitor.ts');
    const waitSettlement = runMonitor.slice(
      runMonitor.indexOf('const waitForRunCompletion'),
      runMonitor.indexOf('const startRunMonitor'),
    );

    expect(waitSettlement).toContain("if (settledPhase === 'failed' && ownsContinuation())");
    expect(runMonitor).toContain('const ownsContinuation = () => scenePublicationAuthority.current.owns(activityRevision)');
    expect(runMonitor).toContain('recoveryTasks.current.owns(sessionKey, owner)');
    expect(runMonitor).toContain('runRegistry.current.ownsRun(sessionKey, acceptedRunId)');
    expect(waitSettlement).toContain('reconcileFailedRunWait(');
    expect(waitSettlement.indexOf('await loadHistory(sessionKey)')).toBeLessThan(
      waitSettlement.indexOf('reconcileFailedRunWait('),
    );
  });

  it('keeps the same run monitor alive across a local agent.wait request deadline', () => {
    const runMonitor = source('src/gateway/useGatewayRunMonitor.ts');
    const polling = source('src/gateway/runWaitPolling.ts');

    expect(runMonitor).toContain('waitForAuthoritativeRun({');
    expect(runMonitor).toContain("ownsRun: () => runRegistry.current.runFor(sessionKey) === acceptedRunId");
    expect(polling).toContain('isRunWaitRequestTimeout(error)');
    expect(polling).toContain('options.isConnected()');
    expect(polling).toContain('options.ownsRun()');
  });

  it('keeps one selected pending-final owner confirming after the fast retry window', () => {
    const finalRecovery = source('src/gateway/useGatewayFinalAnswerRecovery.ts');
    const polling = source('src/gateway/finalAnswerRecoveryPolling.ts');

    expect(finalRecovery).toContain('pollForFinalAnswer({');
    expect(finalRecovery).toContain('FINAL_ANSWER_STEADY_RECOVERY_DELAY_MS');
    expect(finalRecovery).not.toContain('&& !pending.exhausted');
    expect(polling).toContain("status: 'cancelled'");
    expect(polling).toContain('options.shouldContinue()');
  });

  it('retires final-answer, approval and message-recovery continuations across a scene epoch', () => {
    const finalRecovery = source('src/gateway/useGatewayFinalAnswerRecovery.ts');
    const approval = source('src/gateway/useGatewayApprovalDecision.ts');
    const messageRecovery = source('src/gateway/useGatewayMessageRecovery.ts');

    expect(finalRecovery).toContain('const activityRevision = scenePublicationAuthority.current.capture();');
    expect(finalRecovery).toContain('const ownsTask = () => scenePublicationAuthority.current.owns(activityRevision)');
    expect(finalRecovery).toContain('recoveryTasks.current.owns(recoveryKey, owner)');
    expect(finalRecovery).toContain('&& ownsTask()');
    expect(approval).toContain('if (!scenePublicationAuthority.current.owns(activityRevision)) return false;');
    expect(messageRecovery).toContain('const ownsTask = () => scenePublicationAuthority.current.owns(activityRevision) && tasks.current.get(taskKey) === task');
    expect(messageRecovery.match(/if \(!ownsTask\(\)\) return;/g)).toHaveLength(3);
    expect(messageRecovery).toContain('selectedRef.current !== messageSessionKey');
    expect(messageRecovery).toContain("signal.addEventListener('abort', task.cancel, { once: true })");
  });

  it('routes every approval-expiry actor through exact-run uncertainty and commit-time row finalization', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const decision = source('src/gateway/useGatewayApprovalDecision.ts');
    const submission = source('src/gateway/useGatewaySubmission.ts');
    expect(workspace).toContain('runRegistry.current.markRunUncertain(sessionKey, runId)');
    expect(workspace).not.toContain("observePhase(sessionKey, 'uncertain', runId)");
    expect(decision).toContain('approvalDecisionFailureAction(message, error)');
    expect(decision).toContain('runRegistry.current.markRunUncertain(sessionKey, message.runId)');
    expect(submission).toContain('decideApproval(resolution.message, resolution.decision)');
    expect(submission).not.toContain('resolveApproval(');
    expect(submission).not.toContain('approvalOperationMessage');
    expect(workspace.indexOf('const decideApproval =')).toBeLessThan(workspace.indexOf('const submit = useGatewaySubmission('));
    expect(decision).not.toContain('message.sessionKey || selectedRef.current');
  });

  it('defers cold persisted restore publication until the scene is active again', () => {
    const workspace = source('src/gateway/useGatewayWorkspace.ts');
    const restore = source('src/gateway/useGatewayPersistedStartup.ts');
    const resume = workspace.slice(
      workspace.indexOf("} else if (action === 'resume')"),
      workspace.indexOf('} else if (appActive.current)'),
    );

    expect(restore).toContain('pending.current = restored; apply();');
    expect(restore).toContain('if (!mounted.current || applied.current || !pending.current || !canPublish()) return;');
    expect(resume).toContain('resumePersistedWorkspace();');
  });
});
