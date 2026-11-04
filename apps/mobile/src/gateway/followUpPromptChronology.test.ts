import { expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { latestHistoryRefreshAction } from './historyReviewPublication';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { upsertLiveMessage } from './gatewayEventProjection';

const sessionKey = 'chronology-fixture';
const generation = '00000000-0000-4000-8000-000000000117';
const firstPrompt: WorkspaceMessage = {
  id: 'first-prompt', role: 'user', source: 'history', sessionKey,
  text: 'Was the update delivered?', runId: 'first-run', idempotencyKey: 'first-input:user',
  transcriptSessionId: generation, timestamp: '1793667340000',
  displayPosition: { source: 'sqlite', rawSeq: 10 },
};
const liveAnswer: WorkspaceMessage = {
  id: 'live-chat-first-run', role: 'assistant', source: 'live', sessionKey,
  text: 'The app update is delivered. The source publication is blocked.',
  runId: 'first-run', state: 'complete', timestamp: '1793667374539',
};
const savedAnswer: WorkspaceMessage = {
  ...liveAnswer, id: 'saved-answer', source: 'history', transcriptSessionId: generation,
  idempotencyKey: 'native-turn:assistant', displayPosition: { source: 'sqlite', rawSeq: 20 },
};
const followUp: WorkspaceMessage = {
  id: 'local-follow-up', role: 'user', source: 'local', sessionKey,
  text: 'What should I verify?', runId: 'next-run', idempotencyKey: 'next-input',
  timestamp: '1793667672678',
};
const texts = (rows: WorkspaceMessage[]) => rows.filter(row => row.role !== 'run').map(row => row.text);
const expected = [firstPrompt.text, liveAnswer.text, followUp.text];

it.each([
  ['normal clocks', followUp.timestamp, liveAnswer.timestamp, savedAnswer.runId],
  ['client clock behind host', '1793667300000', liveAnswer.timestamp, savedAnswer.runId],
  ['untimed live answer', followUp.timestamp, undefined, savedAnswer.runId],
  ['canonical answer without run metadata', followUp.timestamp, liveAnswer.timestamp, undefined],
])('keeps a local follow-up below the prior answer during canonical replacement with %s', (_label, promptTime, answerTime, savedRun) => {
  const local = { ...followUp };
  if (promptTime) local.timestamp = promptTime;
  else delete local.timestamp;
  const live = { ...liveAnswer };
  if (answerTime) live.timestamp = answerTime;
  else delete live.timestamp;
  const saved = { ...savedAnswer };
  if (savedRun) saved.runId = savedRun;
  else delete saved.runId;
  let current = [firstPrompt, live, local];
  const publish = latestHistoryRefreshAction([firstPrompt, saved], sessionKey, () => current);
  // A partial refresh can succeed while the next request times out. Its
  // publication must already be correct, without waiting for prompt history.
  for (let pass = 0; pass < 3; pass++) {
    current = publish(current);
    expect(texts(current)).toEqual(expected);
    current = parsedTranscriptCache(serializedTranscriptCache(current));
    expect(texts(current)).toEqual(expected);
    current = upsertLiveMessage(current, live);
    expect(texts(current)).toEqual(expected);
  }
  const savedFollowUp: WorkspaceMessage = {
    ...followUp, id: 'saved-follow-up', source: 'history', transcriptSessionId: generation,
    idempotencyKey: 'next-input:user', displayPosition: { source: 'sqlite', rawSeq: 21 },
  };
  current = latestHistoryRefreshAction([firstPrompt, savedAnswer, savedFollowUp], sessionKey, () => current)(current);
  expect(texts(current)).toEqual(expected);
});

it('retains two distinct follow-ups after the answer and terminal footer on a partial page', () => {
  const second = { ...followUp, id: 'local-second', idempotencyKey: 'second-input', text: 'Also check the phone.' };
  const footer: WorkspaceMessage = { id: 'live-run-first-run', role: 'run', source: 'live',
    sessionKey, runId: 'first-run', text: 'Completed', state: 'complete' };
  let current = [firstPrompt, liveAnswer, footer, followUp, second];
  current = latestHistoryRefreshAction([firstPrompt, savedAnswer], sessionKey, () => current)(current);
  expect(texts(current)).toEqual([...expected, second.text]);
  expect(current.findIndex(row => row.id === footer.id)).toBeLessThan(current.findIndex(row => row.id === followUp.id));
});

it('does not use equal answer text from another run as a publication anchor', () => {
  const other: WorkspaceMessage = { ...savedAnswer, id: 'other-answer', runId: 'other-run',
    idempotencyKey: 'other-turn:assistant', timestamp: '1793667380000',
    displayPosition: { source: 'sqlite', rawSeq: 21 } };
  let current = [firstPrompt, liveAnswer, followUp];
  current = latestHistoryRefreshAction([firstPrompt, savedAnswer, other], sessionKey, () => current)(current);
  expect(current.filter(row => row.role !== 'run').map(row => row.id))
    .toEqual([firstPrompt.id, savedAnswer.id, followUp.id, other.id]);
  expect(current.filter(row => row.role === 'assistant')).toHaveLength(2);
});
