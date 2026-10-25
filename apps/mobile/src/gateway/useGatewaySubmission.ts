import { submitQueuedInterrupt } from './queuedPromptInterrupt';
import { submissionScene } from './submissionScene';
import { commandMessage, removeRunLifecycle, localPromptMessage } from './submissionMessages';
import { privateQuestionText } from '../questions/asyncQuestionContract';
import { sealLiveChatForSteer } from './steerLiveSeal';
import { requestGatewayStop } from './gatewayStopRequest';
import { activeRunSendControl } from './gatewaySendControl';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as Crypto from 'expo-crypto';
import type { GatewayPromptAttachment, PromptAttachment } from '../prompt/promptAttachments';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import { commandCatalog, commandForInput, outboundCommandText, type GatewayCommand } from './gatewayCommands';
import type { OpenClawClient, GatewayStatus } from './OpenClawClient';
import { submissionCommandInput } from './submissionCommandInput';
import { promptWithProjectContext } from './projectPromptContext';
import { isRecoverableRunInterruption } from './runLifecycle';
import { commandListText, healthcheckText, sessionStatusText, workspaceContextText } from './sessionCommandProjection';
import { sessionSubmissionDisposition, type SessionRunRegistry } from './sessionRunRegistry';
import { closeWorkspaceThread, createWorkspaceThread } from './workspaceThreadActions';
import { approvalCommandResolution } from './approvalCommand';
import type { ApprovalDecisionHandler } from './useGatewayApprovalDecision';
import { gatewayCommandIsRunSafe, gatewayCommandRunsDisconnected, shouldRefreshHistoryAfterCommand } from './gatewayCommandPolicy';
import { recoverRefusedSessionRunTruth } from './sessionRegistryLifecycle';
import { gatewayActiveRunInputNotice, gatewayRequestReachedGateway, gatewayRequestWasRefused } from './gatewayRequestDelivery';
import { appendConversationBoundary } from './conversationBoundaries';
import { sessionStatusProblem } from './sessionStatusTruth';
import { beginCommandOperation, settleCommandOperation } from './commandOperation';
import { resolveModelChoice } from './modelMatching';
import { modelCatalogEntriesFromPayload, modelCatalogText } from './modelCommandProjection';
import { sessionOwnsDetailPublication } from './sessionPublicationOwnership';
import { bindOptimisticPromptToRun } from './submissionRunBinding';
import { latestFatalDiagnostic, recentViewportDiagnostics } from '../../modules/vimicate-diagnostics';
import { latestFatalDiagnosticText } from '../diagnostics/latestFatalDiagnostic';
import { transcriptRowDiagnosticsText } from '../diagnostics/transcriptRowDiagnostics';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { SessionMessagePublicationIntent } from './historyReviewPublication';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { transcriptInputReceiptRunId } from '../workspace/transcriptMetadata';
import { sendWithQueuedFallback, queuedPromptAcceptedNotice, type QueuedPromptTracking } from './queuedPromptSubmission';

export type GatewaySubmissionDelivery = { idempotencyKey: string; replyToId?: string; onState?: (state: 'sending' | 'accepted' | 'failed' | 'unconfirmed') => void };

type Options = {
  client: OpenClawClient;
  status: GatewayStatus;
  commands: GatewayCommand[];
  projects: WorkspaceProject[];
  messages: WorkspaceMessage[];
  selectedRef: MutableRefObject<string>;
  registrySnapshot: MutableRefObject<Record<string, unknown> | null>;
  runRegistry: MutableRefObject<SessionRunRegistry>;
  setDetail: Dispatch<SetStateAction<string>>;
  updateSessionMessages: (sessionKey: string, action: SetStateAction<WorkspaceMessage[]>, intent?: SessionMessagePublicationIntent) => void;
  preparePromptSubmission: (sessionKey: string) => void;
  publishSelectedRun: (sessionKey?: string) => void;
  persistRuns: () => void;
  loadHistory: (sessionKey: string) => Promise<unknown>;
  loadPendingApprovals: (sessionKey?: string) => Promise<void>;
  decideApproval: ApprovalDecisionHandler;
  loadSessions: (refreshRegistry?: boolean, preferredKey?: string, requireRegistry?: boolean) => Promise<void>;
  acceptThreadRegistryMutation: (payload: Record<string, unknown>, preferredKey: string) => void;
  startRunMonitor: (runId: string, sessionKey: string) => void;
  reconnect: () => Promise<void>;
  repair: () => Promise<void>;
  recordLocalInteraction: (sessionKey: string) => void;
  scenePublicationAuthority: MutableRefObject<HistoryPublicationAuthority>;
  queuedPrompts?: QueuedPromptTracking;
  rejectPromptSubmission?: (sessionKey: string, optimisticID: string) => void;
};

export function useGatewaySubmission(options: Options) {
  const { client, status, commands, projects, messages, selectedRef, registrySnapshot, runRegistry, setDetail, updateSessionMessages, preparePromptSubmission, publishSelectedRun, persistRuns, loadHistory, loadPendingApprovals, decideApproval, loadSessions, acceptThreadRegistryMutation, startRunMonitor, reconnect, repair, recordLocalInteraction, scenePublicationAuthority } = options;
  return useCallback(async (body: string, attachmentInput: GatewayPromptAttachment[] | Promise<GatewayPromptAttachment[]> | (() => Promise<GatewayPromptAttachment[]>) = [], targetSessionKey = selectedRef.current, optimisticAttachments: PromptAttachment[] = [], delivery?: GatewaySubmissionDelivery) => {
    if (!scenePublicationAuthority.current.isActive) return false;
    const activityRevision = scenePublicationAuthority.current.capture();
    const ownsScene = () => scenePublicationAuthority.current.owns(activityRevision);
    const { sceneRetired, awaitOwned } = submissionScene(ownsScene);
    const { commandText, commandToken, typedCommand, interrupt, commandArguments, modelIntent, locallyHandled } = submissionCommandInput(body, Boolean(delivery));
    const sessionKey = targetSessionKey.trim();
    const setOwnedDetail = (detail: string, owner = sessionKey) => {
      if (ownsScene() && sessionOwnsDetailPublication(owner, selectedRef.current)) setDetail(detail);
    };
    const localAttachments = optimisticAttachments.length ? optimisticAttachments : Array.isArray(attachmentInput) ? attachmentInput : [];
    const hasAttachments = localAttachments.length > 0;
    if ((!body.trim() && !hasAttachments) || !sessionKey) return false;
    // Recovery and retained diagnostics work offline. Other commands require live hello-ok authority.
    if (status !== 'connected' && !gatewayCommandRunsDisconnected(typedCommand)) { setOwnedDetail('Pair and connect before sending.'); return false; }
    const activeRunAtInvocation = runRegistry.current.runFor(sessionKey);
    const ownsActiveTarget = () => ownsScene() && selectedRef.current === sessionKey && runRegistry.current.runFor(sessionKey) === activeRunAtInvocation;
    if (!delivery && body.trim() === 'interrupt') {
      try {
        const result = await awaitOwned(submitQueuedInterrupt({ scope: { sessionKey, sessionId: projects.find(value => value.sessionKey === sessionKey)?.sessionId ?? '', predecessorRunId: activeRunAtInvocation },
          tracking: options.queuedPrompts, attachments: typeof attachmentInput === 'function' ? attachmentInput() : attachmentInput, hasPreviewAttachments: hasAttachments,
          owns: ownsActiveTarget }));
        setOwnedDetail(result.detail); return result.accepted;
      } catch { setOwnedDetail('Queue control is unconfirmed. Check this conversation before trying again.'); return false; }
    }
    const resolvedCommand = commandText ? commandForInput(commandCatalog(commands), commandText) : undefined;
    const policyCommand = resolvedCommand?.name ?? typedCommand;
    const disposition = sessionSubmissionDisposition(runRegistry.current, sessionKey, gatewayCommandIsRunSafe(policyCommand), !commandText);
    if (disposition === 'blocked') { setOwnedDetail('That command cannot run while this thread is active. Send text to steer, or use :interrupt <prompt> to stop it and start a new turn.'); return false; }
    if (interrupt && (!activeRunAtInvocation || !commandArguments)) { setOwnedDetail(!activeRunAtInvocation ? ':interrupt needs an active run. Send ordinary text to start a new turn.' : 'Use :interrupt <prompt> to stop this run and send a new prompt.'); return false; }
    if (commandText && !interrupt && !locallyHandled && !modelIntent && commands.length && !commandForInput(commands, commandText)) { setOwnedDetail(`unknown command: ${typedCommand}`); return false; }
    if (selectedRef.current === sessionKey) preparePromptSubmission(sessionKey);
    const ownsNewRunLifecycle = disposition === 'new-run';
    if (ownsNewRunLifecycle) { runRegistry.current.beginSubmission(sessionKey); publishSelectedRun(); }
    const submissionID = !locallyHandled ? delivery?.idempotencyKey ?? Crypto.randomUUID() : '';
    if (submissionID) recordLocalInteraction(sessionKey);
    const optimisticID = submissionID ? `local-${submissionID}` : '';
    let promptRowStands = false;
    let preserveRun = false; let acceptedRunId = ''; let runSessionKey = sessionKey;
    let commandOperationID = '';
    try {
      // Retired preparation leaves no sent row. Ready payloads publish before
      // the Gateway await; rejected preparation restores the draft.
      const attachments = Array.isArray(attachmentInput) ? attachmentInput : await awaitOwned(typeof attachmentInput === 'function' ? attachmentInput() : attachmentInput);
      // Only materialized payloads authorize a send or preview, never a stale
      // render snapshot retained after a previous accepted send.
      if (!body.trim() && !attachments.length) return false;
      const submittedAttachments = localAttachments.filter((preview) => attachments.some((attachment) => attachment.id === preview.id));
      if (optimisticID && selectedRef.current === sessionKey) {
        // A text steer into a running Claude CLI turn seals its live text above the prompt.
        const sealRun = disposition === 'active-run-input' && projects.find(project => project.sessionKey === sessionKey)?.agentRuntime === 'claude-cli' ? activeRunAtInvocation ?? '' : '';
        updateSessionMessages(sessionKey, (current) => current.some(row => row.idempotencyKey === submissionID) ? current : sealLiveChatForSteer(current, { ...localPromptMessage(optimisticID, submissionID, sessionKey, delivery ? privateQuestionText(body) : body, submittedAttachments, activeRunAtInvocation), ...(delivery ? { asyncQuestionAnswerText: body, ...(delivery.replyToId ? { asyncQuestionReplyToId: delivery.replyToId } : {}) } : {}) }, sealRun), 'optimistic-prompt');
        promptRowStands = true;
      }
      if (typedCommand === ':stop') {
        if (!activeRunAtInvocation) throw new Error(':stop unavailable: no active run belongs to the selected thread.');
        const stopDetail = await awaitOwned(requestGatewayStop(client, runRegistry.current, sessionKey, activeRunAtInvocation));
        appendIfSelected(`:stop — ${stopDetail}`);
      } else if (typedCommand === ':new') {
        await awaitOwned(client.resetSession(sessionKey));
        updateSessionMessages(sessionKey, (current) => appendConversationBoundary(current, commandMessage(sessionKey, '──────  new conversation  ──────', 'boundary')));
        await awaitOwned(loadSessions(true));
      } else if (typedCommand === ':status') {
        commandOperationID = `command-${Crypto.randomUUID()}`;
        updateSessionMessages(sessionKey, (current) => beginCommandOperation(current, commandOperationID, sessionKey, ':status'));
        const statusPayload = await awaitOwned(client.describeSession(sessionKey));
        updateSessionMessages(sessionKey, (current) => settleCommandOperation(current, commandOperationID, sessionStatusText(statusPayload, sessionKey)));
        const problem = sessionStatusProblem(statusPayload, activeRunAtInvocation);
        if (problem && runRegistry.current.observePhase(sessionKey, problem.phase, activeRunAtInvocation)) {
          updateSessionMessages(sessionKey, (current) => [...removeRunLifecycle(current, sessionKey, activeRunAtInvocation), commandMessage(sessionKey, problem.detail, 'error')]);
          persistRuns(); publishSelectedRun(sessionKey); setOwnedDetail(problem.detail);
        }
      } else if (typedCommand === ':commands') {
        appendIfSelected(commandListText(commandCatalog(commands)));
      } else if (typedCommand === ':diagnostics') {
        if (commandArguments) throw new Error(':diagnostics takes no arguments.');
        appendIfSelected(`${latestFatalDiagnosticText(latestFatalDiagnostic(), recentViewportDiagnostics())}\n${transcriptRowDiagnosticsText(messages, sessionKey)}`);
      } else if (modelIntent?.type === 'catalog') {
        appendIfSelected(modelCatalogText(await awaitOwned(client.listModels())));
      } else if (modelIntent?.type === 'switch') {
        const selectedProject = projects.find((project) => project.sessionKey === sessionKey);
        const model = modelIntent.model
          ? resolveModelChoice(modelCatalogEntriesFromPayload(await awaitOwned(client.listModels())), modelIntent.model) : modelIntent.model;
        await awaitOwned(client.patchSessionModel(sessionKey, model, selectedProject?.sessionId));
        appendIfSelected(model === null ? modelIntent.displayText : `:model ${model} — changed this thread to ${model}.`);
        await awaitOwned(loadSessions(false, sessionKey, false));
      } else if (typedCommand === ':context') {
        const project = projects.find((candidate) => candidate.sessionKey === sessionKey);
        if (!project) throw new Error(':context could not find the selected workspace.');
        appendIfSelected(workspaceContextText(project, status, Boolean(activeRunAtInvocation), commandCatalog(commands).length));
      } else if (typedCommand === ':healthcheck') {
        appendIfSelected(healthcheckText(await awaitOwned(client.health())));
      } else if (typedCommand === ':approvals') {
        await awaitOwned(loadPendingApprovals(sessionKey)); setOwnedDetail('pending approvals refreshed');
      } else if (typedCommand === ':approve' || typedCommand === ':deny') {
        const resolution = approvalCommandResolution(typedCommand, commandArguments, messages, sessionKey);
        return await awaitOwned(decideApproval(resolution.message, resolution.decision));
      } else if (typedCommand === ':reload-projects') {
        await awaitOwned(loadSessions(true, '', true)); appendIfSelected(':reload-projects — authoritative registry refreshed');
      } else if (typedCommand === ':reconnect') {
        if (commandArguments) throw new Error(':reconnect takes no arguments.');
        await awaitOwned(reconnect()); appendIfSelected(':reconnect — connected.');
      } else if (typedCommand === ':repair') {
        if (commandArguments) throw new Error(':repair takes no arguments.');
        await awaitOwned(repair()); setDetail(':repair — RN connection cleared; native shared authority was not revoked.');
      } else if (typedCommand === ':new-thread') {
        const result = await awaitOwned(createWorkspaceThread(client, projects, sessionKey, commandArguments, registrySnapshot.current ?? {}));
        runSessionKey = result.selectedKey; acceptedRunId = result.runId ?? '';
        acceptThreadRegistryMutation(result.registryPayload, result.selectedKey);
        if (acceptedRunId) { runRegistry.current.registerRun(runSessionKey, acceptedRunId); persistRuns(); preserveRun = true; startRunMonitor(acceptedRunId, runSessionKey); }
        launchGuardedBackgroundTask(() => loadSessions(false, result.selectedKey, false), (error) => setOwnedDetail(error instanceof Error ? error.message : 'thread refresh failed', result.selectedKey)); appendIfSelected(result.message);
      } else if (typedCommand === ':close-thread') {
        const result = await awaitOwned(closeWorkspaceThread(client, projects, sessionKey, registrySnapshot.current ?? {}, Boolean(activeRunAtInvocation), commandArguments));
        runSessionKey = result.selectedKey;
        acceptThreadRegistryMutation(result.registryPayload, result.selectedKey);
        launchGuardedBackgroundTask(() => loadSessions(false, result.selectedKey, false), (error) => setOwnedDetail(error instanceof Error ? error.message : 'thread refresh failed', result.selectedKey)); appendIfSelected(result.message);
        setDetail(result.message);
      } else {
        const selectedProject = projects.find((project) => project.sessionKey === sessionKey);
        const outbound = delivery ? body : interrupt ? promptWithProjectContext(commandArguments, selectedProject) : commandText
          ? outboundCommandText(resolvedCommand, commandToken, commandArguments)
          : promptWithProjectContext(body, selectedProject);
        delivery?.onState?.('sending');
        if (interrupt) setOwnedDetail('interrupt requested; waiting for the active run to stop');
        const sendArgs = interrupt || (disposition === 'active-run-input' && !delivery) ? [activeRunSendControl(activeRunAtInvocation, interrupt)] : disposition === 'active-run-input' ? ['steer' as const] : [];
        const result = await awaitOwned(delivery
          ? client.send(sessionKey, outbound, attachments, submissionID || undefined, sendArgs[0], delivery.replyToId).then(payload => ({ payload, followupRunId: '' }))
          : sendWithQueuedFallback({ client, sessionKey, ...(selectedProject?.sessionId ? { sessionId: selectedProject.sessionId } : {}), text: body, outbound, attachments,
            submissionId: submissionID, control: typeof sendArgs[0] === 'object' ? sendArgs[0] : undefined,
            tracking: !commandText ? options.queuedPrompts : undefined,
            ownsFallback: ownsActiveTarget,
            onFollowupIdentity: runId => updateSessionMessages(sessionKey, current => current.map(row => row.id === optimisticID
              ? { ...row, idempotencyKey: runId, inputReceiptRunId: runId, runId } : row)),
          }));
        const { payload, followupRunId } = result;
        delivery?.onState?.('accepted');
        acceptedRunId = transcriptInputReceiptRunId(payload.runId) ?? transcriptInputReceiptRunId(payload.id) ?? '';
        if (interrupt) setOwnedDetail(acceptedRunId ? 'replacement prompt accepted' : 'interrupt result unconfirmed; refresh this thread');
        const queuedBehindActiveRun = disposition === 'active-run-input' && Boolean(activeRunAtInvocation);
        const transcriptRunId = followupRunId || (queuedBehindActiveRun ? activeRunAtInvocation : acceptedRunId);
        if (optimisticID && transcriptRunId) updateSessionMessages(sessionKey, (current) => bindOptimisticPromptToRun(current, optimisticID, transcriptRunId, acceptedRunId));
        if (interrupt && !runRegistry.current.ownsRun(sessionKey, activeRunAtInvocation) && !runRegistry.current.ownsRun(sessionKey, acceptedRunId)) {
          preserveRun = true; // A late acknowledgement cannot replace a newer observed turn.
        } else if (acceptedRunId && !queuedBehindActiveRun) {
          runRegistry.current.registerRun(sessionKey, acceptedRunId); persistRuns(); preserveRun = true; startRunMonitor(acceptedRunId, sessionKey);
        } else if (queuedBehindActiveRun) {
          // chat.send returns a short-lived client-operation id for default
          // steering. It must not replace the shared turn that was already
          // active; live lifecycle/history remains owned by that turn.
          preserveRun = true;
          if (selectedRef.current === sessionKey) setDetail(followupRunId ? queuedPromptAcceptedNotice : 'prompt accepted while run active');
        } else runRegistry.current.observePhase(sessionKey, 'uncertain');
        // Live subscribed rows exclusively own an active transcript. A
        // canonical refresh here can lag the stream and alternate the list
        // between two valid-but-different snapshots until completion.
        publishSelectedRun(); return true;
      }
      const mutationRefreshesInBackground = typedCommand === ':new-thread' || typedCommand === ':close-thread';
      if (!mutationRefreshesInBackground && shouldRefreshHistoryAfterCommand(runRegistry.current.isBusy(runSessionKey))) await awaitOwned(loadHistory(runSessionKey));
      return true;
    } catch (error) {
      // Scene retirement is not an answer from the Gateway: the frame is
      // already on the wire and no writer may publish here, so the standing
      // row decides the outcome.
      if (error === sceneRetired) { delivery?.onState?.('unconfirmed'); return promptRowStands; }
      if (!ownsScene() && gatewayRequestWasRefused(error)) {
        // Defer exact-row removal until resume; restore this unsent draft.
        if (optimisticID) options.rejectPromptSubmission?.(sessionKey, optimisticID);
        if (ownsNewRunLifecycle) runRegistry.current.rejectSubmission(sessionKey);
        delivery?.onState?.('failed');
        return false;
      }
      delivery?.onState?.(gatewayRequestReachedGateway(error) ? 'unconfirmed' : 'failed');
      if (commandOperationID) updateSessionMessages(sessionKey, (current) => settleCommandOperation(current, commandOperationID, error instanceof Error ? `:status — ${error.message}` : ':status — failed', true));
      if (acceptedRunId && runRegistry.current.runFor(runSessionKey) === acceptedRunId && isRecoverableRunInterruption(error)) { preserveRun = true; if (selectedRef.current === runSessionKey) setDetail('run interrupted; waiting to reconnect'); return true; }
      // Unknown delivery keeps the row. Only definite refusal restores the draft.
      const promptReachedGateway = promptRowStands && gatewayRequestReachedGateway(error);
      if (typedCommand === ':close-thread' || selectedRef.current === sessionKey || selectedRef.current === runSessionKey) {
        setDetail(promptReachedGateway ? 'prompt sent; reconnecting for its answer' : error instanceof Error ? error.message : 'send failed');
      }
      if (!acceptedRunId && !promptReachedGateway) {
        if (ownsNewRunLifecycle) runRegistry.current.rejectSubmission(sessionKey);
        if (optimisticID) { updateSessionMessages(sessionKey, (current) => current.filter((message) => message.id !== optimisticID)); promptRowStands = false; }
      }
      const refusalDetail = await recoverRefusedSessionRunTruth(error, client, runRegistry.current,
        sessionKey, activeRunAtInvocation, ownsScene, () => { persistRuns(); publishSelectedRun(sessionKey); });
      const refusalNotice = gatewayActiveRunInputNotice(error);
      if (refusalNotice && ownsScene()) { appendIfSelected(refusalNotice); setOwnedDetail(refusalNotice); }
      else if (refusalDetail) { appendIfSelected(refusalDetail, 'error'); setOwnedDetail(refusalDetail); }
      return promptRowStands;
    } finally {
      // Release submission bookkeeping even when scene publication retired.
      if (ownsNewRunLifecycle) runRegistry.current.finishSubmission(sessionKey);
      if (ownsScene()) {
        if (!preserveRun && acceptedRunId) { runRegistry.current.finishRun(runSessionKey, acceptedRunId); persistRuns(); }
        publishSelectedRun();
      }
    }

    function appendIfSelected(message: string, role: WorkspaceMessage['role'] = 'command') {
      updateSessionMessages(runSessionKey, (current) => [...current, commandMessage(runSessionKey, message, role)]);
    }
  }, [acceptThreadRegistryMutation, client, commands, decideApproval, loadHistory, loadPendingApprovals, loadSessions, messages, options.queuedPrompts, options.rejectPromptSubmission, persistRuns, preparePromptSubmission, projects, publishSelectedRun, reconnect, recordLocalInteraction, registrySnapshot, repair, runRegistry, scenePublicationAuthority, selectedRef, setDetail, startRunMonitor, status, updateSessionMessages]);
}
