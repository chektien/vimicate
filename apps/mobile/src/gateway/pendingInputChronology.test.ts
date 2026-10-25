import { expect, it } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { mergeLatestHistory } from './historyPagination';
import { mergeSharedNarration } from './sharedNarration';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { bindOptimisticPromptToRun } from './submissionRunBinding';
import { localPromptMessage } from './submissionMessages';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';
import { completePendingInputSnapshot, pendingInputCustodyCandidates } from './pendingInputSnapshot';

const sessionKey = 'test-session';
const sessionId = '00000000-0000-4000-8000-000000000106';
const wire = (id: string, seq: number, timestamp: number, role: string = 'assistant') => ({
  role, content: id, timestamp,
  __openclaw: { id, transcriptPosition: { source: 'sqlite', rawSeq: seq } },
});
const before = wire('before', 20503, 1789348310000);
const after = wire('after', 20519, 1789348573980);
const pending = { id: 'stop', runId: 'next-run', state: 'queued', acceptedAt: 1789348324752,
  message: { role: 'user', content: 'stop', idempotencyKey: 'stop-key' } };
const page = (messages: unknown[], inputs: unknown[] = [pending]) => messagesFromPayload({
  sessionKey, sessionId, messages, pendingInputs: { items: inputs },
});
const texts = (rows: ReturnType<typeof page>) => rows.map(row => row.text);

it('keeps a remotely accepted pending input before later native output on parsing, refresh and cold cache', () => {
  let rows = page([before]);
  for (let n = 0; n < 3; n++) {
    rows = mergeLatestHistory(page([before, after]), rows, sessionKey);
    rows = mergeSharedNarration(rows, []);
    expect(texts(rows)).toEqual(['before', 'stop', 'after']);
    rows = parsedTranscriptCache(serializedTranscriptCache(rows));
    expect(texts(rows)).toEqual(['before', 'stop', 'after']);
  }
});

it('keeps two delayed pending inputs in accepted order rather than grouping them at the tail', () => {
  const second = { ...pending, id: 'second', acceptedAt: 1789348600000,
    message: { ...pending.message, content: 'second', idempotencyKey: 'second-key' } };
  expect(texts(page([before, after, wire('last', 20540, 1789348711307)], [pending, second])))
    .toEqual(['before', 'stop', 'after', 'second', 'last']);
});

it('retains acceptance across exact pending-to-canonical identity convergence and subsequent refresh', () => {
  let rows = page([before, after]);
  const canonical = { ...wire('stop', 20576, pending.acceptedAt, 'user'), idempotencyKey: 'stop-key:user' };
  const canonicalPage = page([before, after, canonical], []);
  for (let n = 0; n < 3; n++) {
    rows = mergeLatestHistory(canonicalPage, rows, sessionKey);
    expect(texts(rows)).toEqual(['before', 'stop', 'after']);
    expect(rows.filter(row => row.text === 'stop')).toHaveLength(1);
    expect(rows.find(row => row.text === 'stop')?.displayPosition?.rawSeq).toBe(20576);
    rows = parsedTranscriptCache(serializedTranscriptCache(rows));
  }
});

it('converges the display-only pending custody row with its committed Codex prompt', () => {
  const acceptedAt = 1789815458637;
  const submissionId = '00000000-0000-4000-b000-000000000143';
  const runId = '00000000-0000-4000-b000-000000000104';
  const prompt = 'and summarize progress';
  const canonical = {
    role: 'user', content: prompt, timestamp: acceptedAt,
    idempotencyKey: `${submissionId}:user`,
    __openclaw: {
      id: '00000000-0000-4000-a000-000000000101', runId,
      mirrorOrigin: 'codex-app-server', mirrorIdentity: 'codex-session:codex-turn:prompt',
      recordTimestampMs: 1789815605966,
      transcriptPosition: { source: 'sqlite', rawSeq: 21280 },
    },
  };
  // OpenClaw 2026.9.5 intentionally removes the pending message's transport
  // idempotency key. Its top-level runId is the accepted client submission
  // identity, while the later Codex mirror carries the execution run identity.
  const pendingWithoutSubmissionKey = {
    id: 'pending-custody', runId: submissionId, state: 'queued', acceptedAt,
    message: { role: 'user', content: prompt, __openclaw: { id: 'pending:pending-custody' } },
  };
  const optimistic: ReturnType<typeof page>[number] = {
    id: 'local-ae45ef81', role: 'user', text: prompt, source: 'local', sessionKey,
    runId: 'active-lifecycle-run', inputReceiptRunId: submissionId,
    idempotencyKey: submissionId, timestamp: String(acceptedAt),
  };

  const latest = page([canonical], [pendingWithoutSubmissionKey]);
  let merged = mergeLatestHistory(latest, [optimistic], sessionKey);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    expect(merged.filter(row => row.role === 'user')).toEqual([
      expect.objectContaining({
        id: '00000000-0000-4000-a000-000000000101', text: prompt,
        runId, idempotencyKey: '00000000-0000-4000-b000-000000000143:user',
        displayPosition: { source: 'sqlite', rawSeq: 21280 },
      }),
    ]);
    merged = mergeLatestHistory(latest, parsedTranscriptCache(serializedTranscriptCache(merged)), sessionKey);
  }
});

it('converges a media pending custody row only with its exact committed media prompt', () => {
  const acceptedAt = 1789834398410;
  const runId = '00000000-0000-4000-8000-000000000103';
  const prompt = 'there is some serious out of order prompt displays in the transcript';
  const mediaSource = 'media://inbound/00000000-0000-4000-a000-000000000116.png';
  const media = [{
    url: mediaSource,
    contentType: 'image/png', kind: 'image', sizeBytes: 417975,
  }];
  const canonical = {
    role: 'user', content: prompt, timestamp: acceptedAt,
    idempotencyKey: '00000000-0000-4000-a000-000000000119:user',
    __openclaw: {
      id: '00000000-0000-4000-a000-000000000123', runId,
      media, mirrorOrigin: 'codex-app-server', mirrorIdentity: 'codex-session:codex-turn:prompt',
      recordTimestampMs: 1789834411411,
      transcriptPosition: { source: 'sqlite', rawSeq: 23134 },
    },
  };
  const pendingWithoutSubmissionKey = {
    id: 'pending-media-custody', runId, state: 'queued', acceptedAt,
    message: { role: 'user', content: prompt, media, __openclaw: { id: 'pending:pending-media-custody' } },
  };

  const merged = mergeLatestHistory(page([canonical], [pendingWithoutSubmissionKey]), [], sessionKey);
  expect(merged.filter(row => row.role === 'user')).toEqual([
    expect.objectContaining({
      id: canonical.__openclaw.id, text: prompt, runId,
      displayPosition: { source: 'sqlite', rawSeq: 23134 },
      attachments: [expect.objectContaining({
        uri: `/__openclaw__/assistant-media?source=${encodeURIComponent(mediaSource)}`,
        mimeType: 'image/png',
      })],
    }),
  ]);
});

it('converges an acknowledged active-run local prompt with pending custody before canonical ingestion', () => {
  const acceptedAt = 1789839783745;
  const receiptRunId = '00000000-0000-4000-a000-000000000102';
  const activeRunId = 'project-state-dot-run';
  const text = 'deleted threads are also fine';
  const queued = { id: 'pending-deletion', runId: receiptRunId, state: 'queued', acceptedAt,
    message: { role: 'user', content: text, __openclaw: { id: 'pending:pending-deletion' } } };
  const local: ReturnType<typeof page>[number] = {
    id: 'local-deletion', role: 'user', text, source: 'local', sessionKey,
    runId: activeRunId, idempotencyKey: 'submission-deletion', timestamp: String(acceptedAt - 400),
  };

  const currentBefore = wire('current-before', 23560, acceptedAt - 1000);
  const currentAfter = wire('current-after', 23561, acceptedAt + 1000);
  const pendingPage = page([currentBefore, currentAfter], [queued]);
  const acknowledged = bindOptimisticPromptToRun([local], local.id, activeRunId, receiptRunId);
  const merged = mergeLatestHistory(pendingPage, acknowledged, sessionKey);
  expect(merged.filter(row => row.text === text)).toEqual([expect.objectContaining({
    id: local.id, source: 'local', runId: activeRunId, inputReceiptRunId: receiptRunId,
    transcriptSessionId: sessionId, inputAcceptedAtMs: acceptedAt, timestamp: String(acceptedAt),
  })]);
  expect(texts(merged)).toEqual(['current-before', text, 'current-after']);
});

it('converges pending custody with its exact outbound submission before acknowledgement', () => {
  const acceptedAt = 1789982223967;
  const submissionId = '00000000-0000-4000-8000-000000000149';
  const text = 'add remote directories to the files browser later';
  const queued = { id: 'pending-remote-dirs', runId: submissionId, state: 'queued', acceptedAt,
    message: { role: 'user', content: text, __openclaw: { id: 'pending:pending-remote-dirs' } } };
  const local: ReturnType<typeof page>[number] = {
    id: `local-${submissionId}`, role: 'user', text, source: 'local', sessionKey,
    runId: 'active-lifecycle-run', idempotencyKey: submissionId, timestamp: String(acceptedAt - 300),
  };

  const merged = mergeLatestHistory(page([before, after], [queued]), [local], sessionKey);
  expect(merged.filter(row => row.text === text)).toEqual([expect.objectContaining({
    id: local.id, source: 'local', runId: 'active-lifecycle-run', inputReceiptRunId: submissionId,
    transcriptSessionId: sessionId, inputAcceptedAtMs: acceptedAt, timestamp: String(acceptedAt),
  })]);
  expect(mergeLatestHistory(page([], [queued]), [
    { ...local, id: 'different-local', idempotencyKey: 'different-submission' },
  ], sessionKey).filter(row => row.text === text)).toHaveLength(2);
  expect(mergeLatestHistory(page([], [
    queued, { ...queued, id: 'ambiguous-pending-alias' },
  ]), [local], sessionKey).filter(row => row.text === text)).toHaveLength(3);
});

it('settles a pending-before-ack race and preserves local media through cold-cache restoration', () => {
  const acceptedAt = 1789839841465;
  const receiptRunId = '00000000-0000-4000-b000-000000000140';
  const activeRunId = 'project-state-dot-run';
  const text = 'repeated prompt records in the transcript is still a problem as you see here';
  const managed = [{ url: 'media://inbound/7965e17c.png', contentType: 'image/png', kind: 'image', sizeBytes: 418100 }];
  const queued = { id: 'pending-media', runId: receiptRunId, state: 'queued', acceptedAt,
    message: { role: 'user', content: text, media: managed, __openclaw: { id: 'pending:pending-media', media: managed } } };
  const localAttachment = { id: 'picker-media', filename: 'screenshot.png', mimeType: 'image/png',
    uri: 'file:///private/picker/screenshot.png', byteCount: 418100 };
  const local: ReturnType<typeof page>[number] = {
    id: 'local-media', role: 'user', text, source: 'local', sessionKey,
    runId: activeRunId, idempotencyKey: 'submission-media', timestamp: String(acceptedAt - 500),
    attachments: [localAttachment],
  };

  const pendingPage = page([before, after], [queued]);
  const beforeAck = mergeLatestHistory(pendingPage, [local], sessionKey);
  expect(beforeAck.filter(row => row.text === text)).toHaveLength(2);
  const acknowledged = bindOptimisticPromptToRun(beforeAck, local.id, activeRunId, receiptRunId);
  const afterAck = mergeLatestHistory(pendingPage, acknowledged, sessionKey);
  expect(afterAck.filter(row => row.text === text)).toEqual([expect.objectContaining({
    id: local.id, source: 'local', runId: activeRunId, inputReceiptRunId: receiptRunId,
    attachments: [localAttachment], inputAcceptedAtMs: acceptedAt,
  })]);
  const restored = parsedTranscriptCache(serializedTranscriptCache(afterAck));
  expect(mergeLatestHistory(pendingPage, restored, sessionKey).filter(row => row.text === text)).toHaveLength(1);

  const canonical = {
    role: 'user', content: text, timestamp: acceptedAt, idempotencyKey: 'submission-media:user',
    __openclaw: {
      id: 'canonical-media', runId: receiptRunId, media: managed,
      mirrorOrigin: 'codex-app-server', mirrorIdentity: 'media-turn:prompt',
      recordTimestampMs: acceptedAt + 100, transcriptPosition: { source: 'sqlite', rawSeq: 23583 },
    },
  };
  const committed = mergeLatestHistory(page([canonical], [queued]), restored, sessionKey)
    .filter(row => row.text === text);
  expect(committed).toEqual([expect.objectContaining({
    id: 'canonical-media', source: 'history', runId: receiptRunId,
    attachments: [expect.objectContaining({ uri: expect.stringContaining(encodeURIComponent(managed[0]!.url)) })],
  })]);
  expect(committed[0]?.attachments).not.toEqual([localAttachment]);
});

it('retires a stale Claude custody snapshot when canonical history replaces an unacknowledged local prompt', () => {
  const acceptedAt = 1789886184265;
  const text = 'stop using opencode astra';
  const submission = '00000000-0000-4000-a000-000000000158';
  const queued = {
    id: 'queued-claude-input', runId: 'chat-send-receipt', state: 'queued', acceptedAt,
    message: { role: 'user', content: text, __openclaw: { id: 'pending:queued-claude-input' } },
  };
  const local: ReturnType<typeof page>[number] = {
    id: `local-${submission}`, role: 'user', text, source: 'local', sessionKey,
    runId: 'active-claude-run', idempotencyKey: submission, timestamp: String(acceptedAt - 200),
  };

  // The pending snapshot can publish before chat.send acknowledges. Without
  // that acknowledgement, the local row and custody alias deliberately remain
  // separate until a stronger identity arrives.
  const pendingPayload = {
    sessionKey, sessionId, messages: [before], pendingInputs: { items: [queued], total: 1 },
  };
  const beforeAcknowledgement = mergeLatestHistory(messagesFromPayload(pendingPayload), [local], sessionKey);
  expect(beforeAcknowledgement.filter(row => row.text === text)).toHaveLength(2);
  const candidates = pendingInputCustodyCandidates(beforeAcknowledgement, sessionKey);

  // Claude CLI canonical inputs retain the exact submission identity and CLI
  // provenance, but do not carry Codex's runId/inputAcceptedAt descriptors.
  // The latest queue snapshot no longer includes this accepted input.
  const canonical = {
    role: 'user', content: text, timestamp: acceptedAt, idempotencyKey: `${submission}:user`,
    __openclaw: {
      id: '00000000-0000-4000-8000-000000000155', importedFrom: 'claude-cli',
      cliSessionId: '00000000-0000-4000-8000-000000000117',
      externalId: '00000000-0000-4000-b000-000000000134',
      recordTimestampMs: acceptedAt + 60_000,
      transcriptPosition: { source: 'sqlite', rawSeq: 12568 },
    },
  };
  const settledPayload = {
    sessionKey, sessionId, messages: [before, canonical], pendingInputs: { items: [], total: 0 },
  };
  const latest = messagesFromPayload(settledPayload);
  const snapshot = completePendingInputSnapshot(settledPayload, latest, sessionKey);
  expect(snapshot).not.toBeNull();
  const settled = mergeLatestHistory(latest, beforeAcknowledgement, sessionKey, {
    snapshot: snapshot!, candidates,
  });
  expect(settled.filter(row => row.text === text)).toEqual([expect.objectContaining({
    id: canonical.__openclaw.id, source: 'history', idempotencyKey: `${submission}:user`,
    cliProvenance: {
      kind: 'claude-native', sessionId: canonical.__openclaw.cliSessionId,
      externalId: canonical.__openclaw.externalId,
    },
  })]);
});

it('preserves distinct equal-text accepted sends and rejects foreign receipt or route aliases', () => {
  const text = 'intentional repeated prompt';
  const acceptedAt = 1789839900000;
  const queued = (id: string, runId: string, at: number) => ({ id, runId, state: 'queued', acceptedAt: at,
    message: { role: 'user', content: text, __openclaw: { id: `pending:${id}` } } });
  const local = (id: string, receipt: string, at: number, route = sessionKey): ReturnType<typeof page>[number] => ({
    id, role: 'user', text, source: 'local', sessionKey: route, runId: 'shared-active-run',
    inputReceiptRunId: receipt, idempotencyKey: id, timestamp: String(at - 1),
  });
  const pendingPage = page([], [queued('first', 'receipt-one', acceptedAt), queued('second', 'receipt-two', acceptedAt + 1)]);
  const merged = mergeLatestHistory(pendingPage, [
    local('local-one', 'receipt-one', acceptedAt), local('local-two', 'receipt-two', acceptedAt + 1),
  ], sessionKey);
  expect(merged.filter(row => row.text === text).map(row => row.id)).toEqual(['local-one', 'local-two']);

  expect(mergeLatestHistory(page([], [queued('wrong', 'receipt-one', acceptedAt)]), [
    local('wrong-receipt', 'different-receipt', acceptedAt),
  ], sessionKey).filter(row => row.text === text)).toHaveLength(2);
  expect(coalesceTranscriptIdentities([
    ...page([], [queued('wrong-route', 'receipt-one', acceptedAt)]),
    local('foreign-route', 'receipt-one', acceptedAt, 'other-route'),
  ]).filter(row => row.text === text)).toHaveLength(2);
  expect(coalesceTranscriptIdentities([
    ...page([], [queued('wrong-generation', 'receipt-one', acceptedAt)]),
    { ...local('foreign-generation', 'receipt-one', acceptedAt), transcriptSessionId: '00000000-0000-4000-a000-000000000145' },
  ]).filter(row => row.text === text)).toHaveLength(2);
});

it('does not infer acceptance from a native user timestamp, matching prose, or an arbitrary raw field', () => {
  const canonical = { ...wire('stop', 20576, pending.acceptedAt, 'user'), inputAcceptedAtMs: pending.acceptedAt };
  expect(texts(page([before, after, canonical], []))).toEqual(['before', 'after', 'stop']);
});

it('does not attach a queued prompt to a different concrete generation', () => {
  const foreign = page([before, after], []);
  const pendingOnly = messagesFromPayload({ sessionKey, sessionId: '00000000-0000-4000-a000-000000000145',
    messages: [], pendingInputs: { items: [pending] } });
  expect(texts(mergeSharedNarration([...foreign, ...pendingOnly], []))).toEqual(['before', 'after', 'stop']);
});

it('reconstructs accepted order from a committed Codex prompt on a fresh client with no pending cache', () => {
  const canonical = { ...wire('stop', 20576, pending.acceptedAt, 'user'), idempotencyKey: 'stop-key:user',
    __openclaw: { ...wire('stop', 20576, pending.acceptedAt).__openclaw,
      mirrorOrigin: 'codex-app-server', mirrorIdentity: 'turn:prompt', runId: 'next-run', recordTimestampMs: 1789348947685 } };
  expect(texts(page([before, after, canonical], []))).toEqual(['before', 'stop', 'after']);
});

it('does not relocate a pending input across another route even if a generation identifier is shared', () => {
  const pendingOnly = page([], [pending]);
  const foreign = page([before, after], []).map(row => ({ ...row, sessionKey: 'other-route' }));
  expect(texts(mergeSharedNarration([...pendingOnly, ...foreign], []))).toEqual(['stop', 'before', 'after']);
});

it('requires explicit native inbound provenance and valid host times for committed input gaps', () => {
  const base = wire('stop', 20576, pending.acceptedAt, 'user');
  for (const patch of [ { mirrorOrigin: 'other' }, { mirrorIdentity: 'turn:assistant' },
    { runId: '' }, { recordTimestampMs: pending.acceptedAt - 1 }, { recordTimestampMs: NaN } ]) {
    const canonical = { ...base, idempotencyKey: 'stop-key:user', __openclaw: { ...base.__openclaw,
      mirrorOrigin: 'codex-app-server', mirrorIdentity: 'turn:prompt', runId: 'next-run',
      recordTimestampMs: 1789348947685, ...patch } };
    expect(texts(page([before, after, canonical], []))).toEqual(['before', 'after', 'stop']);
  }
});

it('recognizes explicit steer acceptance without requiring a Codex prompt mirror', () => {
  const canonical = { ...wire('stop', 20576, pending.acceptedAt, 'user'), idempotencyKey: 'stop-key:user',
    __openclaw: { ...wire('stop', 20576, pending.acceptedAt).__openclaw,
      steerTargetRunId: 'active-run', recordTimestampMs: 1789348947685 } };
  expect(texts(page([before, after, canonical], []))).toEqual(['before', 'stop', 'after']);
});

it('binds an explicitly steered canonical user message to the original active run', () => {
  const input = { ...wire('stop', 20576, pending.acceptedAt, 'user'), idempotencyKey: 'stop-key:user',
    __openclaw: { ...wire('stop', 20576, pending.acceptedAt).__openclaw,
      steerTargetRunId: 'active-run', recordTimestampMs: 1789348947685 } };
  expect(page([input], [])[0]).toMatchObject({ role: 'user', runId: 'active-run', idempotencyKey: 'stop-key:user' });
});

it('retires steer custody whose host acceptance follows the canonical request stamp, keeping repeated sends', () => {
  // OpenClaw stamps a chat.send message when the request begins and stages its
  // pending custody later in that request; chat.history then reads custody
  // before the transcript page, so one response can hold both projections.
  const requestStart = 1792405143484;
  const custodyAt = requestStart + 37;
  const activeRun = 'steer-target-run';
  const text = 'a long idea for later';
  const wrapped = `Vimicate project context:\n- Project: Example\n\nUser prompt:\n${text}`;
  const canonical = (submission: string, seq: number, at = requestStart) => ({
    role: 'user', content: wrapped, timestamp: at, idempotencyKey: `${submission}:user`,
    __openclaw: { id: `canonical-${submission}`, steerTargetRunId: activeRun, senderIsOwner: true,
      recordTimestampMs: at + 652, transcriptPosition: { source: 'sqlite', rawSeq: seq } },
  });
  const custody = (submission: string, at = custodyAt) => ({ id: `custody-${submission}`, runId: submission, state: 'queued',
    acceptedAt: at, message: { role: 'user', content: wrapped, __openclaw: { id: `pending:custody-${submission}` } } });
  const narration = wire('narration', 4108, requestStart - 3000);
  const steers = (rows: ReturnType<typeof page>) => rows.filter(row => row.role === 'user').map(row => row.id);
  const local = bindOptimisticPromptToRun([localPromptMessage('local-first', 'first', sessionKey, text, [], activeRun)],
    'local-first', activeRun, 'first');

  let rows = mergeLatestHistory(page([narration, canonical('first', 4109)], [custody('first')]), local, sessionKey);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    expect(steers(rows)).toEqual(['canonical-first']);
    rows = mergeLatestHistory(page([narration, canonical('first', 4109)], []), parsedTranscriptCache(serializedTranscriptCache(rows)), sessionKey);
  }
  // Reopen or another device: custody was painted before the canonical page.
  const custodyOnly = mergeLatestHistory(page([narration], [custody('first')]), [], sessionKey);
  expect(steers(mergeLatestHistory(page([narration, canonical('first', 4109)], []), custodyOnly, sessionKey))).toEqual(['canonical-first']);

  // Equal text with distinct submissions stays two inputs in both projections.
  expect(steers(mergeLatestHistory(page([narration, canonical('first', 4109), canonical('second', 4112, requestStart + 9000)],
    [custody('first'), custody('second', requestStart + 9040)]), [], sessionKey))).toEqual(['canonical-first', 'canonical-second']);
  // Custody accepted before its request began, a foreign submission, or another
  // generation proves no shared input.
  for (const [input, alias] of [[canonical('first', 4109, custodyAt + 1), custody('first')], [canonical('first', 4109), custody('other')]] as const) {
    expect(steers(mergeLatestHistory(page([narration, input], [alias]), [], sessionKey))).toHaveLength(2);
  }
  const [committed, pendingAlias] = [page([canonical('first', 4109)], [])[0]!, page([], [custody('first')])[0]!];
  expect(coalesceTranscriptIdentities([{ ...committed, transcriptSessionId: '00000000-0000-4000-a000-000000000145' }, pendingAlias])).toHaveLength(2);
});
