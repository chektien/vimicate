import { describe, expect, it } from 'vitest';
import { appendPromptAttachments, MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES, normalizedPromptAttachment, SessionPromptAttachmentDrafts } from './promptAttachments';

describe('prompt attachment owner', () => {
  it('normalizes supported files and infers image behavior', () => {
    expect(normalizedPromptAttachment({ uri: 'file:///shot.png', filename: 'shot.png', byteCount: 1200 })).toMatchObject({ mimeType: 'image/png', kind: 'image', byteCount: 1200 });
  });
  it('rejects oversize files before reading or sending bytes', () => {
    expect(() => normalizedPromptAttachment({ uri: 'file:///large.pdf', filename: 'large.pdf', byteCount: MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES + 1 })).toThrow('18 MB total');
  });
  it('accepts ten attachments and rejects the eleventh', () => {
    const make = (index: number) => normalizedPromptAttachment({ uri: `file:///${index}.txt`, filename: `${index}.txt`, byteCount: 1 });
    const ten = appendPromptAttachments([], Array.from({ length: 10 }, (_, i) => make(i)));
    expect(ten).toHaveLength(10);
    expect(() => appendPromptAttachments(ten, [make(11)])).toThrow('10');
  });
  it('lets one file use the whole budget but rejects the combined overflow atomically', () => {
    const make = (id: string, mb: number) => normalizedPromptAttachment({ uri: `file:///${id}.pdf`, filename: `${id}.pdf`, byteCount: mb * 1024 * 1024 });
    expect(appendPromptAttachments([], [make('all', 18)])).toHaveLength(1);
    const drafts = new SessionPromptAttachmentDrafts();
    drafts.append('a', [make('large', 15)]);
    expect(() => drafts.append('a', [make('extra', 4)])).toThrow('18 MB total');
    expect(drafts.restore('a')).toHaveLength(1);
    expect(drafts.append('a', [make('fits', 3)])).toHaveLength(2);
  });
  it('keeps pasted/picked media owned by its destination session across switches', () => {
    const drafts = new SessionPromptAttachmentDrafts();
    const shot = normalizedPromptAttachment({ id: 'shot', uri: 'file:///shot.png', filename: 'shot.png', byteCount: 1200 });
    drafts.append('a', [shot]);
    expect(drafts.hasPendingDrafts()).toBe(true);
    expect(drafts.restore('b')).toEqual([]);
    expect(drafts.restore('a')).toEqual([shot]);
    drafts.clear('a');
    expect(drafts.hasPendingDrafts()).toBe(false);
    expect(drafts.restore('a')).toEqual([]);
  });
  it('bounds retained attachment drafts across a long-lived session catalog', () => {
    const drafts = new SessionPromptAttachmentDrafts();
    const make = (index: number) => normalizedPromptAttachment({ id: `shot-${index}`, uri: `file:///shot-${index}.png`, filename: `shot-${index}.png`, byteCount: 1200 });
    for (let index = 0; index <= 64; index += 1) drafts.append(`session-${index}`, [make(index)]);

    expect(drafts.restore('session-0')).toEqual([]);
    expect(drafts.restore('session-1')).toHaveLength(1);
    expect(drafts.restore('session-64')).toHaveLength(1);

    for (let index = 0; index < 64; index += 1) drafts.clear(`empty-${index}`);
    expect(drafts.restore('session-1')).toHaveLength(1);
  });
  it('owns one picker by exact ticket and keeps empty render snapshots stable', () => {
    const drafts = new SessionPromptAttachmentDrafts();
    expect(drafts.restore('a')).toBe(drafts.restore('a'));
    const first = drafts.beginImport('a')!;
    expect(drafts.beginImport('a')).toBeUndefined();
    expect(drafts.beginImport('b')).toBeUndefined();
    expect(drafts.isImporting('b')).toBe(false);
    expect(drafts.isImporting('a')).toBe(true);
    drafts.cancelImport();
    const successor = drafts.beginImport('b')!;
    expect(drafts.finishImport(first)).toBe(false);
    expect(drafts.isImporting('b')).toBe(true);
    expect(drafts.finishImport(successor)).toBe(true);
    expect(drafts.isImporting('b')).toBe(false);
    expect(drafts.beginImport('')).toBeUndefined();
  });
});


it('releases evicted, replaced and disposed attachment resources without touching retained files', () => {
  const released: string[] = [];
  const drafts = new SessionPromptAttachmentDrafts((items) => released.push(...items.map((item) => item.uri)));
  const file = (id: string) => normalizedPromptAttachment({ id, uri: `file:///${id}.txt`, filename: `${id}.txt`, byteCount: 1 });
  for (let i = 0; i < 65; i++) drafts.append(`s${i}`, [file(String(i))]);
  expect(released).toEqual(['file:///0.txt']);
  expect(drafts.restore('s0')).toEqual([]);
  drafts.replace('s1', [file('replacement')]);
  expect(released).toEqual(['file:///0.txt', 'file:///1.txt']);
  drafts.append('s2', [file('extra')]);
  expect(released).toHaveLength(2);
  drafts.dispose();
  expect(released).toHaveLength(67);
  expect(new Set(released).size).toBe(67);
  expect(drafts.hasPendingDrafts()).toBe(false);
});
