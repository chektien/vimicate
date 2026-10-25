import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HistoryPublicationAuthority } from '../gateway/historyPublicationAuthority';
import { approvalReconciliationAction, approvalReconciliationCandidates } from '../gateway/approvalFinalization';
import { gatewayRequestFailure } from '../gateway/gatewayRequestDelivery';
import type { OpenClawClient } from '../gateway/OpenClawClient';
import { SessionRunRegistry } from '../gateway/sessionRunRegistry';
import { closeWorkspaceThread } from '../gateway/workspaceThreadActions';
import { useGatewayApprovalDecision } from '../gateway/useGatewayApprovalDecision';
import { useGatewaySubmission } from '../gateway/useGatewaySubmission';
import { useGatewayThreadRegistryMutation } from '../gateway/useGatewayThreadRegistryMutation';
import { guardedPromptSubmission } from '../prompt/guardedSubmission';
import { SessionPromptAttachmentDrafts, normalizedPromptAttachment, type PromptAttachmentImport } from '../prompt/promptAttachments';
import { clearedForSubmission } from '../prompt/submissionDraft';
import { createPromptState, type PromptState } from '../prompt/vimPromptCore';
import { usePromptHistoryController } from '../prompt/usePromptHistoryController';
import { saveDraft, setWorkspacePersistenceActive } from '../storage/workspaceStore';
import { WorkspaceActivityLedger } from '../workspace/workspaceActivityLedger';
import { WorkspaceAttentionLedger } from '../workspace/workspaceAttention';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';

export const SIMULATOR_OWNERSHIP_FIXTURE_MODE = 'qa-ownership-v1';
export const SIMULATOR_OWNERSHIP_ROOT = 'SIMOWN-FIXTURE-ROOT';

const ROOT = 'fixture:ownership:root';
const CHILD = 'fixture:ownership:child';
const SIBLING = 'fixture:ownership:sibling';
const DRAFT_A = 'fixture:ownership:draft-a';
const DRAFT_B = 'fixture:ownership:draft-b';
const REJECTED_DRAFT = 'SIMOWN rejected alpha draft';
const BETA_DRAFT = 'SIMOWN beta draft';
const APPROVAL_SESSION = 'fixture:ownership:approval';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

const rootProject: WorkspaceProject = {
  id: 'ownership-root', sessionKey: ROOT, name: 'ownership root', path: '/fixture/ownership', branch: 'main',
  starred: true, threadCount: 2, state: 'idle', kind: 'project', rootSessionKey: ROOT,
};
const childProject: WorkspaceProject = {
  id: 'ownership-child', sessionKey: CHILD, name: 'ownership child', path: rootProject.path, branch: 'main',
  starred: false, threadCount: 0, state: 'idle', kind: 'thread', rootSessionKey: ROOT, parentSessionKey: ROOT,
};
const siblingProject: WorkspaceProject = {
  id: 'ownership-sibling', sessionKey: SIBLING, name: 'ownership sibling', path: rootProject.path, branch: 'main',
  starred: false, threadCount: 0, state: 'idle', kind: 'thread', rootSessionKey: ROOT, parentSessionKey: ROOT,
};

function threadEntry(project: WorkspaceProject, state: 'active' | 'removed' = 'active') {
  return {
    threadID: project.id, parentProjectID: rootProject.id, label: project.name,
    order: project.sessionKey === CHILD ? 0 : 1, state,
    ...(state === 'removed' ? { removedAtSeconds: 1_789_815_600 } : {}),
    currentBinding: { backend: 'openclaw', stableSessionKey: project.sessionKey, parentSessionKey: ROOT, state: 'current' },
    bindings: [],
  };
}

const projectsMarkdown = [
  '## ownership root', '- id: ownership-root', '- group: home', '- repo: /fixture/ownership',
  '- backend: openclaw', `- session: ${ROOT}`,
].join('\n');

function registryPayload(childState: 'active' | 'removed') {
  const json = `${JSON.stringify({ threads: [threadEntry(childProject, childState), threadEntry(siblingProject)] }, null, 2)}\n`;
  return {
    schemaVersion: 2, contract: 'host-current-v1', outcome: 'updated',
    projects: { markdown: projectsMarkdown },
    threads: { json, exists: true, byteCount: new TextEncoder().encode(json).length },
  };
}

function approvalRow(id: string, runId: string, text: string): WorkspaceMessage {
  return {
    id: `row-${id}`, role: 'approval', text, source: 'live', state: 'streaming',
    sessionKey: APPROVAL_SESSION, runId,
    approval: { id, kind: 'exec', allowedDecisions: ['allow-once', 'deny'], resolved: false },
  };
}

/** QA-only mounted probe. It uses production owners with in-memory external I/O. */
export function SimulatorOwnershipFixtureApp() {
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    let mounted = true;
    let initializationStarted = false;
    const applyPersistenceActivity = (state: string) => {
      const active = state === 'active';
      setWorkspacePersistenceActive(active);
      if (!active || initializationStarted) return;
      initializationStarted = true;
      void Promise.all([saveDraft(DRAFT_A, REJECTED_DRAFT), saveDraft(DRAFT_B, BETA_DRAFT)])
        .then(() => { if (mounted) setStorageReady(true); })
        .catch((error: unknown) => {
          if (mounted) setStorageError(error instanceof Error ? error.message : 'unknown local draft error');
        });
    };
    applyPersistenceActivity(AppState.currentState);
    const subscription = AppState.addEventListener('change', applyPersistenceActivity);
    return () => {
      mounted = false;
      subscription.remove();
      setWorkspacePersistenceActive(false);
    };
  }, []);
  if (storageError) return (
    <SafeAreaView style={styles.safe}>
      <Text accessibilityRole="alert" accessibilityLabel={`${SIMULATOR_OWNERSHIP_ROOT} initialization failed: ${storageError}`} style={styles.title}>
        {SIMULATOR_OWNERSHIP_ROOT} initialization failed
      </Text>
    </SafeAreaView>
  );
  return storageReady ? <OwnershipProbe /> : (
    <SafeAreaView style={styles.safe}><Text accessibilityLabel={`${SIMULATOR_OWNERSHIP_ROOT} preparing local drafts`} style={styles.title}>{SIMULATOR_OWNERSHIP_ROOT}</Text></SafeAreaView>
  );
}

function OwnershipProbe() {
  const [detail, setDetail] = useState('ready');

  // Attachment import ownership. The Expo picker is deliberately not called;
  // this is the exact ticket owner used by usePromptAttachmentController.
  const attachmentOwner = useRef(new SessionPromptAttachmentDrafts());
  const attachmentTicket = useRef<PromptAttachmentImport | undefined>(undefined);
  const [attachmentSession, setAttachmentSession] = useState(DRAFT_A);
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const [duplicateAdmitted, setDuplicateAdmitted] = useState<boolean | null>(null);
  const attachmentState = () => {
    const owner = attachmentOwner.current;
    return `owner attachment state: selected ${attachmentSession === DRAFT_A ? 'A' : 'B'}; A importing ${owner.isImporting(DRAFT_A) ? 'yes' : 'no'}; B importing ${owner.isImporting(DRAFT_B) ? 'yes' : 'no'}; duplicate admitted ${duplicateAdmitted === null ? 'untested' : duplicateAdmitted ? 'yes' : 'no'}; A attachments ${owner.restore(DRAFT_A).length}; send A ${owner.isImporting(DRAFT_A) ? 'disabled' : 'enabled'}`;
  };
  const beginAttachmentImport = () => {
    attachmentTicket.current = attachmentOwner.current.beginImport(DRAFT_A);
    setDuplicateAdmitted(Boolean(attachmentOwner.current.beginImport(DRAFT_A)));
    setAttachmentRevision(value => value + 1);
  };
  const completeAttachmentImport = () => {
    const ticket = attachmentTicket.current;
    if (!ticket || !attachmentOwner.current.ownsImport(ticket)) return;
    attachmentOwner.current.append(DRAFT_A, [normalizedPromptAttachment({
      id: 'ownership-attachment', uri: 'file:///simulator/ownership.txt', filename: 'ownership.txt', mimeType: 'text/plain', byteCount: 18,
    })]);
    attachmentOwner.current.finishImport(ticket);
    setAttachmentRevision(value => value + 1);
  };
  void attachmentRevision;

  // Real prompt-history hook plus real submission hook. The fake transport can
  // reject before Gateway admission while selection changes to another draft.
  const [draftSession, setDraftSession] = useState(DRAFT_A);
  const [prompt, setPrompt] = useState<PromptState>(() => createPromptState());
  const promptRef = useRef(prompt); promptRef.current = prompt;
  const promptHistory = usePromptHistoryController(draftSession, prompt, promptRef, setPrompt);
  const selectedDraftRef = useRef(draftSession); selectedDraftRef.current = draftSession;
  const draftRowsRef = useRef<WorkspaceMessage[]>([]);
  const sendDeferred = useRef<Deferred<Record<string, unknown>> | undefined>(undefined);
  const [sendPhase, setSendPhase] = useState('idle');
  const draftScene = useRef(new HistoryPublicationAuthority());
  const draftRunRegistry = useRef(new SessionRunRegistry());
  const draftClient = useMemo(() => ({
    status: 'connected' as const,
    send: () => {
      const operation = deferred<Record<string, unknown>>();
      sendDeferred.current = operation;
      setSendPhase('pending-before-gateway');
      return operation.promise;
    },
  }), []);
  const updateDraftRows = useCallback((_key: string, action: React.SetStateAction<WorkspaceMessage[]>) => {
    draftRowsRef.current = typeof action === 'function' ? action(draftRowsRef.current) : action;
  }, []);
  const submit = useGatewaySubmission({
    client: draftClient as unknown as OpenClawClient, status: 'connected', commands: [], projects: [], messages: [],
    selectedRef: selectedDraftRef, registrySnapshot: { current: null }, runRegistry: draftRunRegistry, setDetail,
    updateSessionMessages: updateDraftRows, preparePromptSubmission: () => undefined, publishSelectedRun: () => undefined,
    persistRuns: () => undefined, loadHistory: async () => [], loadPendingApprovals: async () => undefined,
    decideApproval: async () => false, loadSessions: async () => undefined, acceptThreadRegistryMutation: () => undefined,
    startRunMonitor: () => undefined, reconnect: async () => undefined, repair: async () => undefined,
    recordLocalInteraction: () => undefined, scenePublicationAuthority: draftScene,
  });
  const beginRejectedSend = () => {
    const origin = draftSession;
    const sentText = promptRef.current.text;
    setPrompt(current => clearedForSubmission(current));
    void guardedPromptSubmission(() => submit(sentText, [], origin)).then(outcome => {
      if (outcome.kind !== 'accepted') promptHistory.restoreRejected(sentText);
      setSendPhase(outcome.kind);
    });
  };
  const rejectSend = () => sendDeferred.current?.reject(gatewayRequestFailure('SIMOWN transport rejected before Gateway', false));

  // Exact close action and immediate registry-mutation hook. A rejected host
  // result is never projected; an accepted tombstone removes only the child.
  const initialProjects = useMemo(() => [rootProject, childProject, siblingProject], []);
  const projectsRef = useRef(initialProjects);
  const [projects, setProjectsState] = useState(initialProjects);
  const setProjects = useCallback<React.Dispatch<React.SetStateAction<WorkspaceProject[]>>>((action) => {
    setProjectsState(current => {
      const next = typeof action === 'function' ? action(current) : action;
      projectsRef.current = next;
      return next;
    });
  }, []);
  const registrySnapshot = useRef<Record<string, unknown> | null>(registryPayload('active'));
  const selectedThreadRef = useRef(CHILD);
  const selectedProjectIDRef = useRef(childProject.id);
  const [selectedThread, setSelectedThreadState] = useState(CHILD);
  const activityLedger = useRef(new WorkspaceActivityLedger());
  const attentionLedger = useRef(new WorkspaceAttentionLedger());
  const starOverrides = useRef({});
  const threadRunRegistry = useRef(new SessionRunRegistry());
  useState(() => { attentionLedger.current.markUnread(SIBLING); return true; });
  const acceptThreadMutation = useGatewayThreadRegistryMutation({
    projectsRef, registrySnapshot, selectedRef: selectedThreadRef, selectedProjectIDRef,
    activityLedger, attentionLedger, starOverrides, runRegistry: threadRunRegistry, setProjects,
    setProjectsReady: () => undefined,
    setSelectedKey: (action) => {
      const next = typeof action === 'function' ? action(selectedThreadRef.current) : action;
      selectedThreadRef.current = next;
      setSelectedThreadState(next);
    },
    resetHistory: () => undefined, publishSelectedRun: () => undefined,
  });
  const attemptClose = async (accepted: boolean) => {
    try {
      const client = { updateThreadRegistry: async () => {
        if (!accepted) throw new Error('SIMOWN host rejected close');
        return registryPayload('removed');
      } };
      const result = await closeWorkspaceThread(client as never, projectsRef.current, CHILD, registrySnapshot.current ?? {}, false, '', 1_789_815_600);
      acceptThreadMutation(result.registryPayload, result.selectedKey);
      setDetail('close accepted');
    } catch (error) { setDetail(error instanceof Error ? error.message : 'close rejected'); }
  };
  const threadState = `owner thread state: selected ${selectedThread === ROOT ? 'root' : 'child'}; child ${projects.some(project => project.sessionKey === CHILD) ? 'present' : 'absent'}; sibling ${projects.some(project => project.sessionKey === SIBLING) ? 'present' : 'absent'}; sibling unread ${projects.find(project => project.sessionKey === SIBLING)?.unread ? 'yes' : 'no'}`;

  // Approval refresh projection and decision hook share one live row owner.
  const firstApproval = useMemo(() => approvalRow('approval-one', 'approval-run-one', 'SIMOWN approval one'), []);
  const laterApproval = useMemo(() => approvalRow('approval-two', 'approval-run-two', 'SIMOWN approval two'), []);
  const [approvalRows, setApprovalRowsState] = useState<WorkspaceMessage[]>([firstApproval]);
  const approvalRowsRef = useRef(approvalRows); approvalRowsRef.current = approvalRows;
  const updateApprovalRows = useCallback((_key: string, action: React.SetStateAction<WorkspaceMessage[]>) => {
    setApprovalRowsState(current => {
      const next = typeof action === 'function' ? action(current) : action;
      approvalRowsRef.current = next;
      return next;
    });
  }, []);
  const approvalRefresh = useRef<{ candidates: string[]; completion: Deferred<WorkspaceMessage[]> } | undefined>(undefined);
  const decisionDeferred = useRef<Deferred<void> | undefined>(undefined);
  const approvalScene = useRef(new HistoryPublicationAuthority());
  const approvalRunRegistry = useRef(new SessionRunRegistry());
  const approvalSelectedRef = useRef(APPROVAL_SESSION);
  const approvalClient = useMemo(() => ({
    status: 'connected' as const,
    resolveApproval: () => {
      const operation = deferred<void>(); decisionDeferred.current = operation; return operation.promise;
    },
  }), []);
  const loadPendingApprovals = useCallback(async () => { throw new Error('SIMOWN refresh offline'); }, []);
  const decideApproval = useGatewayApprovalDecision({
    client: approvalClient as unknown as OpenClawClient, selectedRef: approvalSelectedRef,
    runRegistry: approvalRunRegistry, updateSessionMessages: updateApprovalRows, loadPendingApprovals,
    persistRuns: () => undefined, publishSelectedRun: () => undefined, setDetail, scenePublicationAuthority: approvalScene,
  });
  const beginApprovalRefresh = () => {
    const operation = deferred<WorkspaceMessage[]>();
    approvalRefresh.current = { candidates: approvalReconciliationCandidates(approvalRowsRef.current, APPROVAL_SESSION), completion: operation };
    void operation.promise.then(pending => updateApprovalRows(APPROVAL_SESSION,
      approvalReconciliationAction(pending, APPROVAL_SESSION, approvalRefresh.current?.candidates ?? [], Date.now())));
  };
  const publishApprovalOverlap = () => updateApprovalRows(APPROVAL_SESSION, current => [...current,
    { id: 'approval-overlap-live', role: 'assistant', text: 'SIMOWN overlapping live row', source: 'live', state: 'streaming', sessionKey: APPROVAL_SESSION, runId: 'approval-run-two' },
    laterApproval,
  ]);
  const beginLaterDenial = () => { const row = approvalRowsRef.current.find(message => message.id === laterApproval.id); if (row) void decideApproval(row, 'deny'); };
  const approvalState = `owner approval state: first ${approvalRows.find(row => row.id === firstApproval.id)?.approval?.outcome ?? 'pending'}; later ${approvalRows.find(row => row.id === laterApproval.id)?.approval?.outcome ?? (approvalRows.some(row => row.id === laterApproval.id) ? 'pending' : 'absent')}; overlap live ${approvalRows.some(row => row.id === 'approval-overlap-live') ? 'present' : 'absent'}; later actions ${approvalRows.find(row => row.id === laterApproval.id)?.approval?.allowedDecisions.length ?? 0}`;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityLabel={SIMULATOR_OWNERSHIP_ROOT} style={styles.title}>{SIMULATOR_OWNERSHIP_ROOT}</Text>
        <Probe title="Attachment admission" state={attachmentState()}>
          <Action label="Begin A attachment import" onPress={beginAttachmentImport} />
          <Action label="Select attachment B" onPress={() => setAttachmentSession(DRAFT_B)} />
          <Action label="Select attachment A" onPress={() => setAttachmentSession(DRAFT_A)} />
          <Action label="Complete A attachment import" onPress={completeAttachmentImport} />
        </Probe>
        <Probe title="Rejected send draft" state={`owner draft state: selected ${draftSession === DRAFT_A ? 'A' : 'B'}; text ${prompt.text || '<empty>'}; send ${sendPhase}; optimistic rows ${draftRowsRef.current.length}`}>
          <Action label="Begin rejected A send" onPress={beginRejectedSend} />
          <Action label="Select draft B" onPress={() => setDraftSession(DRAFT_B)} />
          <Action label="Reject A send before Gateway" onPress={rejectSend} />
          <Action label="Select draft A" onPress={() => setDraftSession(DRAFT_A)} />
        </Probe>
        <Probe title="Thread mutation" state={threadState}>
          <Action label="Attempt rejected child close" onPress={() => { void attemptClose(false); }} />
          <Action label="Accept child tombstone" onPress={() => { void attemptClose(true); }} />
        </Probe>
        <Probe title="Approval ownership" state={approvalState}>
          <Action label="Begin approval refresh" onPress={beginApprovalRefresh} />
          <Action label="Publish overlapping approval rows" onPress={publishApprovalOverlap} />
          <Action label="Resolve empty approval refresh" onPress={() => approvalRefresh.current?.completion.resolve([])} />
          <Action label="Begin later approval denial" onPress={beginLaterDenial} />
          <Action label="Resolve later approval denial" onPress={() => decisionDeferred.current?.resolve()} />
        </Probe>
        <Text accessibilityLabel={`owner detail: ${detail}`} style={styles.detail}>{detail}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Probe({ title, state, children }: { title: string; state: string; children: React.ReactNode }) {
  return <View style={styles.probe}><Text style={styles.heading}>{title}</Text><Text accessibilityLabel={state} style={styles.state}>{state}</Text><View style={styles.actions}>{children}</View></View>;
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.action}><Text style={styles.actionText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#090d12' },
  content: { padding: 18, gap: 14 },
  title: { color: '#f1f5f9', fontSize: 18, fontWeight: '800' },
  probe: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 8, padding: 12, gap: 8 },
  heading: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  state: { color: '#93c5fd', fontSize: 12, lineHeight: 17 },
  actions: { gap: 7 },
  action: { borderWidth: 1, borderColor: '#475569', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#1e293b' },
  actionText: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  detail: { color: '#fbbf24', fontSize: 12 },
});
