import { SessionSubscriptionOwner } from './sessionSubscriptionOwner';
import { questionScopeNotice } from './questionScopeNotice';
import { serializedGatewayFrame } from './gatewayOutboundFrame';
import { sessionApprovalReplayFrames } from './sessionApprovalEvents';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import { buildDeviceAuth, loadOrCreateIdentity } from './deviceIdentity';
import { operatorScopesForProfile, profileHasOperatorScope } from './gatewayAuthorization';
import type { GatewayProfile } from './setupCode';
import type { GatewayPromptAttachment } from '../prompt/promptAttachments';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { decorateGatewayMedia } from './gatewayMedia';
import { gatewayArtifactDownloadSource } from './gatewayArtifactDownload';
import { assertThreadRegistryUpdate, createdGatewaySession, type ThreadRegistryWireEntry } from './threadRegistryMutation';
import { bootstrapMobileOperator } from './mobileBootstrap';
import { gatewayDeviceFamilyForProfile } from './gatewayDeviceFamily';
import { dispatchGatewayEventSafely } from './gatewayEventDispatch';
import { gatewayRequestFailure, gatewayResponseFailure } from './gatewayRequestDelivery';
import { GatewayInputRefusalEcho, gatewayInputRefusalScope } from './gatewayInputRefusalEcho';
import { gatewaySendControlFields, type GatewaySendControl } from './gatewaySendControl';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { projectFileContentFromPayload, projectFileListFromPayload, sharedFileResolutionFromPayload, sharedProjectFileContentFromPayload, sharedProjectFileListFromPayload } from './projectFiles';

type Frame = Record<string, unknown>;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; reachedGateway: boolean; refusalScope: ReturnType<typeof gatewayInputRefusalScope> };
type ConnectWaiter = { generation: number; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export type GatewayStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type AgentWaitResult = {
  runId?: string;
  status?: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  stopReason?: string;
  timeoutPhase?: string;
  providerStarted?: boolean;
};


export class OpenClawClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private refusalEchoes = new GatewayInputRefusalEcho();
  private generation = 0;
  private profile: GatewayProfile | null = null;
  private connectWaiter: ConnectWaiter | null = null;
  private sessionSubscription = new SessionSubscriptionOwner({
    subscribe: key => {
      const includeApprovals = this.hasOperatorScope('operator.approvals') || this.hasOperatorScope('operator.admin');
      return this.request('sessions.messages.subscribe', { key, ...(includeApprovals ? { includeApprovals: true } : {}) });
    },
    unsubscribe: key => this.request('sessions.messages.unsubscribe', { key }),
    accepted: (key, result) => {
      for (const frame of sessionApprovalReplayFrames(result.approvalReplay, key)) {
        dispatchGatewayEventSafely(frame, this.onEvent, error => this.reportEventFailure(error, 'approval.replay-failed'));
      }
      recordGatewayDiagnostic('session.messages-subscribed');
    },
  });
  private questionsDisabled = false;
  private questionUpgradeGeneration = 0;
  questionScopeNotice = '';
  status: GatewayStatus = 'idle';
  onStatus: (status: GatewayStatus, detail?: string) => void = () => undefined;
  onEvent: (frame: Frame) => void = () => undefined;
  onEventError: (error: unknown) => void = () => undefined;
  onIssuedDeviceToken: (token: string, scopes: string[]) => void = () => undefined;

  async connect(profile: GatewayProfile, questionsDisabled = false): Promise<void> {
    this.questionsDisabled = questionsDisabled;
    this.disconnect(); const generation = ++this.generation; this.setStatus('connecting', profile.endpoint);
    recordGatewayDiagnostic('connect.start');
    const physicalDevice = Device.isDevice !== false;
    const physicalDeviceFamily = Device.deviceType === Device.DeviceType.PHONE ? 'iphone' as const : 'ipad' as const;
    const deviceFamily = gatewayDeviceFamilyForProfile(profile, physicalDeviceFamily);
    let activeProfile = profile;
    if (profile.credentialKind === 'bootstrapToken') {
      try {
        recordGatewayDiagnostic('connect.mobile-bootstrap-start');
        const identity = await loadOrCreateIdentity(profile.authoritySource === 'sharedKeychain' && physicalDevice, physicalDevice);
        const handoff = await bootstrapMobileOperator(profile, identity, deviceFamily);
        if (generation !== this.generation) throw new Error('Gateway connection was replaced.');
        activeProfile = { ...profile, credentialKind: 'deviceToken', credential: handoff.deviceToken, scopes: handoff.scopes, authoritySource: 'sharedKeychain' };
        this.onIssuedDeviceToken(handoff.deviceToken, handoff.scopes);
        recordGatewayDiagnostic('connect.mobile-bootstrap-ok');
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('OpenClaw mobile bootstrap failed.');
        if (generation === this.generation) { recordGatewayDiagnostic(`connect.failed ${failure.message}`); this.setStatus('error', failure.message); }
        throw failure;
      }
    }
    this.profile = activeProfile;
    let socket: WebSocket;
    try { socket = new WebSocket(activeProfile.endpoint); }
    catch (error) {
      const failure = error instanceof Error ? error : new Error('Invalid Gateway WebSocket endpoint');
      this.setStatus('error', failure.message); throw failure;
    }
    this.socket = socket;
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      launchGuardedBackgroundTask(
        () => this.handleFrame(String(event.data), generation),
        (error) => this.reportEventFailure(error, 'event.handler-failed'),
      );
    };
    socket.onerror = () => { if (generation === this.generation) { recordGatewayDiagnostic('connect.failed WebSocket transport error'); this.setStatus('error', 'WebSocket transport error'); } };
    socket.onclose = () => { if (generation === this.generation && this.status !== 'idle' && this.status !== 'error') { recordGatewayDiagnostic('connect.closed'); this.setStatus('disconnected', 'socket closed'); } };
    try { await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (generation === this.generation) this.setStatus('error', 'Gateway challenge timed out');
      }, 10000);
      this.connectWaiter = { generation, resolve, reject, timer };
    }); } catch (error) {
      if (!questionsDisabled && profile.credentialKind === 'token' && /scope|pairing required/i.test(error instanceof Error ? error.message : '')) {
        this.questionScopeNotice = questionScopeNotice.required;
        return this.connect(profile, true);
      }
      throw error;
    }
  }
  disconnect() {
    this.refusalEchoes.clear();
    this.generation += 1; this.socket?.close(); this.socket = null;
    this.sessionSubscription.clear();
    this.finishConnect(new Error('Gateway disconnected'));
    this.pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(gatewayRequestFailure('Gateway disconnected', entry.reachedGateway)); }); this.pending.clear();
    this.setStatus('idle');
  }
  // Whether the frame was written is the one fact only this transport holds.
  // A request still queued here never reached the Gateway and may be reported
  // as a refusal; once it is on the wire the Gateway may have accepted and run
  // it, so a later timeout or reconnect leaves the outcome unknown instead.
  async request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
    if (!this.socket) throw gatewayRequestFailure('Gateway is not connected', false);
    const id = Crypto.randomUUID(); const frame: Frame = { type: 'req', id, method }; if (params) frame.params = params;
    let pending!: Pending;
    const result = new Promise<T>((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(gatewayRequestFailure(`${method} timed out`, pending.reachedGateway)); }, timeoutMs); pending = { resolve: (value) => resolve(value as T), reject, timer, reachedGateway: false, refusalScope: gatewayInputRefusalScope(method, params) }; this.pending.set(id, pending); });
    try { this.socket.send(serializedGatewayFrame(frame)); pending.reachedGateway = true; }
    catch (error) {
      const entry = this.pending.get(id); if (entry) { this.pending.delete(id); clearTimeout(entry.timer); entry.reject(gatewayRequestFailure(error instanceof Error ? error.message : 'Gateway send failed', false)); }
    }
    return result;
  }
  listSessions() { return this.request<Record<string, unknown>>('sessions.list', { limit: 1000 }); }
  readSessionRunTruth(sessionKey: string) { return this.request<Record<string, unknown>>('vimicate.runs.read', { sessionKey }); }
  async readRegistry() { const payload = await this.request<Record<string, unknown>>('vimicate.registry.read', {}, 20000); recordGatewayDiagnostic('registry.read-ok'); return payload; }
  listCommands() { return this.request<Record<string, unknown>>('commands.list'); }
  listModels() { return this.request<Record<string, unknown>>('models.list', { view: 'default' }, 20000); }
  providerUsage() { return this.request<Record<string, unknown>>('usage.status'); }
  health() { return this.request<Record<string, unknown>>('health'); }
  describeSession(sessionKey: string) { return this.request<Record<string, unknown>>('sessions.describe', { key: sessionKey }); }
  /** `model: null` asks the Gateway to reset the thread to its configured default. */
  patchSessionModel(sessionKey: string, model: string | null, expectedSessionId?: string) {
    return this.request<Record<string, unknown>>('sessions.patch', {
      key: sessionKey,
      model,
      ...(expectedSessionId ? { expectedSessionId } : {}),
    }, 20000);
  }
  async createSession(parentSessionKey: string, label: string | undefined, message: string) {
    return createdGatewaySession(await this.request<Record<string, unknown>>('sessions.create', { parentSessionKey, ...(label === undefined ? {} : { label }), message, emitCommandHooks: false }, 15000));
  }
  async updateThreadRegistry(mode: 'upsert' | 'remove', entries: ThreadRegistryWireEntry[]) {
    if (!entries.length) throw new Error('A thread-registry update requires at least one entry.');
    return assertThreadRegistryUpdate(await this.request<Record<string, unknown>>('vimicate.registry.updateThreads', { mode, entries, contract: 'host-current-v1' }, 15000));
  }
  resetSession(sessionKey: string) { return this.request<Record<string, unknown>>('sessions.reset', { key: sessionKey, reason: 'new' }, 15000); }
  history(sessionKey: string, limit = 80, offset = 0) { return this.request<Record<string, unknown>>('chat.history', { sessionKey, limit, offset }); }
  getMessage(sessionKey: string, messageId: string, maxChars = 65_536) { return this.request<Record<string, unknown>>('chat.message.get', { sessionKey, messageId, maxChars }, 20000); }
  archivedHistoryRequest(params: Record<string, unknown>) { return this.request<Record<string, unknown>>('vimicate.history.family', params, 30000); }
  sharedNarrationRequest(params: Record<string, unknown>) { return this.request<Record<string, unknown>>('vimicate.narration.page', params, 30000); }
  async listProjectFiles(projectId: string, path = '') {
    return projectFileListFromPayload(
      await this.request('vimicate.projectFiles.list', { projectId, path, includeUnsupported: true, includeDocuments: true }, 20000), projectId, path,
    );
  }
  async readProjectFile(projectId: string, path: string) {
    return projectFileContentFromPayload(
      await this.request('vimicate.projectFiles.read', { projectId, path, includeDocuments: true }, 20000), projectId, path,
    );
  }
  async resolveSharedFile(sourcePath: string) {
    return sharedFileResolutionFromPayload(await this.request('vimicate.sharedFiles.resolve', { sourcePath }, 20000));
  }
  async listSharedFiles(projectId: string, path = '') {
    return sharedProjectFileListFromPayload(await this.request('vimicate.sharedFiles.list', { projectId, path, includeUnsupported: true, includeDocuments: true }, 20000), projectId, path);
  }
  async readSharedFile(projectId: string, path: string) {
    return sharedProjectFileContentFromPayload(await this.request('vimicate.sharedFiles.read', { projectId, path, includeDocuments: true }, 20000), projectId, path);
  }
  decorateMessages(messages: WorkspaceMessage[], sessionKey: string) {
    const profile = this.profile; if (!profile) return messages;
    return decorateGatewayMedia(messages, profile.endpoint, profile.credential, sessionKey);
  }
  resolveArtifact = async (artifactId: string, sessionKey: string, signal: AbortSignal) => {
    const profile = this.profile; const generation = this.generation;
    if (!profile || this.status !== 'connected' || signal.aborted) throw new Error('Image connection unavailable');
    const payload = await this.request('artifacts.download', { artifactId, sessionKey }, 15000);
    if (generation !== this.generation || signal.aborted) throw new Error('Image request retired');
    return gatewayArtifactDownloadSource(payload, profile.endpoint, artifactId, sessionKey);
  }
  send(sessionKey: string, message: string, attachments: GatewayPromptAttachment[] = [], idempotencyKey = Crypto.randomUUID(), control?: 'steer' | GatewaySendControl, replyToId?: string) { return this.request<Record<string, unknown>>('chat.send', { sessionKey, message, deliver: false, timeoutMs: 0, idempotencyKey, ...(replyToId ? { replyToId } : {}), ...gatewaySendControlFields(control), ...(attachments.length ? { attachments: attachments.map((attachment) => ({ type: 'file', mimeType: attachment.mimeType, fileName: attachment.filename, content: attachment.dataBase64 })) } : {}) }, 35000); }
  abort(sessionKey: string, runId?: string) { return this.request<Record<string, unknown>>('chat.abort', runId ? { sessionKey, runId } : { sessionKey }); }
  resolveApproval(kind: 'exec' | 'plugin', id: string, decision: string) { return this.request<Record<string, unknown>>(`${kind}.approval.resolve`, { id, decision }); }
  listApprovals(kind: 'exec' | 'plugin') { return this.request<unknown[]>(`${kind}.approval.list`, {}); }
  get connectionRevision() { return this.generation; }
  hasOperatorScope(scope: string) { return !(scope === 'operator.questions' && this.questionsDisabled) && profileHasOperatorScope(this.profile, scope); }
  waitForRun(runId: string, timeoutMs = 30000) { return this.request<AgentWaitResult>('agent.wait', { runId, timeoutMs }, timeoutMs + 5000); }

  followSession(sessionKey: string) { return this.sessionSubscription.follow(sessionKey); }

  private async handleFrame(raw: string, generation: number) {
    let frame: Frame; try { frame = JSON.parse(raw) as Frame; } catch { this.onEvent({ type: 'invalid', size: raw.length }); return; }
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      const nonce = (frame.payload as { nonce?: string } | undefined)?.nonce; if (!nonce || !this.profile) { this.setStatus('error', 'Invalid connect challenge'); return; }
      try {
        recordGatewayDiagnostic('connect.challenge');
        const credential = this.profile.credential; const scopes = operatorScopesForProfile(this.profile).filter(scope => !this.questionsDisabled || scope !== 'operator.questions');
        const physicalDevice = Device.isDevice !== false;
        const physicalDeviceFamily = Device.deviceType === Device.DeviceType.PHONE ? 'iphone' as const : 'ipad' as const;
        const deviceFamily = gatewayDeviceFamilyForProfile(this.profile, physicalDeviceFamily);
        const identity = await loadOrCreateIdentity(this.profile.authoritySource === 'sharedKeychain' && physicalDevice, physicalDevice);
        if (generation !== this.generation) return;
        const device = await buildDeviceAuth(identity, credential, nonce, scopes, { deviceFamily });
        if (generation !== this.generation) return;
        recordGatewayDiagnostic('connect.identity-ready');
        const authKey = this.profile.credentialKind === 'bootstrapToken' ? 'bootstrapToken' : this.profile.credentialKind === 'deviceToken' ? 'deviceToken' : 'token';
        const caps = scopes.some(scope => scope === 'operator.approvals' || scope === 'operator.admin') ? ['tool-events', 'plugin-approvals'] : ['tool-events'];
        const payload = await this.request<Record<string, unknown>>('connect', { minProtocol: 3, maxProtocol: 4, client: { id: 'openclaw-ios', displayName: 'Vimicate', version: '0.1.0', platform: 'ios', deviceFamily, mode: 'ui' }, role: 'operator', scopes, caps, commands: [], permissions: {}, locale: 'en', userAgent: 'vimicate-rn/0.1.0', ...(credential ? { auth: { [authKey]: credential } } : {}), device }, 12000);
        if (generation !== this.generation || payload.type !== 'hello-ok') return;
        recordGatewayDiagnostic('connect.hello-ok');
        if (this.hasOperatorScope('operator.questions')) this.questionScopeNotice = '';
        const auth = payload.auth as { deviceToken?: string; scopes?: string[] } | undefined;
        if (auth?.deviceToken) {
          try { this.onIssuedDeviceToken(auth.deviceToken, auth.scopes ?? []); }
          catch (error) { this.reportEventFailure(error, 'connect.token-publication-failed'); }
        }
        await this.request('sessions.subscribe', undefined, 5000);
        if (generation !== this.generation) return;
        recordGatewayDiagnostic('connect.sessions-subscribed');
        await this.request('health', undefined, 5000);
        if (generation !== this.generation) return;
        recordGatewayDiagnostic('connect.health-ok'); this.setStatus('connected', 'protocol hello-ok + health');
        if (!this.hasOperatorScope('operator.questions') && this.profile.credentialKind === 'deviceToken' && this.questionUpgradeGeneration !== generation) {
          this.questionUpgradeGeneration = generation;
          this.questionScopeNotice = questionScopeNotice.required;
          launchGuardedBackgroundTask(() => this.upgradeQuestionScope(generation), () => undefined);
        }
      } catch (error) { if (generation !== this.generation) return; const message = error instanceof Error ? error.message : 'Handshake failed'; recordGatewayDiagnostic(`connect.failed ${message}`); this.setStatus('error', message); }
      return;
    }
    if (frame.type === 'res' && typeof frame.id === 'string') {
      const entry = this.pending.get(frame.id); if (!entry) return; this.pending.delete(frame.id); clearTimeout(entry.timer);
      this.refusalEchoes.record(entry.refusalScope, frame);
      if (frame.ok === true) entry.resolve(frame.payload); else entry.reject(gatewayResponseFailure(frame.error));
      return;
    }
    if (this.refusalEchoes.matches(frame)) return;
    dispatchGatewayEventSafely(frame, this.onEvent, (error) => {
      this.reportEventFailure(error, 'event.projection-failed');
    });
  }
  private setStatus(status: GatewayStatus, detail?: string) {
    if (status === 'error' || status === 'disconnected') this.refusalEchoes.clear();
    this.status = status;
    try { this.onStatus(status, detail); }
    catch (error) { this.reportEventFailure(error, 'status.publication-failed'); }
    const waiter = this.connectWaiter;
    if (!waiter || waiter.generation !== this.generation) return;
    if (status === 'connected') this.finishConnect();
    if (status === 'error' || status === 'disconnected') {
      if (status === 'error') {
        this.socket?.close(); this.socket = null;
        this.pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(new Error(detail ?? 'Gateway connection failed')); });
        this.pending.clear();
      }
      this.finishConnect(new Error(detail ?? 'Gateway connection failed'));
    }
  }

  private finishConnect(error?: Error) {
    const waiter = this.connectWaiter; if (!waiter) return;
    this.connectWaiter = null; clearTimeout(waiter.timer);
    if (error) waiter.reject(error); else waiter.resolve();
  }
  private reportEventFailure(error: unknown, diagnostic: string) {
    recordGatewayDiagnostic(diagnostic);
    try { this.onEventError(error); } catch { /* Failure reporting is the terminal containment boundary. */ }
  }
  private async upgradeQuestionScope(generation: number) {
    const profile = this.profile; if (!profile) return;
    try {
      const scopes = [...new Set([...operatorScopesForProfile(profile), 'operator.questions'])];
      const request = await this.request<{ requestId?: unknown }>('device.scopes.requestUpgrade', { scopes });
      if (generation !== this.generation) return;
      if (typeof request.requestId !== 'string' || !request.requestId.trim()) throw new Error('Invalid scope upgrade response');
      this.questionScopeNotice = questionScopeNotice.pending;
      const result = await this.request<{ status?: unknown; deviceToken?: unknown; scopes?: unknown }>('device.scopes.waitUpgrade', { requestId: request.requestId }, 300000);
      if (generation !== this.generation) return;
      if (result.status !== 'approved') { this.questionScopeNotice = result.status === 'rejected' ? questionScopeNotice.rejected : questionScopeNotice.unavailable; return; }
      if (typeof result.deviceToken !== 'string' || !result.deviceToken || !Array.isArray(result.scopes) || !result.scopes.every(scope => typeof scope === 'string') || !result.scopes.includes('operator.questions')) throw new Error('Invalid approved scope upgrade');
      const approvedScopes = result.scopes as string[];
      this.onIssuedDeviceToken(result.deviceToken, approvedScopes);
      await this.connect({ ...profile, credential: result.deviceToken, scopes: approvedScopes });
    } catch (error) {
      if (generation === this.generation) this.questionScopeNotice = questionScopeNotice.unavailable;
    }
  }
}
