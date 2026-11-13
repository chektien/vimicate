// Offline Release entry. Never imported by the production App entry.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import fixture from '../../src/transcript/claudeMessageDeliveryFixture.json';
import { messagesFromPayload } from '../../src/workspace/historyMessageProjection';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
import { latestHistoryWindow } from '../../src/gateway/historyWindow';
import { parsedTranscriptCache, serializedTranscriptCache } from '../../src/gateway/persistentTranscriptCache';
import { projectRegisteredGatewayEvent } from '../../src/gateway/gatewayEventProjection';
import { flushBufferedLiveMessages, LiveMessagePublicationBuffer } from '../../src/gateway/liveMessagePublication';
import { TranscriptPane } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, focusTranscriptMessage } from '../../src/transcript/transcriptVim';
import { useTranscriptDisplayOptions } from '../../src/transcript/useTranscriptDisplayOptions';

const { sessionKey, runId, answer, nativeAnswer } = fixture;
const noop = () => {};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const saved = () => messagesFromPayload(fixture);
function live(rows: WorkspaceMessage[], event: string, payload: Record<string, unknown>) {
  const projection = projectRegisteredGatewayEvent({ event, payload: { sessionKey, runId, ...payload } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }]);
  if (!projection) throw new Error('Missing event projection');
  const pending = new LiveMessagePublicationBuffer(); pending.enqueue(projection.message);
  flushBufferedLiveMessages(pending, (_key, action) => { rows = action(rows); });
  return rows;
}

function Replay() {
  const [rows, setRows] = useState<WorkspaceMessage[]>([]);
  const [phase, setPhase] = useState('mount');
  const [checks, setChecks] = useState<string[]>([]);
  const display = useTranscriptDisplayOptions(rows, sessionKey);
  const displayRef = useRef(display.messages); displayRef.current = display.messages;
  const buffer = useMemo(() => createTranscriptBuffer(display.messages), [display.messages]);
  const [navigation, setNavigation] = useState(() => createTranscriptVimState(buffer));
  useEffect(() => {
    let active = true;
    void (async () => {
      let current: WorkspaceMessage[] = [];
      const stages: Array<[string, (rows: WorkspaceMessage[]) => WorkspaceMessage[]]> = [
        ['saved history', () => latestHistoryWindow(saved(), [], sessionKey)],
        ['cache reopen', rows => parsedTranscriptCache(serializedTranscriptCache(rows))],
        ['late final', rows => live(rows, 'chat', { state: 'final', message: { content: answer, timestamp: 1700000004000 } })],
        ['completion', rows => live(rows, 'agent', { stream: 'lifecycle', ts: 1700000004100, data: { phase: 'end' } })],
        ['foreground refresh', rows => latestHistoryWindow(saved(), rows, sessionKey)],
        ['second cache reopen', rows => parsedTranscriptCache(serializedTranscriptCache(rows))],
        ['second late final', rows => live(rows, 'chat', { state: 'final', message: { content: answer, timestamp: 1700000004000 } })],
      ];
      for (const [name, step] of stages) {
        if (!active) return;
        current = step(current); setRows(current); setPhase(name);
        await pause(650);
        if (!active) return;
        const answers = displayRef.current.filter(row => row.role === 'assistant');
        const delivered = answers.filter(row => row.text === answer).length;
        const native = answers.filter(row => row.text === nativeAnswer).length;
        const footers = displayRef.current.filter(row => row.role === 'run');
        const footerAtEnd = !footers.length || displayRef.current.at(-1)?.role === 'run';
        const result = `${name} delivered=${delivered} native=${native} footer=${footerAtEnd ? 'ok' : 'wrong'} ${delivered === 1 && native === 1 && footerAtEnd ? 'PASS' : 'FAIL'}`;
        console.log(`QA_CLAUDE_DELIVERY ${result}`);
        setChecks(prior => [...prior, result]);
      }
      setPhase('DONE');
    })().catch(error => { if (active) setPhase(`FAIL ${String(error)}`); });
    return () => { active = false; };
  }, []);
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#282828' }}>
    <View style={{ padding: 12 }}>
      <Text style={{ color: '#fff', fontSize: 16 }}>Claude delivery offline Release replay</Text>
      <Text style={{ color: '#fff' }} accessibilityLabel={`QA_CLAUDE_DELIVERY ${phase}`}>{phase}</Text>
      {checks.map((check, index) => <Text key={index} style={{ color: check.endsWith('PASS') ? '#b9e2a1' : '#ffa6a6', fontSize: 11 }}>{check}</Text>)}
    </View>
    <TranscriptPane datasetKey={sessionKey} messages={display.messages} buffer={buffer} navigation={navigation}
      focused fontScale={1} onFocus={noop} onSelect={(index, line) => setNavigation(value => focusTranscriptMessage(buffer, value, index, line))}
      onNavigationProjection={(expected, projected) => setNavigation(value => value === expected ? projected : value)}
      onViewportReview={noop} canLoadOlder={false} loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop}
      onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop} />
  </SafeAreaView>;
}
registerRootComponent(() => <SafeAreaProvider><Replay /></SafeAreaProvider>);
