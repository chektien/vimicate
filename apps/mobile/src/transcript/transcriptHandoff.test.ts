import { describe, expect, it } from 'vitest';
import { composeTranscriptHandoff } from './transcriptHandoff';

const message = { id: 'm', role: 'assistant' as const, text: '  first\nsecond line\nthird' };

describe('transcript response edit handoff', () => {
  it('maps i/a/I/A to the exact source character without losing the response', () => {
    const i = composeTranscriptHandoff(message, 1, 3, 'i');
    expect(i.text.slice(i.caretOffset, i.caretOffset + 4)).toBe('ond ');
    const a = composeTranscriptHandoff(message, 1, 3, 'a');
    expect(a.text.slice(a.caretOffset, a.caretOffset + 3)).toBe('nd ');
    const upperI = composeTranscriptHandoff(message, 0, 4, 'I');
    expect(upperI.text.slice(upperI.caretOffset, upperI.caretOffset + 5)).toBe('first');
    const upperA = composeTranscriptHandoff(message, 1, 2, 'A');
    expect(upperA.text.slice(upperA.caretOffset, upperA.caretOffset + 6)).toBe('\nthird');
  });

  it('creates editable blank lines above and below for O/o', () => {
    const below = composeTranscriptHandoff(message, 1, 0, 'o');
    expect(below.text.slice(below.caretOffset - 1, below.caretOffset + 2)).toBe('\n\nt');
    const above = composeTranscriptHandoff(message, 1, 0, 'O');
    expect(above.text.slice(above.caretOffset, above.caretOffset + 2)).toBe('\ns');
  });

  // Physical example-review review (6 Oct): i inside a ```text block of
  // proposed feedback should hand over that feedback, not the whole review.
  const review = { id: 'r', role: 'assistant' as const, text: [
    'Example Review', 'Proposed feedback', '```text', 'Your attention to testing suggests a careful approach.', '```',
    '', 'Example Notes', '> Quoted line one', '> Quoted line two', 'He wrote "nearly done" in the log.',
  ].join('\n') };

  it('hands over only the fenced block when the cursor is inside it', () => {
    const inside = composeTranscriptHandoff(review, 3, 5, 'i');
    expect(inside.shape).toBe('quoted');
    expect(inside.text).toBe('Below is an excerpt from your response with my edits applied. Apply this change.\n\nYour attention to testing suggests a careful approach.');
    expect(inside.text.slice(inside.caretOffset, inside.caretOffset + 9)).toBe('attention');
    const onFence = composeTranscriptHandoff(review, 2, 0, 'i');
    expect(onFence.text.endsWith('\n\nYour attention to testing suggests a careful approach.')).toBe(true);
    const below = composeTranscriptHandoff(review, 3, 0, 'o');
    expect(below.text.endsWith('careful approach.\n')).toBe(true);
    expect(below.caretOffset).toBe(below.text.length);
  });

  it('hands over a blockquote run without its markers, and an inline quoted span', () => {
    const block = composeTranscriptHandoff(review, 8, 4, 'i');
    expect(block.shape).toBe('quoted');
    expect(block.text.endsWith('\n\nQuoted line one\nQuoted line two')).toBe(true);
    expect(block.text.slice(block.caretOffset, block.caretOffset + 4)).toBe('oted');
    const span = composeTranscriptHandoff(review, 9, 12, 'i');
    expect(span.text.endsWith('\n\nnearly done')).toBe(true);
    expect(span.text.slice(span.caretOffset, span.caretOffset + 4)).toBe('arly');
  });

  it('keeps the whole-response code handoff when the response is one fenced block', () => {
    const code = composeTranscriptHandoff({ id: 'c', role: 'assistant', text: '```text\nOnly code.\n```' }, 1, 0, 'i');
    expect(code.shape).toBe('code');
    expect(code.text).toContain('```text');
  });

  it('keeps handing over the whole response outside any quote', () => {
    const heading = composeTranscriptHandoff(review, 0, 0, 'i');
    expect(heading.shape).not.toBe('quoted');
    expect(heading.text).toContain('Proposed feedback');
    expect(heading.text).toContain('Example Notes');
    const outsideSpan = composeTranscriptHandoff(review, 9, 0, 'i');
    expect(outsideSpan.shape).not.toBe('quoted');
  });

  it('treats an unclosed fence in a streaming answer as code to the end, not as quotes', () => {
    const streaming = { id: 's', role: 'assistant' as const, text: 'Here is the change:\n```ts\nconst label = "draft";\n> not a quote\nreturn label;' };
    const code = 'const label = "draft";\n> not a quote\nreturn label;';
    for (const [line, column] of [[2, 15], [3, 2], [4, 0]] as const) {
      const handoff = composeTranscriptHandoff(streaming, line, column, 'i');
      expect(handoff.shape).toBe('quoted');
      expect(handoff.text.endsWith(`\n\n${code}`)).toBe(true);
    }
    const literal = composeTranscriptHandoff(streaming, 2, 15, 'i');
    expect(literal.text.slice(literal.caretOffset, literal.caretOffset + 5)).toBe('draft');
  });

  it('pairs fences by character and length, so an inner example stays inside the outer block', () => {
    const nested = { id: 'n', role: 'assistant' as const, text: 'Intro\n````md\n```js\nx()\n```\nafter inner\n````\nOutro' };
    const handoff = composeTranscriptHandoff(nested, 5, 0, 'i');
    expect(handoff.text.endsWith('\n\n```js\nx()\n```\nafter inner')).toBe(true);
    const tagged = { id: 't', role: 'assistant' as const, text: 'Intro\n```\none\n```js\ntwo\n```\nOutro' };
    expect(composeTranscriptHandoff(tagged, 4, 0, 'i').text.endsWith('\n\none\n```js\ntwo')).toBe(true);
  });
});

