// Standalone native presentation probe. No pairing, Gateway, or production data.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { View } from 'react-native';
import { TranscriptPane, type TranscriptPaneHandle } from '../../src/transcript/TranscriptPane';
import { projectTranscriptToolGroups } from '../../src/transcript/transcriptToolGroups';
import { createTranscriptBuffer, createTranscriptVimState, focusTranscriptMessage } from '../../src/transcript/transcriptVim';
import type { WorkspaceMessage } from '../../src/workspace/workspaceTypes';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
const tool = (id: string, name: string, text: string): WorkspaceMessage => ({ id, role: 'tool', text: `${name}\n${text}`, tool: { name, summary: `${name} · inspect project` } });
const initial: WorkspaceMessage[] = [
  { id: 'preamble-a', role: 'narration', text: 'I’ll inspect the project and run the checks.' },
  tool('a', 'read', 'Project instructions loaded.'), { ...tool('b', 'read', 'Project file loaded.'), runId: 'another-run', transcriptSessionId: 'another-generation' }, tool('c', 'read', 'Release notes loaded.'),
  { id: 'preamble-b', role: 'narration', text: 'The checks passed. Here are the remaining details.' },
  tool('d', 'exec', 'All tests passed.\nNo failures.'), tool('e', 'read', 'Ready to review.'),
  { id: 'command', role: 'command', text: '**Session status**\nConnected to your workspace.\n\n- Model: configured\n- State: ready' },
  { id: 'final', role: 'assistant', text: 'Tool batches have their own fold; individual details stay available inside.' },
];
function Probe() {
  const [raw, setRaw] = useState(initial);
  const messages = useMemo(() => projectTranscriptToolGroups(raw), [raw]);
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation] = useState(() => ({ ...createTranscriptVimState(buffer), cursor: { row: 0, column: 0 }, followTail: false }));
  const pane = useRef<TranscriptPaneHandle>(null);
  useEffect(() => {
    const timers = [
      setTimeout(() => { pane.current?.setFoldExpanded('tool-group:d', true); }, 1200),
      setTimeout(() => { pane.current?.setFoldExpanded('d', true); }, 2000),
      setTimeout(() => setRaw([...initial.slice(0, 4), tool('live-added', 'read', 'Another file loaded.'), ...initial.slice(4)]), 2600),
      setTimeout(() => { recordGatewayDiagnostic(`tool-groups.complete rows=${pane.current?.navigationSourceRows().length} outer=${pane.current?.foldAtSourceRow(1)?.expanded}`); }, 3500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#1d2021', paddingTop: 60, paddingBottom: 40 }}>
    <TranscriptPane ref={pane} datasetKey="tool-group-probe" messages={messages} buffer={buffer} navigation={navigation} focused fontScale={1}
      onFocus={() => {}} onSelect={(index, line) => setNavigation(current => focusTranscriptMessage(buffer, current, index, line))}
      onNavigationProjection={(_expected, next) => setNavigation(next)} onViewportReview={() => {}}
      onApprovalDecision={() => {}} onRecoverMessage={() => {}} onOpenMedia={() => {}}
      canLoadOlder={false} loadingOlder={false} onLoadOlder={() => {}} onRetryHistory={() => {}} />
  </View>;
}
registerRootComponent(Probe);
