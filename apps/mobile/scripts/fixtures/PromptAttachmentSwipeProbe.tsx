// Simulator-only: real composer, synthetic media, no Gateway or production entry.
import React, { useState } from 'react';
import { Alert, Button, Text, View, useWindowDimensions } from 'react-native';
import { PromptPane } from '../../src/prompt/PromptPane';
import { createPromptState } from '../../src/prompt/vimPromptCore';
import type { PromptAttachment } from '../../src/prompt/promptAttachments';
const noop = () => {};
const fixtures: PromptAttachment[] = Array.from({ length: 10 }, (_, i) => ({
  id: `image-${i + 1}`, filename: `reference-${i + 1}.png`, kind: 'image', byteCount: 68, mimeType: 'image/png',
  uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
}));
export default function PromptAttachmentSwipeProbe() {
  const { width } = useWindowDimensions();
  const [attachments, setAttachments] = useState(fixtures);
  const [state, setState] = useState(createPromptState('Draft stays intact while swiping attachments.'));
  const [preview, setPreview] = useState('none');
  return <View style={{ flex: 1, paddingTop: 70, backgroundColor: '#252624' }}>
    <Text style={{ color: 'white' }}>Attachment swipe QA · {width}pt · preview {preview}</Text>
    <Button title="Reset ten attachments" onPress={() => setAttachments(fixtures)} />
    <Button title="One attachment" onPress={() => setAttachments(fixtures.slice(0, 1))} />
    <PromptPane state={state} focusedPane="prompt" keyboardCapture={false} height={240} fontScale={1} sending importing={false}
      attachments={attachments} attachmentLimitReached={attachments.length === 10} compact={width < 700}
      softwareKeyboardRequested={false} softwareKeyboardForced={false} historyBrowser={{ open: false, entries: [], selectedIndex: -1 }}
      onState={setState} onFocusPrompt={noop} onRequestPromptFocus={noop} onHardwareKeyboardChange={noop} onHardwareKey={noop}
      onCommandHistory={noop} onPastedAttachment={noop} onPastedCommandLineText={noop} onSubmit={() => Alert.alert('Send visible')} onAbort={noop}
      onPickDocument={noop} onPickImage={noop} onOpenCommand={noop} onOpenNewThread={noop} onToggleHistory={noop} onCloseHistory={noop} onAcceptHistory={noop}
      onPreviewAttachment={setPreview} onRemoveAttachment={id => setAttachments(items => items.filter(item => item.id !== id))} />
  </View>;
}
