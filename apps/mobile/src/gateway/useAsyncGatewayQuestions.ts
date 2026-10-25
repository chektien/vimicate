import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as Crypto from 'expo-crypto';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { authoritativeHistoryChronology } from '../workspace/historyMessageProjection';
import type { GatewayStatus } from './OpenClawClient';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { useGatewaySubmission } from './useGatewaySubmission';
import { AsyncQuestionOwner, type AsyncAnswerDelivery } from '../questions/asyncQuestionOwner';
import { chooseQuestionOther, focusQuestionSubmit, questionKey, questionEntryDraft, type QuestionEntry, type QuestionKeyResult } from '../questions/questionDraft';
import type { QuestionRecord } from '../questions/questionTypes';
import { questionNeedsOtherSurface } from '../questions/questionTypes';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';
import { loadValue, saveValue } from '../storage/workspaceStore';
export function useAsyncGatewayQuestions({ messages, latestMessages: tail, endpoint, status, authority, submit }: { messages: WorkspaceMessage[]; latestMessages?: WorkspaceMessage[] | null; endpoint: string; status: GatewayStatus; authority: MutableRefObject<HistoryPublicationAuthority>; submit: MutableRefObject<ReturnType<typeof useGatewaySubmission>> }) {
  const owner = useMemo(() => new AsyncQuestionOwner(), [endpoint]); const ownerRef = useRef(owner); ownerRef.current = owner;
  const scope = endpoint ? `async-questions:v1:${endpoint}` : ''; const scopeRef = useRef(scope); scopeRef.current = scope;
  const [revision, setRevision] = useState(0); const [loaded, setLoaded] = useState<AsyncQuestionOwner | null>(null);
  const alive = useRef(true); const active = useRef(new Set<AsyncAnswerDelivery>()); const [errors, setErrors] = useState<Record<string, string>>({});
  const [textEditing, setTextEditing] = useState<string | null>(null); const [otherFocus, setOtherFocus] = useState<{ id: string; question: number; revision: number } | null>(null);
  const consumeOtherFocus = useCallback((record: QuestionRecord, revision: number) => setOtherFocus(current => current?.id === record.id && current.revision === revision ? null : current), []);
  const [interaction, setInteraction] = useState<string | null>(null); const interactionRef = useRef(interaction);
  const [returnRevision, setReturnRevision] = useState(0);
  const [targetRevision, setTargetRevision] = useState(0);
  const interact = useCallback((id: string | null) => { interactionRef.current = id; setInteraction(id); }, []);
  const leave = useCallback((id: string) => { if (interactionRef.current === id) interact(null); }, [interact]);
  useEffect(() => { interact(null); }, [owner, interact]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current.clear(); }; }, []);
  const publish = useCallback(() => { if (alive.current && ownerRef.current === owner && authority.current.isActive) setRevision(value => value + 1); }, [authority, owner]);
  const combined = useMemo(() => tail && tail !== messages ? authoritativeHistoryChronology(coalesceTranscriptIdentities([...messages, ...tail])) : messages, [messages, tail]);
  const latestMessages = useRef(combined); latestMessages.current = combined;
  useEffect(() => { const before = owner.revision; owner.observe(combined); if (before !== owner.revision) publish(); }, [combined, owner, publish]);
  useEffect(() => {
    if (loaded === owner) return;
    let cancelled = false; const epoch = owner.epoch; setTextEditing(null); setOtherFocus(null);
    if (!scope) { setLoaded(owner); return; }
    void loadValue(scope).then(payload => { if (cancelled || !alive.current || owner.epoch !== epoch) return; owner.restore(payload); owner.observe(latestMessages.current); setLoaded(owner); publish(); }).catch(() => { if (!cancelled && alive.current) { setErrors(current => ({ ...current, storage: 'Question drafts could not be loaded. Reconnect to retry.' })); } });
    return () => { cancelled = true; };
  }, [owner, scope, status, loaded]);
  const factRevision = owner.revision;
  useEffect(() => { if (!scope || loaded !== owner) return; void saveValue(scope, owner.serialize()).catch(() => { if (alive.current && ownerRef.current === owner) setErrors(current => ({ ...current, storage: 'Question draft is not saved. Keep this conversation open.' })); }); }, [owner, scope, loaded, revision, factRevision]);
  const dispatch = useCallback(async (id: string, delivery: AsyncAnswerDelivery) => {
    // Discard/re-answer may replace this fact while admission storage is pending.
    if (active.current.has(delivery) || !owner.ownsDelivery(id, delivery) || ownerRef.current !== owner || !authority.current.isActive || status !== 'connected' || loaded !== owner) return;
    active.current.add(delivery); const epoch = owner.epoch;
    const owns = () => alive.current && ownerRef.current === owner && owner.epoch === epoch && owner.ownsDelivery(id, delivery);
    try {
      // Admit the exact existing outbox fact durably before any network frame.
      await saveValue(scope, owner.serialize()); if (!owns() || !authority.current.isActive) return;
      const accepted = await submit.current(delivery.text, [], delivery.sessionKey, [], { idempotencyKey: delivery.id, ...(delivery.sourceMessageId ? { replyToId: delivery.sourceMessageId } : {}), onState: state => { if (owns()) { owner.delivery(id, state); publish(); } } });
      if (owns() && !accepted && delivery.state === 'queued') { owner.delivery(id, 'failed'); publish(); }
    } catch { if (owns()) { owner.delivery(id, 'failed'); setErrors(current => ({ ...current, [id]: 'Answer not sent. Retry this existing answer.' })); publish(); } }
    finally { active.current.delete(delivery); }
  }, [authority, loaded, owner, publish, scope, status, submit]);
  useEffect(() => { if (status !== 'connected' || loaded !== owner || !authority.current.isActive) return; for (const [id, delivery] of owner.queued()) void dispatch(id, delivery); }, [authority, dispatch, loaded, owner, revision, status]);
  const resolve = useCallback((record: QuestionRecord, collapse = false) => {
    if (collapse) { owner.collapse(record.id); setTextEditing(null); publish(); return; }
    const message = owner.message(record.id); if (!message || loaded !== owner) return;
    const delivery = owner.admit(message, Crypto.randomUUID());
    if (!delivery) { if (!questionNeedsOtherSurface(record)) setErrors(current => ({ ...current, [record.id]: 'Answer every question before submitting.' })); return; }
    setErrors(current => { const next = { ...current }; delete next[record.id]; return next; }); setTextEditing(null); publish(); void dispatch(record.id, delivery);
  }, [dispatch, loaded, owner, publish]);
  const handleKey = useCallback((message: WorkspaceMessage, input: HardwareKeyEvent, entry?: QuestionEntry): QuestionKeyResult => {
    const view = owner.view(message); const pressed = normalizedHardwareKey(input);
    if (view && !entry && pressed === 'enter' && !input.command && !input.control && !input.option && (view.state === 'history' || view.state === 'skipped' || view.state === 'pending' && view.collapsed)) { if (view.state === 'pending') owner.expand(view.record.id); else owner.reopen(view.record.id); owner.update(view.record, questionEntryDraft(view.record, owner.draft(view.record), 'forward', true)); interact(view.record.id); publish(); return true; }
    if (loaded !== owner || !view || view.state !== 'pending' || view.collapsed || questionNeedsOtherSurface(view.record) || input.command || input.control || input.option) return false;
    const record = view.record; const draft = owner.draft(record); const key = normalizedHardwareKey(input);
    if (entry || interactionRef.current !== record.id) { if (!entry && key !== 'enter') return false; owner.update(record, questionEntryDraft(record, draft, entry ?? 'forward', true)); interact(record.id); publish(); return true; }
    if (key === 'escape') { interact(null); setReturnRevision(value => value + 1); setOtherFocus(null); return true; }
    if (key === 'o' && record.questions[draft.active]?.isOther) { owner.update(record, chooseQuestionOther(record, draft)); publish(); setOtherFocus(current => ({ id: record.id, question: draft.active, revision: (current?.revision ?? 0) + 1 })); return true; }
    const next = questionKey(record, draft, key, input.shift, true); if (!next) { interact(null); return false; }
    if (next.action === 'before' || next.action === 'after') { interact(null); setOtherFocus(null); return next.action; }
    owner.update(record, next.draft);
    setTargetRevision(value => value + 1);
    if (next.action === 'other') setOtherFocus(current => ({ id: record.id, question: next.draft.active, revision: (current?.revision ?? 0) + 1 }));
    else if (next.action === 'skip') { interact(null); owner.skip(record.id); }
    else if (next.action === 'submit' || next.action === 'dismiss') { if (next.action === 'dismiss') interact(null); resolve(record, next.action === 'dismiss'); }
    publish(); return true;
  }, [interact, loaded, owner, publish, resolve]);
  const action = useCallback((id: string, kind: 'expand' | 'collapse' | 'skip' | 'reopen' | 'discard' | 'retry') => {
    if (kind === 'retry') { const delivery = owner.retry(id); if (delivery) void dispatch(id, delivery); }
    else owner[kind](id); publish();
  }, [dispatch, owner, publish]);
  const editing = useCallback((record: QuestionRecord, active: boolean) => setTextEditing(current => active ? record.id : current === record.id ? null : current), []);
  const clear = useCallback(() => { interactionRef.current = null; setInteraction(null); const current = ownerRef.current; current.clear(); if (scopeRef.current) void saveValue(scopeRef.current, '[]').catch(() => {}); setTextEditing(null); setOtherFocus(null); setRevision(value => value + 1); }, []);
  return { view: (message: WorkspaceMessage) => owner.view(message), handleKey, clear, action, loaded: loaded === owner, storageError: errors.storage, ui: {
    drafts: {}, busy: [], errors, consumeOtherFocus, otherFocus, textEditing, interaction, interact, leave, returnRevision, targetRevision, draft: (record: QuestionRecord) => owner.draft(record), resolve,
    editing, skip: (record: QuestionRecord) => { interact(null); owner.skip(record.id); publish(); },
    choose: (record: QuestionRecord, question: number, option: number) => { interact(record.id); owner.choose(record, question, option); owner.update(record, focusQuestionSubmit(record, owner.draft(record))); publish(); },
    other: (record: QuestionRecord, question: number) => { interact(record.id); owner.update(record, chooseQuestionOther(record, owner.draft(record), question)); publish(); },
    activate: (record: QuestionRecord, question: number, cursor = 0) => { owner.update(record, { ...owner.draft(record), active: question, cursor }); publish(); },
    text: (record: QuestionRecord, question: number, text: string) => { owner.text(record, question, text); publish(); },
  } };
}
