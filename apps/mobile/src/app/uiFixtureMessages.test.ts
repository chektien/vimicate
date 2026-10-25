import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

import { FAILED_WAIT_SETTLEMENT_TICK, fixtureMessagesForMode, fixtureRunActiveForMode, fixtureTickingForMode } from './uiFixtureMessages';
import { ATTACHMENT_GEOMETRY_SECOND_TICK, attentionProjectRailFixture, promptAttachmentGeometryFixture } from './appShellFixtures';

describe('UI fixture startup boundary', () => {
  it('keeps image transfer-limit traffic in an explicit loopback-only fixture', () => {
    const messages = fixtureMessagesForMode('image-stream-limits', 0)!;
    expect(messages).toHaveLength(3);
    expect(messages.map(message => message.attachments?.[0]?.id)).toEqual(['declared', 'chunked', 'valid']);
    for (const message of messages) {
      expect(new URL(message.attachments![0]!.uri!).origin).toBe('http://127.0.0.1:18768');
      expect(message.attachments![0]!.headers).toBeUndefined();
    }
    expect(fixtureMessagesForMode(undefined, 0)).toBeUndefined();
  });
  it('keeps a delayed fragment pending while a separate true final is complete', () => {
    const messages = fixtureMessagesForMode('final-answer-authority', 0)!;
    expect(messages.filter(message => message.role === 'run')).toEqual([
      expect.objectContaining({ runId: 'delayed-run', state: 'streaming', text: '… run completed · final answer pending' }),
      expect.objectContaining({ runId: 'finished-run', state: 'complete', text: '✓ done in 8s' }),
    ]);
  });

  it('keeps all forty cumulative sections under the live identity after lagging history', () => {
    const messages = fixtureMessagesForMode('streaming-history-handoff', 0)!;
    expect(messages.map((message) => message.id)).toEqual(['handoff-prompt', 'live-chat-fixture-handoff-run']);
    expect(messages[1]).toMatchObject({ source: 'live', state: 'streaming' });
    expect(messages[1]?.text).toBe(`Review in progress.\n\nCumulative sections: ${Array.from({ length: 40 }, (_, index) => index + 1).join(' ')}`);
  });

  it('exposes the agent tool-activity transcript as its own reviewable fixture', () => {
    const messages = fixtureMessagesForMode('agent-tool-activity', 0)!;
    // Both preserved envelope shapes: live `agent` tool frames and one
    // canonical message interleaving prose with its tool calls.
    expect(messages.filter((message) => message.role === 'tool')).toHaveLength(9);
    expect(messages.every((message) => message.role !== 'tool' || !/[{}]/.test(message.text.split('\n')[0]!))).toBe(true);
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', text: 'The config is intact; the inspection flag was wrong, not the file.' });
  });

  it('renders one durable final after live replay, refresh, cache restoration and paging', () => {
    const messages = fixtureMessagesForMode('late-final-replay', 0)!;
    expect(messages.map((message) => message.id)).toEqual(['replay-prompt', 'replay-canonical-final']);
    expect(messages[1]).toMatchObject({ source: 'history', state: 'complete', runId: 'fixture-replay-run' });
    expect(messages[1]?.text).toContain('Built from the reviewed commit.');
  });

  it('renders one final when history arrives first, without a repairing refresh', () => {
    const messages = fixtureMessagesForMode('canonical-first-live', 0)!;
    expect(messages[0]?.text).toBe('History arrived first. Show its delayed live reply once.');
    expect(messages.map((message) => message.id)).toEqual(['replay-prompt', 'replay-canonical-final']);
    expect(messages[1]).toMatchObject({ source: 'history', state: 'complete',
      absorbedLiveIdentity: { messageId: 'live-chat-fixture-replay-run', runId: 'fixture-replay-run' } });
    expect(fixtureMessagesForMode(undefined, 0)).toBeUndefined();
  });

  it('reproduces the preserved current generation without borrowing an older crash prefix', () => {
    const running = fixtureMessagesForMode('flashlist-terminal-publication-stress', 89)!;
    const complete = fixtureMessagesForMode('flashlist-terminal-publication-stress', 90)!;
    const canonical = fixtureMessagesForMode('flashlist-terminal-publication-stress', 98)!;
    const lateFinal = fixtureMessagesForMode('flashlist-terminal-publication-stress', 106)!;
    expect(running).toHaveLength(27);
    expect(complete).toHaveLength(27);
    expect(canonical).toHaveLength(51);
    expect(running.filter((message) => message.role === 'tool' && message.state === 'streaming')).toHaveLength(3);
    expect(complete.filter((message) => message.role === 'tool' && message.state === 'streaming')).toHaveLength(0);
    expect(complete.filter((message) => message.role === 'assistant' && message.runId === 'terminal-stress-run')).toHaveLength(0);
    expect(complete.at(-1)).toMatchObject({ role: 'run', state: 'complete', runId: 'terminal-stress-run' });
    expect(canonical.filter((message) => message.role === 'tool')).toHaveLength(46);
    expect(canonical.filter((message) => message.role === 'tool' && message.source === 'live')).toHaveLength(0);
    expect(canonical.filter((message) => message.role === 'tool' && message.text.length === 9_766)).toHaveLength(1);
    expect(canonical.filter((message) => message.role === 'tool' && message.text.split('\n').length === 236)).toHaveLength(1);
    expect(canonical.at(-2)).toMatchObject({
      id: 'terminal-stress-history-final', source: 'history',
    });
    expect(canonical.at(-2)?.text).toHaveLength(553);
    expect(canonical.at(-2)?.text.split('\n')).toHaveLength(7);
    expect(canonical.at(-2)?.absorbedLiveIdentity).toBeUndefined();
    expect(canonical.at(-1)).toMatchObject({ role: 'run', source: 'live' });
    expect(lateFinal).toHaveLength(51);
    expect(lateFinal.at(-2)).toMatchObject({
      id: 'terminal-stress-history-final', source: 'history',
      absorbedLiveIdentity: { messageId: 'live-chat-terminal-stress-run', runId: 'terminal-stress-run' },
    });
    expect(lateFinal.filter((message) => message.role === 'assistant' && message.text === lateFinal.at(-2)?.text)).toHaveLength(1);
    expect(lateFinal.some((message) => message.id === 'live-chat-terminal-stress-run')).toBe(false);
  });

  it('keeps the older 82-row cache shape only as an explicit cross-incident pressure replay', () => {
    const running = fixtureMessagesForMode('flashlist-terminal-publication-pressure', 89)!;
    const canonical = fixtureMessagesForMode('flashlist-terminal-publication-pressure', 98)!;

    expect(running).toHaveLength(109);
    expect(canonical).toHaveLength(133);
    expect(running.slice(0, 82).filter((message) => message.role === 'tool')).toHaveLength(77);
    expect(canonical.filter((message) => message.role === 'tool')).toHaveLength(123);
  });

  it('reproduces a host-absolute transcript link that must route through a Files provider mapping', () => {
    const messages = fixtureMessagesForMode('remote-file-link', 0);
    expect(messages?.[0]?.text).toContain('[Example research manuscript](/Users/fixture/repos/example/papers/manuscript.pdf)');
  });

  it('reproduces five queued prompts while the first answer is still streaming', () => {
    const messages = fixtureMessagesForMode('queued-prompt-streaming-stress', 37)!;
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(5);
    expect(messages.find((message) => message.id === 'queued-running-answer')).toMatchObject({ state: 'streaming', runId: 'queued-run' });
    expect(messages.find((message) => message.id === 'queued-running-answer')?.text).toContain('Queued stream line 37');
  });

  it('keeps one accepted prompt through a full live window and canonical convergence', () => {
    const fullLiveWindow = fixtureMessagesForMode('accepted-prompt-window-stress', 480)!;
    expect(fullLiveWindow).toHaveLength(480);
    expect(fullLiveWindow[0]).toMatchObject({
      id: 'accepted-window-prompt', role: 'user', source: 'local',
    });
    expect(fullLiveWindow[1]?.id).toBe('accepted-window-tool-1');
    expect(fullLiveWindow.at(-1)?.id).toBe('accepted-window-tool-479');

    const canonical = fixtureMessagesForMode('accepted-prompt-window-stress', 500)!;
    expect(canonical).toHaveLength(480);
    expect(canonical[0]).toMatchObject({
      id: 'accepted-window-prompt', role: 'user', source: 'history',
    });
    expect(canonical[1]?.id).toBe('accepted-window-tool-3');
    expect(canonical.at(-2)).toMatchObject({
      id: 'accepted-window-final', role: 'assistant', source: 'history',
    });
    expect(canonical.at(-1)).toMatchObject({
      role: 'run', state: 'complete', runId: 'fixture-accepted-prompt-window-run',
    });
    expect(canonical.filter((message) => message.id === 'accepted-window-prompt')).toHaveLength(1);
  });

  it('reproduces the physical FlashList tail shape without a real Gateway publication', () => {
    const messages = fixtureMessagesForMode('flashlist-live-publication-stress', 37)!;
    expect(messages).toHaveLength(449);
    expect(messages.slice(0, 412).every((message) => message.source === 'history')).toBe(true);
    expect(messages.slice(412).every((message) => message.source === 'live')).toBe(true);
    expect(messages.at(-1)).toMatchObject({ id: 'live-36', state: 'streaming', runId: 'active-live-run' });

    const following = fixtureMessagesForMode('flashlist-live-publication-stress', 38)!;
    expect(following[0]).toBe(messages[0]);
    expect(following[411]).toBe(messages[411]);
    expect(following[412]).toBe(messages[412]);
    expect(following[448]).not.toBe(messages[448]);
    const settled = fixtureMessagesForMode('flashlist-live-publication-stress', 39)!;
    expect(settled[412]).toBe(following[412]);
  });

  it('holds 480 ordered identities while one live row keeps revising at 16 ms cadence', () => {
    const full = fixtureMessagesForMode('flashlist-live-publication-stress', 68)!;
    const revised = fixtureMessagesForMode('flashlist-live-publication-stress', 69)!;

    expect(full).toHaveLength(480);
    expect(revised).toHaveLength(480);
    expect(revised.map((message) => message.id)).toEqual(full.map((message) => message.id));
    expect(revised[479]).not.toBe(full[479]);
    expect(revised[479]?.text).not.toBe(full[479]?.text);
    const later = fixtureMessagesForMode('flashlist-live-publication-stress', 78)!;
    expect(later[479]?.text).not.toBe(full[479]?.text);
    expect(later[479]?.text.length).toBe(full[479]?.text.length);
  });

  it('does not construct stress payloads for an ordinary Release launch', () => {
    const factories = {
      longFoldedTool: vi.fn(() => { throw new Error('must stay lazy'); }),
      longFoldedConversation: vi.fn(() => { throw new Error('must stay lazy'); }),
    };

    expect(fixtureMessagesForMode(undefined, 0, factories)).toBeUndefined();
    expect(fixtureMessagesForMode('unknown', 0, factories)).toBeUndefined();
    expect(factories.longFoldedTool).not.toHaveBeenCalled();
    expect(factories.longFoldedConversation).not.toHaveBeenCalled();
  });

  it('constructs only the explicitly selected heavy fixture', () => {
    const tool = { id: 'tool', role: 'tool' as const, text: 'tool' };
    const conversation = { id: 'conversation', role: 'assistant' as const, text: 'conversation' };
    const factories = {
      longFoldedTool: vi.fn(() => tool),
      longFoldedConversation: vi.fn(() => conversation),
    };

    expect(fixtureMessagesForMode('send-latency', 0, factories)?.[0]).toBe(tool);
    expect(factories.longFoldedTool).toHaveBeenCalledOnce();
    expect(factories.longFoldedConversation).not.toHaveBeenCalled();

    factories.longFoldedTool.mockClear();
    expect(fixtureMessagesForMode('fold-navigation', 0, factories)?.[1]).toBe(conversation);
    expect(factories.longFoldedTool).not.toHaveBeenCalled();
    expect(factories.longFoldedConversation).toHaveBeenCalledOnce();
  });

  it('combines one stable 20K folded tool with an active cumulative publication for physical pressure', () => {
    const first = fixtureMessagesForMode('physical-transcript-pressure', 37)!;
    const next = fixtureMessagesForMode('physical-transcript-pressure', 38)!;

    expect(first[0]).toBe(next[0]);
    expect(first[0]).toMatchObject({ id: 'fixture-long-tool', role: 'tool', state: 'complete' });
    expect(first[0]?.text.split('\n')).toHaveLength(20_000);
    expect(first.find((message) => message.id === 'fixture-answer')).toMatchObject({ state: 'streaming' });
    expect(first.find((message) => message.id === 'fixture-answer')?.text).toContain('Streaming response line 37');
    expect(first.find((message) => message.id === 'fixture-answer')?.text.split('\n')[0]).toBe('## Transcript structure · update 37');
    expect(next.find((message) => message.id === 'fixture-answer')?.text.split('\n')[0]).toBe('## Transcript structure · update 38');
    expect(next.find((message) => message.id === 'fixture-answer')?.text).toContain('Streaming response line 38');
  });

  it('publishes delayed image geometry inside the physical transcript pressure fixture', () => {
    const unresolved = fixtureMessagesForMode('physical-transcript-pressure', 239)!;
    const measured = fixtureMessagesForMode('physical-transcript-pressure', 240)!;
    const unresolvedImage = unresolved.find((message) => message.id === 'fixture-media')?.attachments?.[0];
    const measuredImage = measured.find((message) => message.id === 'fixture-media')?.attachments?.[0];

    expect(unresolvedImage).toMatchObject({ id: 'fixture-pixel', byteCount: 68 });
    expect(unresolvedImage).not.toHaveProperty('pixelWidth');
    expect(unresolvedImage).not.toHaveProperty('pixelHeight');
    expect(measuredImage).toMatchObject({
      id: 'fixture-pixel',
      byteCount: 68,
      pixelWidth: 2048,
      pixelHeight: 1536,
    });
    expect(unresolved[0]).toBe(measured[0]);
    expect(unresolved[1]?.id).toBe('fixture-media');
    expect(measured[1]?.id).toBe('fixture-media');
  });

  it('keeps the physical transcript pressure fixture active for long-draft editing', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

    expect(app).toContain("fixtureMode === 'physical-transcript-pressure'\n      || fixtureMode === 'flashlist-live-publication-stress'");
    expect(app).toContain(': extendedPhysicalStress ? 2_400 : stress ? 600 : 120');
  });

  it('reuses the rich transcript only for explicit presentation fixtures', () => {
    expect(fixtureMessagesForMode('interaction-polish', 0)).toBe(fixtureMessagesForMode('rich-transcript', 0));
    expect(fixtureMessagesForMode('attention-unread', 0)).toBe(fixtureMessagesForMode('rich-transcript', 0));
    expect(attentionProjectRailFixture.projects.find((project) => project.sessionKey === 'fixture-emails')).toMatchObject({
      name: 'emails', unread: true, state: 'idle',
    });
    expect(attentionProjectRailFixture.projects.find((project) => project.sessionKey === attentionProjectRailFixture.selectedKey)?.unread).not.toBe(true);
  });

  it('keeps exact image geometry in the rich fixture so Release verifies useful metadata without filenames', () => {
    const media = fixtureMessagesForMode('rich-transcript', 0)?.find((message) => message.id === 'fixture-media');

    expect(media?.attachments).toEqual([
      expect.objectContaining({
        filename: 'fixture.png',
        mimeType: 'image/png',
        pixelWidth: 1,
        pixelHeight: 1,
        byteCount: 68,
      }),
    ]);
  });

  it('includes actual starless child cards with short and long parent labels in the rail fixture', () => {
    const children = attentionProjectRailFixture.projects.filter((project) => project.kind === 'thread');
    expect(children.map((project) => project.projectName)).toEqual(['notes', 'Example Research']);
    expect(children.every((project) => project.unread && project.updatedAt)).toBe(true);
    for (const child of children) {
      expect(attentionProjectRailFixture.projects.some((project) => project.sessionKey === child.rootSessionKey)).toBe(true);
    }
  });

  it('renders a corrected live identity at its authoritative source coordinate', () => {
    expect(fixtureMessagesForMode('authoritative-live-reposition-chronology', 0)?.map((message) => message.id)).toEqual([
      'first-prompt', 'preamble', 'second-prompt',
    ]);
  });

  it('renders a definitive failed wait as one visible run-owned terminal row', () => {
    const messages = fixtureMessagesForMode('failed-run-settlement', 0)!;
    expect(messages.map((message) => message.id)).toEqual([
      'failed-wait-prompt',
      'failed-wait-narration',
      'failed-wait-tool',
      'live-run-failed-wait-run',
    ]);
    expect(messages[2]).toMatchObject({ role: 'tool', state: 'error', sessionKey: 'fixture-failed-wait', runId: 'failed-wait-run' });
    expect(messages[3]).toMatchObject({
      role: 'error',
      state: 'error',
      sessionKey: 'fixture-failed-wait',
      runId: 'failed-wait-run',
      text: '● failed after 7s · failed: authoritative verification failed',
    });
  });

  it('publishes a seven-second active-to-definitive-failure transition for physical QA', () => {
    const active = fixtureMessagesForMode('failed-run-settlement-transition', FAILED_WAIT_SETTLEMENT_TICK - 1)!;
    const failed = fixtureMessagesForMode('failed-run-settlement-transition', FAILED_WAIT_SETTLEMENT_TICK)!;
    expect(fixtureRunActiveForMode('failed-run-settlement-transition', FAILED_WAIT_SETTLEMENT_TICK - 1)).toBe(true);
    expect(fixtureRunActiveForMode('failed-run-settlement-transition', FAILED_WAIT_SETTLEMENT_TICK)).toBe(false);
    expect(active.map(message => [message.id, message.state])).toEqual([
      ['failed-wait-prompt', 'complete'],
      ['failed-wait-narration', 'streaming'],
      ['failed-wait-tool', 'streaming'],
      ['live-run-failed-wait-run', 'streaming'],
    ]);
    expect(failed.map(message => [message.id, message.state])).toEqual([
      ['failed-wait-prompt', 'complete'],
      ['failed-wait-narration', 'streaming'],
      ['failed-wait-tool', 'error'],
      ['live-run-failed-wait-run', 'error'],
    ]);
  });

  it('adds a second staged attachment without impersonating an active run', () => {
    const one = promptAttachmentGeometryFixture(
      'prompt-attachment-geometry-transition',
      ATTACHMENT_GEOMETRY_SECOND_TICK - 1,
    )!;
    const two = promptAttachmentGeometryFixture(
      'prompt-attachment-geometry-transition',
      ATTACHMENT_GEOMETRY_SECOND_TICK,
    )!;

    expect(one.map((attachment) => attachment.filename)).toEqual(['staged-design-reference.png']);
    expect(two.map((attachment) => attachment.filename)).toEqual([
      'staged-design-reference.png',
      'staged-review-notes.png',
    ]);
    expect(two[0]).toBe(one[0]);
    expect(fixtureTickingForMode('prompt-attachment-geometry-transition')).toBe(true);
    expect(fixtureRunActiveForMode('prompt-attachment-geometry-transition', 0)).toBe(false);
    expect(fixtureMessagesForMode('prompt-attachment-geometry-transition', 0)).toBe(
      fixtureMessagesForMode('rich-transcript', 0),
    );
    expect(promptAttachmentGeometryFixture(undefined, 0)).toBeUndefined();
  });

  it('keeps App.tsx free of eager transcript stress allocation', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).not.toContain('Array.from({ length: 20_000 }');
    expect(app).not.toContain('Array.from({ length: 619 }');
    expect(app).toContain('fixtureMessagesForMode(fixtureMode, streamTick)');
    expect(app).toContain(': extendedPhysicalStress ? 2_400 : stress ? 600 : 120');
    expect(app).toContain("fixtureMode === 'status-quota' ? statusQuotaFixture : undefined");
    expect(app).toContain("fixtureMode === 'project-rail-loading' ? { paired: true, registryReady: false } : undefined");
    expect(app).toContain("fixtureMode === 'attention-unread' ? attentionProjectRailFixture : undefined");
  });

  it('renders a delayed preamble immediately below its owning canonical prompt', () => {
    expect(fixtureMessagesForMode('chronology-merge', 0)?.map((message) => message.id)).toEqual([
      'old', 'prompt', 'late-preamble', 'answer', 'newer-prompt', 'newer-answer', 'boundary',
    ]);
  });

  it('renders multi-steer publication order without regrouping one shared run', () => {
    expect(fixtureMessagesForMode('steering-chronology', 0)?.map((message) => message.id)).toEqual([
      'old', 'history-first', 'first-preamble', 'first-tool', 'history-second', 'history-third', 'second-preamble',
    ]);
  });

  it('renders repeated equal steering prompts through iterative partial refreshes without loss or reversal', () => {
    expect(fixtureMessagesForMode('repeated-steering-chronology', 0)?.map((message) => message.id)).toEqual([
      'old',
      'history-first', 'first-preamble',
      'history-second', 'second-tool',
      'history-third', 'third-preamble',
    ]);
  });

  it('renders delayed Gateway history records by embedded chronology rather than append order', () => {
    expect(fixtureMessagesForMode('gateway-history-chronology', 0)?.map((message) => message.id)).toEqual([
      'prompt-1', 'prompt-2', 'preamble-1', 'tool-1', 'prompt-3', 'preamble-2',
    ]);
  });

  it('renders delayed Gateway records chronologically after they cross an offset-page boundary', () => {
    expect(fixtureMessagesForMode('gateway-paged-history-chronology', 0)?.map((message) => message.id)).toEqual([
      'prompt-1', 'prompt-2', 'preamble-1', 'tool-1', 'prompt-3', 'preamble-2', 'prompt-4',
    ]);
  });

  it('keeps the archived Morning Brief before the replacement generation standup response', () => {
    expect(fixtureMessagesForMode('session-generation-chronology', 0)?.map((message) => message.id)).toEqual([
      'morning-brief', 'updated-standup',
    ]);
  });

  it('keeps a prior unmatched live answer above the latest canonical turn', () => {
    expect(fixtureMessagesForMode('unmatched-live-chronology', 0)?.map((message) => message.id)).toEqual([
      'first-prompt', 'older-live-answer', 'first-canonical-answer', 'latest-prompt', 'latest-answer',
    ]);
  });

  it('removes an untimestamped restored live answer whose lost run ownership put it below newer canonical turns', () => {
    expect(fixtureMessagesForMode('restored-orphan-live-chronology', 0)?.map((message) => message.id)).toEqual([
      'old-prompt', 'old-answer', 'latest-prompt', 'latest-answer',
    ]);
  });
});
