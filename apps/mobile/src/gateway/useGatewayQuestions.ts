import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { OpenClawClient, GatewayStatus } from './OpenClawClient';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { WorkspaceProject, WorkspaceMessage } from '../workspace/workspaceTypes';
import { GatewayQuestionOwner, questionMessages } from './gatewayQuestions';
import { chooseQuestionOther, focusQuestionSubmit, chooseQuestionOption, emptyQuestionDraft, questionDraftAnswers, questionKey, questionEntryDraft, type QuestionEntry, type QuestionKeyResult, type QuestionDraft } from '../questions/questionDraft';
import { questionNeedsOtherSurface, type QuestionRecord } from '../questions/questionTypes';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { questionScopeNotice } from './questionScopeNotice';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
export function useGatewayQuestions(client: OpenClawClient, status: GatewayStatus, authority: MutableRefObject<HistoryPublicationAuthority>, messages: WorkspaceMessage[], sessionKey: string, projects: WorkspaceProject[], selectedKey: string) {
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const owner = useMemo(() => new GatewayQuestionOwner(), []);
  const [revision, setRevision] = useState(0); const [notice, setNotice] = useState(''); const [scopeNotice, setScopeNotice] = useState('');
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({}); const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const [busy, setBusy] = useState<string[]>([]); const busyRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({}); const [textEditing, setTextEditing] = useState<string | null>(null); const [otherFocus, setOtherFocus] = useState<{ id: string; question: number; revision: number } | null>(null);
  const consumeOtherFocus = useCallback((record: QuestionRecord, revision: number) => setOtherFocus(current => current?.id === record.id && current.revision === revision ? null : current), []);
  const [interaction, setInteraction] = useState<string | null>(null); const interactionRef = useRef(interaction);
  const [returnRevision, setReturnRevision] = useState(0);
  const [targetRevision, setTargetRevision] = useState(0);
  const interact = useCallback((id: string | null) => { interactionRef.current = id; setInteraction(id); }, []);
  const leave = useCallback((id: string) => { if (interactionRef.current === id) interact(null); }, [interact]);
  useEffect(() => { interact(null); }, [sessionKey, interact]);
  const editing = useCallback((record: QuestionRecord, active: boolean) => setTextEditing(current => active ? record.id : current === record.id ? null : current), []);
  const publish = useCallback(() => setRevision(owner.revision), [owner]);
  const hydrate = useCallback(async () => {
    if (client.status !== 'connected' || !authority.current.isActive) return;
    if (!client.hasOperatorScope('operator.questions')) { setScopeNotice(client.questionScopeNotice || questionScopeNotice.required); return; }
    setScopeNotice('');
    const epoch = owner.epoch; const connection = client.connectionRevision; const activity = authority.current.capture(); const started = owner.revision;
    try { const payload = await client.request('question.list', {}); if (!alive.current || !authority.current.owns(activity) || client.connectionRevision !== connection || owner.epoch !== epoch) return; owner.hydrate(payload, started); owner.expire(Date.now()); publish(); setNotice(''); }
    catch (error) { if (alive.current && authority.current.owns(activity) && client.connectionRevision === connection && owner.epoch === epoch) setNotice(questionScopeNotice.loadFailed); }
  }, [authority, client, owner, publish]);
  useEffect(() => {
    if (status !== 'connected') return;
    void hydrate();
    const timer = setInterval(() => { if (authority.current.isActive) { if (owner.expire(Date.now())) publish(); setScopeNotice(client.hasOperatorScope('operator.questions') ? '' : client.questionScopeNotice || questionScopeNotice.required); } }, 1000);
    return () => clearInterval(timer);
  }, [authority, hydrate, owner, publish, status]);
  const event = useCallback((frame: { event?: unknown; payload?: unknown }) => {
    if (!owner.event(frame)) return false;
    owner.expire(Date.now()); publish(); return true;
  }, [owner, publish]);
  const clear = useCallback(() => { interactionRef.current = null; setInteraction(null); owner.clear(); setNotice(''); setScopeNotice(''); busyRef.current.clear(); setBusy([]); setOtherFocus(null); setTextEditing(null); setDrafts({}); draftsRef.current = {}; setErrors({}); publish(); }, [owner, publish]);
  const draft = useCallback((record: QuestionRecord) => draftsRef.current[record.id] ?? emptyQuestionDraft(), []);
  const update = useCallback((record: QuestionRecord, next: QuestionDraft) => {
    draftsRef.current = { ...draftsRef.current, [record.id]: next }; setDrafts(draftsRef.current);
  }, []);
  const resolve = useCallback(async (record: QuestionRecord, cancel = false) => {
    const current = owner.get(record.id, record.sessionKey);
    if (!current || current.status !== 'pending' || current.expiresAtMs <= Date.now() || questionNeedsOtherSurface(current) || busyRef.current.has(record.id) || client.status !== 'connected' || !authority.current.isActive) return;
    const answers = questionDraftAnswers(current, draft(current));
    if (!cancel && !answers) { setErrors(e => ({ ...e, [record.id]: 'Answer every question before submitting.' })); return; }
    const epoch = owner.epoch; const connection = client.connectionRevision; const activity = authority.current.capture(); busyRef.current.add(record.id); setBusy([...busyRef.current]);
    try {
      const result = await client.request('question.resolve', { id: record.id, ...(cancel ? { cancel: true } : { answers }), resolvedBy: 'Vimicate' });
      if (!alive.current || !authority.current.owns(activity) || client.connectionRevision !== connection || owner.epoch !== epoch) return;
      if (!result || typeof result !== 'object') throw new Error('Invalid question.resolve response');
      if (!owner.event({ event: 'question.resolved', payload: { ...result, id: record.id } })) throw new Error('Invalid question.resolve response');
      publish();
      await hydrate();
    } catch (error) {
      if (alive.current && authority.current.owns(activity) && client.connectionRevision === connection && owner.epoch === epoch) { setErrors(e => ({ ...e, [record.id]: `Answer not confirmed · ${error instanceof Error ? error.message : 'Gateway refused answer'}` })); await hydrate(); }
    } finally { if (owner.epoch === epoch) { busyRef.current.delete(record.id); if (alive.current) setBusy([...busyRef.current]); } }
  }, [authority, client, draft, hydrate, owner, publish]);
  const handleKey = useCallback((record: QuestionRecord, input: HardwareKeyEvent, entry?: QuestionEntry): QuestionKeyResult => {
    if (record.status !== 'pending' || record.expiresAtMs <= Date.now() || busyRef.current.has(record.id) || questionNeedsOtherSurface(record) || input.command || input.control || input.option) return false;
    const key = normalizedHardwareKey(input);
    if (entry || interactionRef.current !== record.id) { if (!entry && key !== 'enter') return false; update(record, questionEntryDraft(record, draft(record), entry ?? 'forward')); interact(record.id); return true; }
    if (key === 'escape') { interact(null); setReturnRevision(value => value + 1); setOtherFocus(null); return true; }
    if (key === 'o' && record.questions[draft(record).active]?.isOther) { update(record, chooseQuestionOther(record, draft(record))); setOtherFocus(current => ({ id: record.id, question: draft(record).active, revision: (current?.revision ?? 0) + 1 })); return true; }
    const next = questionKey(record, draft(record), key, input.shift); if (!next) { interact(null); return false; }
    if (next.action === 'before' || next.action === 'after') { interact(null); setOtherFocus(null); return next.action; }
    update(record, next.draft);
    setTargetRevision(value => value + 1);
    if (next.action === 'other') setOtherFocus(current => ({ id: record.id, question: next.draft.active, revision: (current?.revision ?? 0) + 1 }));
    else if (next.action === 'submit' || next.action === 'dismiss') { if (next.action === 'dismiss') interact(null); void resolve(record, next.action === 'dismiss'); }
    return true;
  }, [draft, interact, resolve, update]);
  useEffect(() => { const ids = owner.ids(); setDrafts(current => Object.keys(current).every(id => ids.has(id)) ? current : Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)))); setErrors(current => Object.keys(current).every(id => ids.has(id)) ? current : Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)))); }, [owner, revision]);
  const rows = useMemo(() => questionMessages(messages, owner.forSession(sessionKey)), [messages, owner, revision, sessionKey]);
  const projectedProjects = useMemo(() => { const pending = owner.pendingSessions(); return pending.size ? projects.map(project => pending.has(project.sessionKey) ? { ...project, unread: project.sessionKey !== selectedKey || Boolean(project.unread), runPhase: 'waiting' as const } : project) : projects; }, [owner, projects, revision, selectedKey]);
  return { messages: rows, projects: projectedProjects, pendingSessions: owner.pendingSessions(), notice: status === 'connected' ? scopeNotice || notice : '', event, hydrate, clear, ui: {
    drafts, busy, errors, draft, resolve, handleKey, consumeOtherFocus, textEditing, editing, otherFocus, interaction, interact, leave, returnRevision, targetRevision,
    choose: (record: QuestionRecord, question: number, option: number) => { interact(record.id); update(record, focusQuestionSubmit(record, chooseQuestionOption(record, draft(record), option, question))); },
    other: (record: QuestionRecord, question: number) => { interact(record.id); update(record, chooseQuestionOther(record, draft(record), question)); },
    activate: (record: QuestionRecord, question: number, cursor = 0) => update(record, { ...draft(record), active: question, cursor }),
    text: (record: QuestionRecord, question: number, text: string) => { const q = record.questions[question]; if (q) update(record, { ...chooseQuestionOther(record, draft(record), question), text: { ...draft(record).text, [q.questionId]: text } }); },
  } };
}
