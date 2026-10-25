// Separate Simulator entry. Real composer/import owner, no Gateway or sends.
import React, { useState } from 'react';
import { registerRootComponent } from 'expo';
import { Button, Text, View, useWindowDimensions } from 'react-native';
import { PromptPane } from '../../src/prompt/PromptPane';
import { usePromptAttachmentController } from '../../src/prompt/usePromptAttachmentController';
import { createPromptState } from '../../src/prompt/vimPromptCore';
import { colors, type } from '../../src/theme/tokens';
const noop = () => {};
function PromptDropProbe() {
  const { width } = useWindowDimensions();
  const [thread, setThread] = useState('a');
  const [status, setStatus] = useState('Drop files or images into the prompt.');
  const [state, setState] = useState(createPromptState('Keep this draft text unchanged.'));
  const media = usePromptAttachmentController(thread, setStatus);
  return <View style={{ flex: 1, paddingTop: 70, backgroundColor: colors.canvas }}>
    <Text style={{ color: colors.ink, fontFamily: type.mono }}>Prompt drop QA · thread {thread} · {width}pt</Text>
    <Button title="Switch thread" onPress={() => setThread(thread === 'a' ? 'b' : 'a')} />
    <Button title="Clear attachments" onPress={() => media.clear()} />
    <PromptPane sessionKey={thread} onDrop={(event) => { void media.importDrop(event); }} state={state} focusedPane="prompt" keyboardCapture={false}
      height={250} fontScale={1} sending={false} attachments={media.attachments} importing={media.importing} attachmentLimitReached={media.atLimit}
      compact={width < 700} softwareKeyboardRequested={false} softwareKeyboardForced={false} historyBrowser={{ open: false, entries: [], selectedIndex: -1 }}
      onState={setState} onFocusPrompt={noop} onRequestPromptFocus={noop} onHardwareKeyboardChange={noop} onHardwareKey={noop} onCommandHistory={noop}
      onPastedAttachment={media.stagePastedAttachment} onPastedCommandLineText={noop} onSubmit={() => setStatus('QA fixture never sends')}
      onAbort={noop} onPickDocument={() => { void media.pickDocument(); }} onPickImage={() => { void media.pickImage(); }}
      onPreviewAttachment={noop} onRemoveAttachment={media.remove} onOpenCommand={noop} onOpenNewThread={noop} onToggleHistory={noop} onCloseHistory={noop} onAcceptHistory={noop} />
    <Text style={{ color: colors.ink, fontFamily: type.mono }}>{status}</Text>
  </View>;
}
registerRootComponent(PromptDropProbe);
