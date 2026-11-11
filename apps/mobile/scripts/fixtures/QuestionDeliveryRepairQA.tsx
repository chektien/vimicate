import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useAsyncGatewayQuestions } from '../../src/gateway/useAsyncGatewayQuestions';
import { useGatewayQuestions } from '../../src/gateway/useGatewayQuestions';
import { HistoryPublicationAuthority } from '../../src/gateway/historyPublicationAuthority';
import type { OpenClawClient } from '../../src/gateway/OpenClawClient';
import type { useGatewaySubmission } from '../../src/gateway/useGatewaySubmission';
import { AsyncQuestionProvider } from '../../src/questions/AsyncQuestionContext';
import { QuestionProvider } from '../../src/questions/QuestionContext';
import { TranscriptAsyncQuestion } from '../../src/questions/TranscriptAsyncQuestion';
import { TranscriptQuestion } from '../../src/questions/TranscriptQuestion';
import { ProjectRail } from '../../src/workspace/ProjectRail';
import type { WorkspaceMessage, WorkspaceProject } from '../../src/workspace/workspaceTypes';
import type { QuestionRecord } from '../../src/questions/questionTypes';
import { qaButton, qaNoop, qaStyle } from './transcriptQuestionQAControls';
export function QuestionDeliveryRepairQA({ kind }: { kind: 'async' | 'broker' }) {
  const fixture = useMemo(() => {
    const root = `qa:${kind}:${Date.now()}`; const child = root + ':child';
    const base: WorkspaceProject = { id: root, sessionKey: root, name: 'Notes QA', path: '', branch: '', starred: false, threadCount: 1, state: 'running', runPhase: 'running' };
    const projects: WorkspaceProject[] = [base, { ...base, id: child, sessionKey: child, name: 'Child QA', kind: 'thread', rootSessionKey: root, parentSessionKey: root, threadCount: 0 }];
    const messages: WorkspaceMessage[] = [root, child].map((sessionKey, i) => ({ id: `source-${i}`, sessionKey, source: 'history', role: 'assistant', runId: 'active-origin', text: 'Choose synthetic route', asyncQuestion: { itemId: `item-${i}`, questions: [{ title: 'Route', options: ['One', 'Two'] }] } }));
    const records: QuestionRecord[] = [root, child].map((sessionKey, i) => ({ id: `broker-${i}`, sessionKey, runId: 'active-origin', createdAtMs: Date.now(), expiresAtMs: Date.now() + 3600000, status: 'pending', questions: [{ questionId: 'route', question: 'Route', header: 'Route', options: [{ label: 'One' }, { label: 'Two' }] }] }));
    return { root, child, projects, messages, records };
  }, [kind]);
  const authority = useRef(new HistoryPublicationAuthority(true));
  const gate = useRef<{ fail: () => void; accept: () => void } | null>(null);
  const attempts = useRef<string[]>([]); const answer = useRef('');
  const [, publish] = useState(0); const [messages, setMessages] = useState(fixture.messages);
  const [selected, setSelected] = useState(fixture.root); const [error, setError] = useState('');
  const sender = useRef((async (text: string, _attachments: unknown, _session: unknown, _previews: unknown, delivery: { idempotencyKey: string; onState: (state: 'sending' | 'accepted') => void }) => {
    attempts.current.push(delivery.idempotencyKey); answer.current = text; delivery.onState('sending'); publish(x => x + 1);
    return new Promise<boolean>((resolve, reject) => { gate.current = { fail: () => reject(new Error('Synthetic delivery failure')), accept: () => { delivery.onState('accepted'); resolve(true); } }; });
  }) as ReturnType<typeof useGatewaySubmission>);
  const client = useMemo(() => ({ status: 'connected', connectionRevision: 1, hasOperatorScope: () => true,
    request: async (method: string, params?: Record<string, unknown>) => {
      if (method === 'question.list') return { questions: kind === 'broker' ? fixture.records.filter(r => r.status === 'pending') : [] };
      if (method === 'question.resolve') {
        const id = String(params?.id); attempts.current.push(id); publish(x => x + 1);
        return new Promise((resolve, reject) => { gate.current = { fail: () => reject(new Error('Synthetic delivery failure')), accept: () => { const record = fixture.records.find(r => r.id === id)!; record.status = 'answered'; record.answers = params?.answers as QuestionRecord['answers']; resolve({ ...record }); } }; });
      }
      throw new Error('Unexpected synthetic request');
    },
  }) as unknown as OpenClawClient, [fixture, kind]);
  const workspaceHistory = useMemo(() => ({ projects: fixture.projects, subscribe: () => qaNoop, sessionMessages: () => [] }), [fixture]);
  const async = useAsyncGatewayQuestions({ messages: kind === 'async' ? messages : [], endpoint: '', status: 'connected', authority, submit: sender, workspaceHistory });
  const broker = useGatewayQuestions(client, 'connected', authority, [], selected, fixture.projects, undefined, async.pendingCounts, async.deliveryCounts);
  const projects = broker.projects.length ? broker.projects : fixture.projects;
  const root = projects.find(p => p.sessionKey === fixture.root)!;
  const child = projects.find(p => p.sessionKey === fixture.child)!;
  const message = messages.find(m => m.sessionKey === selected) ?? fixture.messages[0]!;
  const record = broker.messages.find(m => m.question)?.question;
  const state = kind === 'async' ? async.view(message)?.state : record?.answerDelivery ?? record?.status ?? 'confirmed';
  const confirm = () => {
    if (kind === 'async') {
      const delivery = async.view(message)?.delivery;
      if (!delivery) return;
      setMessages(rows => [...rows, { id: `saved-${attempts.current.length}`, role: 'user', source: 'history', sessionKey: message.sessionKey!, asyncQuestionReplyToId: message.id, idempotencyKey: delivery.id + ':user', text: answer.current }]);
    }
  };
  const check = () => {
    try {
      if (attempts.current.length < 2 || attempts.current[0] !== attempts.current[1]) throw new Error('Retry changed delivery identity');
      if ((root.pendingQuestions?.own ?? 0) !== 0 || (child.pendingQuestions?.own ?? 0) !== 1) throw new Error('Parent/child unanswered rollup corrupt');
      if (root.pendingQuestions?.total !== 1 || root.pendingQuestions.threads !== 1) throw new Error('Child marker not retained');
      setError('QA_QUESTION_PASS retryIdentity=true parentOwn=0 childOwn=1 rootTotal=1 activeRun=running');
    } catch (e) { setError(`QA_FAIL ${String(e)}`); }
  };
  const reset = () => { fixture.records.splice(0); setMessages([]); async.clear(); broker.clear(); };
  return <View style={{ flex: 1 }}>
    <Text style={qaStyle}>QA {kind} loaded {String(async.loaded)} state {state} attempts {attempts.current.length}</Text>
    <Text style={qaStyle}>QA counts rootOwn {root.pendingQuestions?.own ?? 0} childOwn {child.pendingQuestions?.own ?? 0} total {root.pendingQuestions?.total ?? 0} failed {root.questionDelivery?.failed ?? 0} sending {root.questionDelivery?.sending ?? 0}</Text>
    <View style={{ height: 185 }}><ProjectRail projects={projects} emptyLabel="No synthetic projects" activeKey={selected} focusedKey={selected} focused={false} fontScale={1} reflowSuppressed={false} sortMode="activity" collapsedRootKeys={new Set()} onToggleSort={qaNoop} onSelect={setSelected} onToggleFold={qaNoop} onToggleStar={qaNoop} onRefresh={qaNoop} /></View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{qaButton('QA fail delivery', () => gate.current?.fail())}{qaButton('QA accept delivery', () => gate.current?.accept())}{kind === 'async' ? qaButton('QA canonical reply', confirm) : null}{qaButton('QA check questions', check)}{qaButton('QA reset owners', reset)}</View>
    <Text style={qaStyle}>{error}</Text>
    {kind === 'async' ? <AsyncQuestionProvider value={async}><TranscriptAsyncQuestion message={message} focused fontScale={1} onFocus={qaNoop} /></AsyncQuestionProvider> : record?.status === 'pending' ? <QuestionProvider value={broker.ui}><TranscriptQuestion record={record} focused fontScale={1} onFocus={qaNoop} /></QuestionProvider> : <Text style={qaStyle}>Broker answer confirmed</Text>}
  </View>;
}
