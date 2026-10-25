import { describe, expect, it } from 'vitest';
import { projectGatewayEvent } from '../gateway/gatewayEventProjection';
import { mergeLatestHistory, mergeOlderHistory } from '../gateway/historyPagination';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import {
  embeddedToolProtocolFixture, INTERLEAVED_PROTOCOL_TURN, liveProtocolMessages, PROTOCOL_ANSWER,
  PROTOCOL_ARTIFACTS, PROTOCOL_GLYPH_LINES, PROTOCOL_ONLY_TURN, QUOTED_PROTOCOL_ANSWER,
} from './embeddedToolProtocolFixture';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';

const SESSION = 'agent:fixture:dashboard:embedded-tool-protocol';

function rendered(messages: WorkspaceMessage[], expanded = new Set<string>()) {
  return buildVisibleTranscriptRenderRows(messages, expanded).map((row) => row.compiled.source);
}

function announced(messages: WorkspaceMessage[], messageID: string) {
  const row = buildVisibleTranscriptRenderRows(messages, new Set()).find((candidate) => candidate.message.id === messageID)!;
  return `${row.message.role}, line ${row.sourceRow + 1}, ${row.compiled.source || 'blank'}${row.fold ? `, ${row.fold.expanded ? 'collapse' : 'expand'} details` : ''}`;
}

/**
 * The reported leak: a runtime that lost the structure of its own tool traffic
 * delivers the invocation, the protocol framing and the raw result body inside
 * one assistant text part. The reader must still get the answer as prose and
 * the execution as one bounded, folded row.
 */
describe('tool protocol embedded in assistant text', () => {
  const messages = embeddedToolProtocolFixture();
  const turn = messages.filter((message) => message.id.startsWith('fixture-protocol-turn'));

  it('publishes the answer once and the recovered execution as its own bounded row', () => {
    expect(turn.map((message) => message.role)).toEqual(['assistant', 'tool']);
    expect(turn[0]!.text).toBe(PROTOCOL_ANSWER);
    expect(turn.map((message) => message.id)).toEqual(['fixture-protocol-turn', 'fixture-protocol-turn#tool-1']);
    expect(turn[1]!.tool?.summary).toBe('tool · Poll contributions trim run');
  });

  it('keeps every leaked artifact off the collapsed transcript', () => {
    // The control answer quotes the protocol on purpose; every other row is
    // projected material and must carry none of it.
    const projectedRows = buildVisibleTranscriptRenderRows(messages, new Set())
      .filter((row) => row.message.id !== 'fixture-protocol-quoted')
      .map((row) => row.compiled.source);
    for (const leak of PROTOCOL_ARTIFACTS) expect(projectedRows.join('\n'), leak).not.toContain(leak);
    for (const glyph of PROTOCOL_GLYPH_LINES) expect(projectedRows, glyph).not.toContain(glyph);
  });

  it('projects a turn that is protocol and nothing else as one tool row', () => {
    const only = messages.filter((message) => message.id.startsWith('fixture-protocol-only-turn'));
    expect(only.map((message) => message.role)).toEqual(['tool']);
    expect(only[0]!.id).toBe('fixture-protocol-only-turn');
    expect(only[0]!.tool?.summary).toBe('tool · Poll runner status');
  });

  it('reveals the invocation and the raw result body only on expansion', () => {
    const target = messages.find((message) => message.id === 'fixture-protocol-turn#tool-1')!;
    const expanded = rendered(messages, new Set([target.id])).join('\n');
    expect(expanded).toContain('"description":"Poll contributions trim run"');
    expect(expanded).toContain('elapsed: 1033s');
    expect(expanded).toContain('cwd: /Users/operator/repos/example');
    // Only the expanded row opens: the sibling turn's payload stays folded.
    expect(expanded).not.toContain('pid: 41287 (alive)');
  });

  it('leaves the answer unfolded, whole and ahead of its recovered tool row', () => {
    const rows = buildVisibleTranscriptRenderRows(messages, new Set());
    const answer = rows.filter((row) => row.message.id === 'fixture-protocol-turn');
    expect(answer).toHaveLength(1);
    expect(answer[0]!.fold).toBeUndefined();
    expect(answer[0]!.compiled.source).toBe(PROTOCOL_ANSWER);
    const tool = rows.find((row) => row.message.id === 'fixture-protocol-turn#tool-1')!;
    expect(rows.indexOf(tool)).toBe(rows.indexOf(answer[0]!) + 1);
  });

  it('announces a recovered tool row by its identity and expansion affordance', () => {
    const label = announced(messages, 'fixture-protocol-turn#tool-1');
    expect(label).toContain('tool, line ');
    expect(label).toContain('tool · Poll contributions trim run');
    expect(label).toContain('expand details');
    for (const leak of PROTOCOL_ARTIFACTS) expect(label, leak).not.toContain(leak);
  });
});

/**
 * Reviewable render evidence: the exact collapsed transcript for the preserved
 * route, including the control answer that quotes the same protocol on purpose.
 */
describe('collapsed embedded-protocol render', () => {
  it('renders the fixture exactly as the reader receives it', () => {
    expect(rendered(embeddedToolProtocolFixture())).toEqual([
      'Did the contributions trim land?',
      PROTOCOL_ANSWER,
      'tool · Poll contributions trim run  … [9 lines folded]',
      'And the run before it?',
      'tool · Poll runner status  … [8 lines folded]',
      'Here is the leak you reported, exactly as the runtime emitted it:',
      '```text',
      '±',
      'functionresults',
      '{"command":"echo quoted","description":"Quoted example"}',
      '```',
      'The `functionresults` marker is the giveaway.',
    ]);
  });
});

/**
 * Classification is structural. Quoted evidence, authored prose and the user's
 * own paste of a bug report are conversation, never machine evidence.
 */
describe('embedded-protocol classification is conservative', () => {
  it('keeps a fenced quotation of the protocol as authored prose', () => {
    const quoted = messagesFromPayload({
      sessionKey: SESSION,
      messages: [{ id: 'quoted', role: 'assistant', content: [{ type: 'text', text: QUOTED_PROTOCOL_ANSWER }], timestamp: 1 }],
    });
    expect(quoted.map((message) => message.role)).toEqual(['assistant']);
    expect(quoted[0]!.text).toBe(QUOTED_PROTOCOL_ANSWER);
  });

  it('keeps a pasted report of the leak as the prompt the user wrote', () => {
    const pasted = messagesFromPayload({
      sessionKey: SESSION,
      messages: [{ id: 'report', role: 'user', content: `look at this:\n${INTERLEAVED_PROTOCOL_TURN}`, timestamp: 1 }],
    });
    expect(pasted.map((message) => message.role)).toEqual(['user']);
    expect(pasted[0]!.text).toContain('functionresults');
  });

  it('leaves an answer that merely ends in an object literal alone', () => {
    const text = 'The resolved config is:\n{"level":"debug"}';
    const projected = messagesFromPayload({
      sessionKey: SESSION,
      messages: [{ id: 'plain', role: 'assistant', content: [{ type: 'text', text }], timestamp: 1 }],
    });
    expect(projected.map((message) => message.role)).toEqual(['assistant']);
    expect(projected[0]!.text).toBe(text);
  });
});

describe('embedded-protocol live projection', () => {
  it('publishes the live answer without any protocol framing', () => {
    const live = liveProtocolMessages().filter((message) => message.role === 'assistant');
    expect(live).toHaveLength(1);
    expect(live[0]!.text).toBe(PROTOCOL_ANSWER);
  });

  it('publishes nothing for a live frame that carries only protocol', () => {
    const projected = projectGatewayEvent({
      event: 'chat',
      payload: { sessionKey: SESSION, runId: 'run-1', state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: PROTOCOL_ONLY_TURN }] } },
    }, SESSION);
    expect(projected).toBeNull();
  });
});

describe('recovered tool identity is stable across refresh and relaunch', () => {
  const page = {
    sessionKey: SESSION,
    messages: [
      { id: 'prompt', role: 'user', content: 'Did the contributions trim land?', idempotencyKey: 'fixture-embedded-protocol-prompt-key', runId: 'fixture-embedded-protocol-run', timestamp: 1_788_411_120_000 },
      { id: 'turn', role: 'assistant', content: [{ type: 'text', text: INTERLEAVED_PROTOCOL_TURN }], timestamp: 1_788_411_180_000 },
    ],
  };

  it('projects the same rows and identities on every refresh', () => {
    const first = messagesFromPayload(page);
    const second = messagesFromPayload(page);
    expect(second.map((message) => message.id)).toEqual(['prompt', 'turn', 'turn#tool-1']);
    expect(rendered(second)).toEqual(rendered(first));
    expect(mergeLatestHistory(second, first, SESSION).map((message) => message.id)).toEqual(first.map((message) => message.id));
    expect(mergeOlderHistory(first, second, SESSION).map((message) => message.id)).toEqual(first.map((message) => message.id));
  });

  it('converges the live answer into its canonical row rather than duplicating it', () => {
    const merged = mergeLatestHistory(messagesFromPayload(page), liveProtocolMessages(), SESSION);
    expect(merged.filter((message) => message.role === 'assistant').map((message) => message.text)).toEqual([PROTOCOL_ANSWER]);
    expect(merged.filter((message) => message.role === 'tool')).toHaveLength(1);
  });
});
