import { describe, expect, it } from 'vitest';
import { embeddedToolProtocolFromText } from './embeddedToolProtocol';

const GLYPH_FRAMED_TURN = [
  'The watcher had no shell access. Picking it up directly.',
  '',
  '˚',
  '=',
  '±',
  '±',
  'Ë',
  '{"command":"~/scripts/runner.sh poll 20260102-090000-0001","description":"Poll contributions trim run"}',
  '±',
  '±',
  'Ë',
  '',
  'functionresults',
  '',
  ' ',
  '±',
  '±',
  'Ë',
  'ID: 20260102-090000-0001',
  'status: done',
  'exit: 0',
].join('\n');

/**
 * A producer that lost the structure of its own tool traffic leaves only the
 * protocol's shape behind. Every artifact class in the report — glyph-only
 * marker lines, the invocation object, the bare result marker and the raw
 * result body — has to leave the prose and land under one bounded headline.
 */
describe('tool protocol recovered from assistant text', () => {
  it('keeps the authored prose and moves every protocol artifact under a headline', () => {
    const recovered = embeddedToolProtocolFromText(GLYPH_FRAMED_TURN)!;
    expect(recovered.prose).toBe('The watcher had no shell access. Picking it up directly.');
    for (const artifact of ['˚', '=', '±', 'Ë', 'functionresults', '{"command"', 'ID: 2026', 'exit: 0']) {
      expect(recovered.prose, artifact).not.toContain(artifact);
    }
    expect(recovered.activities).toHaveLength(1);
    expect(recovered.activities[0]).toMatchObject({ kind: 'result', name: 'tool', status: 'ok', summary: 'tool · Poll contributions trim run' });
  });

  it('retains the invocation and the raw result body as expandable detail', () => {
    const [activity] = embeddedToolProtocolFromText(GLYPH_FRAMED_TURN)!.activities;
    expect(activity!.detail.split('\n')).toEqual([
      '{"command":"~/scripts/runner.sh poll 20260102-090000-0001","description":"Poll contributions trim run"}',
      'ID: 20260102-090000-0001',
      'status: done',
      'exit: 0',
    ]);
  });

  it('recovers a turn that is protocol and nothing else', () => {
    const recovered = embeddedToolProtocolFromText(['±', 'Ë', '{"command":"pwd","description":"Print directory"}', 'functionresults', '/tmp'].join('\n'))!;
    expect(recovered.prose).toBe('');
    expect(recovered.activities.map((activity) => activity.summary)).toEqual(['tool · Print directory']);
  });

  it('names an execution the XML dialect still identifies', () => {
    const recovered = embeddedToolProtocolFromText([
      'Checking the runner.',
      '<function_calls>',
      '<invoke name="Bash">',
      '{"command":"ls","description":"List files"}',
      '</invoke>',
      '</function_calls>',
      '<function_results>',
      'a.txt',
      '</function_results>',
    ].join('\n'))!;
    expect(recovered.prose).toBe('Checking the runner.');
    expect(recovered.activities).toHaveLength(1);
    expect(recovered.activities[0]).toMatchObject({ name: 'Bash', summary: 'Bash · List files', detail: '{"command":"ls","description":"List files"}\na.txt' });
  });

  it('publishes one activity per execution the region describes', () => {
    const recovered = embeddedToolProtocolFromText([
      '±',
      '{"command":"ls","description":"List files"}',
      'functionresults',
      'a.txt',
      '±',
      '{"command":"pwd","description":"Print directory"}',
      'functionresults',
      '/tmp',
    ].join('\n'))!;
    expect(recovered.activities.map((activity) => activity.summary)).toEqual(['tool · List files', 'tool · Print directory']);
    expect(recovered.activities.map((activity) => activity.detail.split('\n').at(-1))).toEqual(['a.txt', '/tmp']);
  });

  it('keeps an object the result body itself printed inside that result', () => {
    const recovered = embeddedToolProtocolFromText([
      '±',
      '{"command":"cat config.json","description":"Read config"}',
      'functionresults',
      'reading config',
      '{"level":"debug"}',
    ].join('\n'))!;
    expect(recovered.activities).toHaveLength(1);
    expect(recovered.activities[0]!.detail).toContain('reading config\n{"level":"debug"}');
  });

  it('reports an invocation with no result as still running', () => {
    const recovered = embeddedToolProtocolFromText(['±', 'Ë', '{"command":"sleep 60","description":"Wait for the run"}'].join('\n'))!;
    expect(recovered.activities[0]).toMatchObject({ kind: 'call', status: 'running', summary: 'tool · Wait for the run' });
  });

  it('strips a marker the producer emitted with no payload behind it', () => {
    const recovered = embeddedToolProtocolFromText('Answer text.\n\nfunctionresults')!;
    expect(recovered).toEqual({ prose: 'Answer text.', activities: [] });
  });
});

/**
 * Authored prose is never machine evidence. Anything short of the producer's
 * own framing leaves the message exactly as it arrived.
 */
describe('assistant text without an embedded protocol', () => {
  const untouched = [
    ['ordinary prose', 'The trim landed and the file is clean.'],
    ['an inline mention of the marker', 'The `functionresults` marker is the giveaway here.'],
    ['a symbol line with no protocol around it', 'Before.\n—\nAfter.'],
    ['an answer that ends in an object literal', 'The resolved config is:\n{"level":"debug"}'],
    ['a fenced quotation of the protocol', '```text\n±\nfunctionresults\n{"command":"echo quoted"}\n```'],
    ['a fenced block that never closes', 'Here is the trace:\n```text\n±\nfunctionresults\n{"command":"echo quoted"}'],
    ['a bulleted list', '- one\n- two\n- three'],
  ] as const;

  for (const [description, text] of untouched) {
    it(`leaves ${description} alone`, () => expect(embeddedToolProtocolFromText(text)).toBeNull());
  }
});
