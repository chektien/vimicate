import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useGatewayHistory } from '../../src/gateway/useGatewayHistory';
import type { OpenClawClient } from '../../src/gateway/OpenClawClient';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, focusTranscriptMessage } from '../../src/transcript/transcriptVim';
import { useSessionTranscriptNavigation } from '../../src/transcript/useSessionTranscriptNavigation';
import { useSynchronousState } from '../../src/app/useSynchronousState';
import { latestHistoryWindow } from '../../src/gateway/historyWindow';
import { loadVisibleOlderHistoryBatch } from '../../src/gateway/loadVisibleOlderHistoryBatch';
import { messagesFromPayload } from '../../src/workspace/historyMessageProjection';
import type { WorkspaceMessage, WorkspaceProject } from '../../src/workspace/workspaceTypes';
import { qaButton, qaNoop, qaStyle } from './transcriptQuestionQAControls';
const key = `qa:history:${Date.now()}`;
const generation = '00000000-0000-4000-8000-000000000101';
const project: WorkspaceProject = { id: key, sessionKey: key, name: 'History QA', path: '', branch: '', starred: false, threadCount: 0, state: 'running', sessionId: generation };
const tick = () => new Promise(resolve => setTimeout(resolve, 50));
const requireQA = (condition: unknown, detail: string) => { if (!condition) throw new Error(detail); };
export function TranscriptHistoryRepairQA() {
  const [session, setSession] = useState(key); const selected = useRef(key);
  const [detail, setDetail] = useState(''); const [result, setResult] = useState('');
  const [detached, setDetached] = useState<WorkspaceMessage[] | null>(null);
  const fixture = useMemo(() => {
    const raw = Array.from({ length: 900 }, (_, index) => ({ id: `native-${index}`, role: index % 30 === 0 ? 'user' : index % 30 === 29 ? 'assistant' : 'tool', content: index % 30 === 0 ? `Prompt ${index / 30}` : index % 30 === 29 ? `Answer ${Math.floor(index / 30)}` : `tool synthetic ${index}`, timestamp: 1800000000000 + index,
      __openclaw: { runId: `turn-${Math.floor(index / 30)}`, transcriptPosition: { source: 'native-qa', rawSeq: index * 7 + 3 } } }));
    return { raw, calls: [] as number[], returnedOffsets: new Set([0]), fail: true, overlap: true };
  }, []);
  const client = useMemo(() => ({ status: 'connected', followSession: async () => {}, decorateMessages: (rows: WorkspaceMessage[]) => rows,
    readRegistry: async () => ({ threads: { json: JSON.stringify({ threads: [{ currentBinding: { stableSessionKey: key, sessionID: generation, state: 'current' } }] }) } }),
    history: async (sessionKey: string, limit: number, offset: number) => {
      fixture.calls.push(offset);
      if (sessionKey !== key) return { sessionKey, messages: [{ id: 'other', role: 'user', content: 'Other synthetic thread' }], hasMore: false, totalMessages: 1 };
      if (fixture.fail && offset >= 160) throw new Error('Synthetic older page failure');
      const end = Math.max(0, fixture.raw.length - offset);
      // The first older page shares a canonical block with the mounted tail.
      // Coordinates are intentionally sparse and never transport offsets.
      const overlap = fixture.overlap && offset === 80 ? 10 : 0;
      const messages = fixture.raw.slice(Math.max(0, end - limit), Math.min(fixture.raw.length, end + overlap));
      const nextOffset = offset + limit;
      if (nextOffset < fixture.raw.length) fixture.returnedOffsets.add(nextOffset);
      return { sessionKey, sessionId: generation, messages, offset, totalMessages: fixture.raw.length, hasMore: nextOffset < fixture.raw.length, nextOffset: nextOffset < fixture.raw.length ? nextOffset : null };
    },
  }) as unknown as OpenClawClient, [fixture]);
  const history = useGatewayHistory(client, selected, setDetail, key);
  const current = useRef(history); current.current = history;
  const displayed = detached ?? history.messages;
  const buffer = useMemo(() => createTranscriptBuffer(displayed), [displayed]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewport = useRef<TranscriptPaneHandle | null>(null);
  const position = useSessionTranscriptNavigation({ sessionKey: session, buffer, navigationRef, setNavigation, viewportRef: viewport, tailReveal: { consumeIfAdvanced: () => false } });
  useEffect(() => { history.resetHistory(project, null); void history.loadHistory(key); }, []);
  const wait = async (predicate: () => boolean, label: string) => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
    throw new Error(`Timed out ${label}`);
  };
  const ordered = () => {
    const rows = current.current.messages.filter(row => row.displayPosition?.source === 'native-qa');
    requireQA(new Set(rows.map(row => row.id)).size === rows.length, 'Duplicate canonical row');
    requireQA(rows.every((row, i) => !i || rows[i - 1]!.displayPosition!.rawSeq < row.displayPosition!.rawSeq), 'Native order not increasing');
    return rows;
  };
  const run = async () => {
    try {
      await wait(() => current.current.messages.some(row => row.id === 'native-899'), 'initial tail');
      await current.current.loadOlderHistory();
      await wait(() => current.current.historyProblem.includes('Synthetic'), 'failed partial page');
      ordered(); requireQA(current.current.messages.some(row => row.id === 'native-740'), 'Safe older page not retained');
      requireQA(current.current.canLoadOlder, 'Failure lost retry action');
      fixture.fail = false; const retryStart = fixture.calls.length;
      await current.current.retryHistory(); await tick(); ordered();
      requireQA(fixture.calls[retryStart] === 160, 'Retry did not continue exact transport offset');
      const review = current.current.messages.map(row => row.id).join('|');
      current.current.updateSessionMessages(key, rows => [...rows, { id: 'live-answer', role: 'assistant', source: 'live', sessionKey: key, runId: 'live-run', text: 'New live answer', state: 'streaming' }]);
      await tick(); requireQA(current.current.messages.map(row => row.id).join('|') === review, 'Live row replaced review');
      requireQA(current.current.latestMessages.some(row => row.id === 'live-answer'), 'Hidden live tail lost row');
      const { sessionId: _oldGeneration, ...otherProject } = project;
      selected.current = 'qa:other'; setSession('qa:other'); current.current.resetHistory({ ...otherProject, id: 'qa:other', sessionKey: 'qa:other' }, null);
      await current.current.loadHistory('qa:other'); await tick();
      selected.current = key; setSession(key); current.current.resetHistory(project, null); await tick();
      requireQA(current.current.messages.map(row => row.id).join('|') === review, 'Thread return lost review rows');
      await current.current.loadNewerHistory(); await tick(); ordered();
      requireQA(!current.current.historyProblem, `Newer review failed ${current.current.historyProblem}`);
      await current.current.restoreLatestHistory(); await tick(); ordered();
      requireQA(!current.current.historyProblem, `G failed ${current.current.historyProblem}`);
      requireQA(current.current.messages.some(row => row.id === 'native-899'), 'G lost latest canonical answer');
      requireQA(current.current.canLoadOlder, 'G lost older provenance');
      const gStart = fixture.calls.length; const receipts = new Set(fixture.returnedOffsets);
      await current.current.loadOlderHistory(); await tick(); ordered();
      requireQA(receipts.has(fixture.calls[gStart]!), 'G older cursor did not use a returned transport receipt');
      const detachedRows: WorkspaceMessage[] = [
        { id: 'long-prompt', role: 'user', source: 'history', sessionKey: key, text: 'Detached turn prompt', runId: 'long' },
        ...Array.from({ length: 510 }, (_, i): WorkspaceMessage => ({ id: `long-${i}`, role: 'tool', source: 'history', sessionKey: key, runId: 'long', text: `tool ${i}` })),
      ];
      const bounded = latestHistoryWindow(detachedRows, [], key, 30);
      requireQA(bounded.length <= 30, 'Detached turn exceeded row budget');
      requireQA(bounded.some(row => row.historyOmission?.promptMessageId === 'long-prompt'), 'Detached turn lacks real-tail omission metadata');
      let reads = 0;
      const scanClient = { decorateMessages: (rows: WorkspaceMessage[]) => rows, history: async () => {
        reads++; return { sessionKey: key, offset: 79 + reads, nextOffset: 80 + reads, hasMore: reads <= 40, totalMessages: 200,
          messages: reads <= 40 ? [] : [{ id: 'after-empty', role: 'user', content: 'After forty empty pages' }] };
      } } as unknown as OpenClawClient;
      const scanBase = { client: scanClient, sessionKey: key, path: '', visible: [] as WorkspaceMessage[], narration: [], archive: null, context: {}, owns: () => true };
      const firstScan = await loadVisibleOlderHistoryBatch({ ...scanBase, cursor: { sessionKey: key, nextOffset: 80, hasMore: true, totalMessages: 200 } });
      requireQA(reads === 32 && firstScan.older.length === 0 && firstScan.cursor?.nextOffset === 112, 'Empty-page scan lost bounded continuation');
      const secondScan = await loadVisibleOlderHistoryBatch({ ...scanBase, cursor: firstScan.cursor });
      requireQA(reads === 41 && secondScan.older.some(row => row.id === 'after-empty'), 'Empty-page retry restarted or lost eventual content');
      const projected = messagesFromPayload({ sessionKey: key, sessionId: generation, messages: fixture.raw });
      requireQA(projected.length === fixture.raw.length, 'Synthetic raw rows not projectable');
      const pass = `QA_HISTORY_PASS ordered=true overlap=true partialRetry=160 GCursor=receipt GOffset=${fixture.calls[gStart]} threadReturn=true liveTail=true omission=true raw=${projected.length} emptyScan=32+9`;
      console.log(pass); setResult(pass);
      setDetached(bounded); await tick(); viewport.current?.reveal(0, true);
    } catch (error) { console.log(`QA_HISTORY_FAIL ${String(error)}`); setResult(`QA_FAIL ${String(error)}`); }
  };
  return <View style={{ flex: 1 }}>
    <Text style={qaStyle}>QA history rows {history.messages.length} older {String(history.canLoadOlder)} newer {String(history.hasNewerHistory)}</Text>
    <Text style={qaStyle}>{detail}</Text><Text style={qaStyle}>{result}</Text>
    {qaButton('QA run history sequence', () => { void run(); })}
    <TranscriptPane ref={viewport} sessionEntry={position.entryFor(session, buffer)} onSessionRetire={position.onViewportRetire} datasetKey={session} messages={displayed} buffer={buffer} navigation={navigation} focused fontScale={1} onFocus={qaNoop} onSelect={(index, line) => setNavigation(value => focusTranscriptMessage(buffer, value, index, line))} onNavigationProjection={(expected, projected) => setNavigation(value => value === expected ? projected : value)} onViewportReview={position.onViewportReview} onApprovalDecision={qaNoop} onRecoverMessage={qaNoop} onOpenMedia={qaNoop} canLoadOlder={history.canLoadOlder} loadingOlder={history.loadingOlder} historyProblem={history.historyProblem} onLoadOlder={() => history.loadOlderHistory()} onRetryHistory={() => { void history.retryHistory(); }} hasNewerHistory={history.hasNewerHistory} onLoadNewer={() => history.loadNewerHistory()} onJumpToLatest={() => { void history.restoreLatestHistory(); }} />
  </View>;
}
