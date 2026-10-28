// Isolated native visual fixture. Never imported by the production entry point.
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { TranscriptSourceRow } from '../../src/transcript/TranscriptSourceRow';
import { buildVisibleTranscriptRenderRows } from '../../src/transcript/transcriptVisibleRows';
import { projectTranscriptToolGroups } from '../../src/transcript/transcriptToolGroups';
import { createTranscriptBuffer, createTranscriptVimState } from '../../src/transcript/transcriptVim';
import { messagesFromPayload } from '../../src/workspace/historyMessageProjection';
import { colors, space, type } from '../../src/theme/tokens';
const noop = () => undefined;
const messages = projectTranscriptToolGroups(messagesFromPayload({ messages: [
  { role: 'assistant', content: 'I’m reading the sample document and its review notes.' },
  ...['example-document-review', 'plugin:example-layout'].map((name, index) => ({ role: 'assistant', content: [
    { type: 'toolCall', id: `read-${index}`, name: 'Skill', arguments: { skill: name } },
    { type: 'toolResult', toolCallId: `read-${index}`, content: 'Read complete.' },
  ] })),
  { role: 'assistant', content: 'I’ll summarize the sample review notes separately from the document.' },
] }));
const nav = { ...createTranscriptVimState(createTranscriptBuffer(messages)), cursor: { row: 1, column: 0 } };
function Sample({ scale, expanded = false }: { scale: number; expanded?: boolean }) {
  const [open, setOpen] = useState(new Set(expanded ? messages.filter(row => row.toolGroup).map(row => row.id) : []));
  const rows = buildVisibleTranscriptRenderRows(messages, open);
  return <View style={{ marginBottom: space.xl }}>
    <Text style={{ color: colors.inkBright, fontFamily: type.mono, fontSize: type.sizeMd, marginBottom: space.sm }}>{expanded ? 'Expanded activity' : `Collapsed activity · ${scale}×`}</Text>
    {rows.map((row, index) => <TranscriptSourceRow key={row.key} row={row} navigation={nav} focused={scale === 1 && !expanded} fontScale={scale} gutterWidth={20 * scale} sourceNavigationIndex={index} cursorNavigationIndex={0}
      onPress={noop} onToggleFold={() => setOpen(prior => { const next = new Set(prior); next.has(row.message.id) ? next.delete(row.message.id) : next.add(row.message.id); return next; })}
      onApprovalDecision={noop} onOpenMedia={noop} onRecoverMessage={noop} />)}
  </View>;
}
export default function SkillActivityReview() {
  return <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: 68, paddingBottom: space.xl }}>
    <Sample scale={1} /><Sample scale={1.6} /><Sample scale={1} expanded />
  </ScrollView>;
}
