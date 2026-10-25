export type TranscriptKind = 'user' | 'assistant' | 'tool' | 'code' | 'media';
export type TranscriptItem = { id: string; ordinal: number; kind: TranscriptKind; title: string; body: string; meta: string };

const bodies: Record<TranscriptKind, string[]> = {
  user: ['Please inspect the viewport authority before changing another scroll writer.', 'Keep the draft intact while this run continues in the background.'],
  assistant: ['The session remained connected. I separated durable history from live presentation and rejected the stale frame.', 'I found three downstream consumers; the narrowest boundary is the semantic anchor reducer.'],
  tool: ['tool › exec_command\nstatus: complete · 128 ms\noutput: 14 rows accepted', 'tool › read_file\nstatus: streaming · 42 KB received'],
  code: ['const target = index.byMessageId.get(messageId);\nif (target) viewport.reveal(target);', 'type Authority = { generation: number; source: "history" | "live" };'],
  media: ['[image attachment stub]\n1920 × 1080 · persisted reference · 2.4 MB', '[approval request]\nexec command awaits operator decision'],
};
const kinds: TranscriptKind[] = ['user', 'assistant', 'assistant', 'tool', 'code', 'assistant', 'media'];

export function generateTranscript(count: number, seed = 1, startOrdinal = 0): TranscriptItem[] {
  return Array.from({ length: count }, (_, offset) => {
    const ordinal = startOrdinal + offset;
    const kind = kinds[(ordinal * 13 + seed) % kinds.length] ?? 'assistant';
    const variants = bodies[kind];
    const body = variants[(ordinal + seed) % variants.length] ?? '';
    return { id: `${seed}-${ordinal}`, ordinal, kind, title: kind === 'assistant' ? 'agent.main' : kind, body, meta: `#${String(ordinal).padStart(5, '0')} · ${kind === 'assistant' ? 'live/durable' : 'fixture'}` };
  });
}

export function findTranscriptMatches(items: TranscriptItem[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return items.flatMap((item, index) => `${item.title}\n${item.body}`.toLowerCase().includes(needle) ? [index] : []);
}
