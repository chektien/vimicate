import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGeneratedMediaDeliveries } from './generatedMediaPresentation';
import { generatedMediaPair as pair } from './generatedMediaFixture';
const runId = 'image_generate:00000000-0000-4000-9000-000000000144:ok:agent-loop';
describe('generated media delivery presentation', () => {
  it('presents the same-run Markdown pair and generated delivery as two images, not four', () => {
    const source = pair(); const snapshot = JSON.stringify(source);
    const result = projectGeneratedMediaDeliveries(source);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'answer', text: source[0]!.text });
    expect(result[0]!.attachments).toEqual(source[1]!.attachments!.map((a, i) => ({ ...a, filename: `Scene version ${i + 1}` })));
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(projectGeneratedMediaDeliveries(result)).toBe(result);
  });
  it('converges across delivery arrival, older-page insertion, refresh and cache restoration', () => {
    const source = pair();
    for (const partial of [[source[0]!], [source[1]!]]) expect(projectGeneratedMediaDeliveries(partial)).toBe(partial);
    for (const loaded of [source, [...source].reverse(), JSON.parse(JSON.stringify(source)) as WorkspaceMessage[]]) {
      const result = projectGeneratedMediaDeliveries(loaded);
      expect(result).toHaveLength(1); expect(result[0]!.attachments).toHaveLength(2);
      expect(result[0]!.id).toBe('answer');
    }
  });
  it('retains unmatched images in a partial delivery without losing its row identity', () => {
    const source = pair(); source[0]!.attachments = source[0]!.attachments!.slice(0, 1);
    const result = projectGeneratedMediaDeliveries(source);
    expect(result.map(m => m.id)).toEqual(['answer', 'delivery']);
    expect(result.map(m => m.attachments?.length)).toEqual([1, 1]);
    expect(result[1]!.attachments![0]).toEqual(source[1]!.attachments![1]);
  });
  it.each(['run', 'session', 'generation', 'prose', 'marker', 'artifact', 'name', 'path', 'ambiguous-answer', 'ambiguous-asset'])('does not guess a duplicate when %s evidence differs or is ambiguous', (kind) => {
    const source = pair(); const answer = source[0]!; const delivery = source[1]!;
    if (kind === 'run') answer.runId = 'other-run';
    if (kind === 'session') answer.sessionKey = 'other-session';
    if (kind === 'generation') answer.transcriptSessionId = 'other-generation';
    if (kind === 'prose') delivery.text = 'Here are additional images';
    if (kind === 'marker') delivery.idempotencyKey = runId;
    if (kind === 'artifact') delivery.attachments = delivery.attachments!.map(({ artifactId: _id, ...a }) => a);
    if (kind === 'name') delivery.attachments = delivery.attachments!.map(a => ({ ...a, filename: 'different.png' }));
    if (kind === 'path') answer.attachments = answer.attachments!.map(a => ({ ...a, uri: a.uri!.replace('tool-image-generation', 'other-images') }));
    if (kind === 'ambiguous-answer') source.push({ ...answer, id: 'another-answer' });
    if (kind === 'ambiguous-asset') delivery.attachments = delivery.attachments!.flatMap(a => [a, { ...a, id: a.id + '-other', artifactId: a.artifactId + '-other' }]);
    expect(projectGeneratedMediaDeliveries(source)).toBe(source);
  });
  it('does not suppress the same image in another genuine response', () => {
    const source = pair(); source.push({ ...source[0]!, id: 'later', runId: 'later-run' });
    const result = projectGeneratedMediaDeliveries(source);
    expect(result.map(m => m.id)).toEqual(['answer', 'later']);
    expect(result.flatMap(m => m.attachments ?? [])).toHaveLength(4);
  });
});
