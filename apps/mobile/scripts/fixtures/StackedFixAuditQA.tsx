// Explicit isolated QA entry for the stacked-fix audit. Never imported by the
// production App entry. Mounts the real useGatewayHistory (synthetic client),
// the production display projection and the real TranscriptPane. Live frames
// pass the real reducer owners in the order useGatewayWorkspace's onEvent uses.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useGatewayHistory } from '../../src/gateway/useGatewayHistory';
import type { OpenClawClient } from '../../src/gateway/OpenClawClient';
import { ChatStreamAccumulator } from '../../src/gateway/chatStreamAccumulator';
import { projectRegisteredGatewayEvent, upsertLiveMessage } from '../../src/gateway/gatewayEventProjection';
import { flushBufferedLiveMessages, LiveMessagePublicationBuffer } from '../../src/gateway/liveMessagePublication';
import { latestPresentationWindow } from '../../src/gateway/historyWindow';
import { sealLiveChatForSteer } from '../../src/gateway/steerLiveSeal';
import { localPromptMessage } from '../../src/gateway/submissionMessages';
import { settleRunToolMessages } from '../../src/gateway/runToolSettlement';
import { completedRunMessage, hasRenderedAssistantFinalForRun, reconcileCompletedRunMessage, reconcileOwnedPendingFinal } from '../../src/gateway/runCompletionMessage';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, focusTranscriptMessage } from '../../src/transcript/transcriptVim';
import { updatedTranscriptBuffer } from '../../src/transcript/transcriptBuffer';
import { useTranscriptDisplayOptions } from '../../src/transcript/useTranscriptDisplayOptions';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import type { WorkspaceMessage, WorkspaceProject } from '../../src/workspace/workspaceTypes';
import { qaButton, qaNoop, qaStyle } from './transcriptQuestionQAControls';
import { auditEpoch, auditScenarios, type AuditDriver, type AuditScenario } from './stackedFixAuditScenarios';

const sessionId = '11111111-1111-4111-8111-111111111111';
const qaSource = process.env.EXPO_PUBLIC_VIMICATE_QA_SOURCE;

/** Model readout for the README observations. XCTest asserts the pane rows, not this. */
function modelReadout(rows: WorkspaceMessage[]) {
  const tools = rows.filter(row => row.role === 'tool' && !row.toolGroup);
  const order = rows.map(row => `${row.role[0]}${row.source === 'history' ? 'S' : 'L'}${row.steerSealed ? '*' : ''}`).join(' ');
  return `QA model rows=${rows.length} seals=${rows.filter(row => row.steerSealed).length} liveChat=${rows.filter(row => row.id.startsWith('live-chat-')).length}`
    + ` toolsLive=${tools.filter(row => row.source !== 'history').length} toolsSaved=${tools.filter(row => row.source === 'history').length}`
    + ` toolIds=${tools.map(row => row.id).join(',')} order=${order}`;
}

function ScenarioHarness({ scenario }: { scenario: AuditScenario }) {
  const key = useMemo(() => `agent:main:direct:qa-stacked-${scenario.id}-${Date.now()}`, [scenario.id]);
  const project = useMemo<WorkspaceProject>(() => ({ id: key, sessionKey: key, name: `Stacked ${scenario.id}`, path: '', branch: '', starred: false, threadCount: 0, state: 'running', sessionId, agentRuntime: scenario.runtime }), [key, scenario]);
  const selected = useRef(key);
  const page = useRef<unknown[]>([]);
  const [detail, setDetail] = useState('');
  const [status, setStatus] = useState('QA step 0 of ' + scenario.steps.length + ' mounting');
  const client = useMemo(() => ({ status: 'connected', followSession: async () => {}, decorateMessages: (rows: WorkspaceMessage[]) => rows,
    readRegistry: async () => ({ threads: { json: JSON.stringify({ threads: [{ currentBinding: { stableSessionKey: key, sessionID: sessionId, state: 'current' } }] }) } }),
    history: async (sessionKey: string, limit: number, offset: number) => {
      const messages = offset === 0 ? page.current.slice(-limit) : [];
      return { sessionKey, sessionId, messages, offset, totalMessages: page.current.length, hasMore: false, nextOffset: null };
    },
  }) as unknown as OpenClawClient, [key]);
  const history = useGatewayHistory(client, selected, setDetail, key);
  const current = useRef(history); current.current = history;
  // AppShell's display path: production display projection, then the incremental buffer.
  const display = useTranscriptDisplayOptions(history.messages, key);
  const bufferCache = useRef({ messages: [] as readonly WorkspaceMessage[], buffer: createTranscriptBuffer([]) });
  const buffer = useMemo(() => {
    const next = updatedTranscriptBuffer(bufferCache.current.messages, bufferCache.current.buffer, display.messages);
    bufferCache.current = { messages: display.messages, buffer: next };
    return next;
  }, [display.messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewport = useRef<TranscriptPaneHandle | null>(null);
  const position = useSessionTranscriptNavigation({ sessionKey: key, buffer, navigationRef, setNavigation, viewportRef: viewport, tailReveal: { consumeIfAdvanced: () => false } });

  const driver = useMemo<AuditDriver>(() => {
    const streams = new ChatStreamAccumulator();
    const pending = new LiveMessagePublicationBuffer();
    const projects = [{ sessionKey: key, path: '', agentRuntime: scenario.runtime }];
    const runId = scenario.runId;
    // useGatewayWorkspace onEvent: normalize, project, decorate, enqueue.
    const receive = (event: string, payload: Record<string, unknown>) => {
      const frame = streams.normalize({ event, payload: { sessionKey: key, runId, ...payload } });
      const projection = projectRegisteredGatewayEvent(frame, projects);
      if (!projection) return;
      pending.enqueue(client.decorateMessages([projection.message], projection.sessionKey)[0] ?? projection.message);
    };
    const update = (action: (rows: WorkspaceMessage[]) => WorkspaceMessage[], intent?: 'optimistic-prompt') => current.current.updateSessionMessages(key, action, intent);
    return {
      chat: (text, state = 'delta') => receive('chat', { state, message: { content: text } }),
      typedChat: (text, state = 'delta') => receive('chat', { state, message: { role: 'assistant', content: [{ type: 'text', text }] } }),
      tool: (id, ts, phase = 'start') => receive('agent', { stream: 'tool', ts: auditEpoch + ts, data: { phase, name: 'exec', toolCallId: id, ...(phase === 'result' ? { result: {} } : {}) } }),
      preamble: (text, itemId) => receive('agent', { stream: 'item', data: { kind: 'preamble', phase: 'end', itemId, progressText: text } }),
      lifecycleEnd: (terminalReply) => receive('agent', { stream: 'lifecycle', data: { phase: 'end', ...(terminalReply ? { terminalReply: { disposition: 'visible', text: terminalReply } } : {}) } }),
      publish: () => flushBufferedLiveMessages(pending, (sessionKey, action) => current.current.updateSessionMessages(sessionKey, action)),
      // The workspace terminal publication for an owned run whose final rendered.
      terminal: () => {
        const owned = pending.drainSession(key);
        update(rows => {
          let next = owned.reduce(upsertLiveMessage, rows);
          next = settleRunToolMessages(next, key, runId, 'completed');
          next = !hasRenderedAssistantFinalForRun(next, runId) ? reconcileOwnedPendingFinal(next, key, runId, true)
            : reconcileCompletedRunMessage(next, completedRunMessage(key, runId, 60_000));
          return latestPresentationWindow(next);
        });
      },
      prompt: (text, idempotencyKey, timestamp, promptRunId, id = 'local-first') => update(rows => [...rows,
        { ...localPromptMessage(id, idempotencyKey, key, text, [], promptRunId), timestamp: String(timestamp) }], 'optimistic-prompt'),
      // useGatewaySubmission's optimistic steer into an active run.
      steer: (text, idempotencyKey, timestamp) => {
        current.current.preparePromptSubmission(key);
        const sealRun = scenario.runtime === 'claude-cli' ? runId : '';
        update(rows => rows.some(row => row.idempotencyKey === idempotencyKey) ? rows : sealLiveChatForSteer(rows,
          { ...localPromptMessage(`local-${idempotencyKey}`, idempotencyKey, key, text, [], runId), timestamp: String(timestamp) }, sealRun), 'optimistic-prompt');
      },
      // The workspace refresh batch: loadHistory(key, 'preserve-review', required).
      refresh: async (messages) => { page.current = messages; await current.current.loadHistory(key, 'preserve-review', true); },
    };
  }, [client, key, scenario]);

  const next = useRef(0); const busy = useRef(false);
  useEffect(() => {
    history.resetHistory(project, null);
    void history.loadHistory(key).then(() => setStatus(`QA step 0 of ${scenario.steps.length} ready mounted`));
  }, []);
  const advance = async () => {
    if (busy.current || next.current >= scenario.steps.length) return;
    busy.current = true;
    const step = scenario.steps[next.current]!;
    try {
      await step.run(driver);
      next.current += 1;
      // Let React commit the published rows before announcing readiness.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      setStatus(`QA step ${next.current} of ${scenario.steps.length} ready ${step.name}`);
    } catch (error) { setStatus(`QA error at ${step.name}: ${String(error)}`); }
    busy.current = false;
  };
  const readout = modelReadout(history.messages);
  return <View style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
      {qaButton('QA next step', () => { void advance(); })}
      <Text style={qaStyle} accessibilityLabel={status}>{status}</Text>
    </View>
    <Text style={[qaStyle, { fontSize: 9 }]} accessibilityLabel={readout} numberOfLines={3}>{readout}</Text>
    {detail ? <Text style={[qaStyle, { fontSize: 9 }]}>{detail}</Text> : null}
    <TranscriptPane ref={viewport} sessionEntry={position.entryFor(key, buffer)} onSessionRetire={position.onViewportRetire} datasetKey={key} messages={display.messages} buffer={buffer} navigation={navigation} focused fontScale={1} onFocus={qaNoop} onSelect={(index, line) => setNavigation(value => focusTranscriptMessage(buffer, value, index, line))} onNavigationProjection={(expected, projected) => setNavigation(value => value === expected ? projected : value)} onViewportReview={position.onViewportReview} onApprovalDecision={qaNoop} onRecoverMessage={qaNoop} onOpenMedia={qaNoop} canLoadOlder={history.canLoadOlder} loadingOlder={history.loadingOlder} historyProblem={history.historyProblem} onLoadOlder={() => history.loadOlderHistory()} onRetryHistory={() => { void history.retryHistory(); }} hasNewerHistory={history.hasNewerHistory} onLoadNewer={() => history.loadNewerHistory()} onJumpToLatest={() => { void history.restoreLatestHistory(); }} />
  </View>;
}

function StackedFixAuditQA() {
  const [page, setPage] = useState('home');
  const scenario = auditScenarios[page];
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#282828' }}>
    <Text style={qaStyle} accessibilityLabel={`STACKED_AUDIT_QA ${qaSource}`}>Synthetic Release QA {qaSource}</Text>
    <ScrollView horizontal style={{ flexGrow: 0 }}>{Object.keys(auditScenarios).map(value => qaButton(`QA scenario ${value}`, () => setPage(value)))}</ScrollView>
    {scenario ? <ScenarioHarness key={page} scenario={scenario} /> : <Text style={qaStyle}>No live Gateway. Synthetic transport only. Remote updates disabled.</Text>}
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(StackedFixAuditQA);
