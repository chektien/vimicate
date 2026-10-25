import type { StyleProp, ViewStyle } from 'react-native';

export type EditorTextEvent = { text: string; selectionStart: number; selectionEnd: number; textAuthority: number };
export type EditorSelectionEvent = { selectionStart: number; selectionEnd: number; userInitiated: boolean; editorRevision?: number; scope?: string };
export type EditorInteractionEvent = { selectionStart: number; selectionEnd: number };
export type EditorNavigationCommand = { revision: number; key: 'left' | 'down' | 'up' | 'right' | 'halfPageUp' | 'halfPageDown'; editorRevision?: number; scope?: string };
export type HardwareKeyEvent = {
  key: string;
  shift: boolean;
  control: boolean;
  option: boolean;
  command: boolean;
  isRepeat?: boolean;
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
  textAuthority?: number;
};
export type FocusEvent = { focused: boolean };
export type HardwareKeyboardEvent = { connected: boolean };
export type PastedAttachmentEvent = { uri?: string; filename?: string; mimeType?: string; byteCount?: number; error?: string };
export type PromptDropEvent = { id: string; sessionKey: string };
export type DroppedAttachment = { uri: string; filename: string; mimeType: string; byteCount: number };
export type PastedTextEvent = { text: string };

export type VimicateEditorViewProps = {
  editorState: string;
  focused: boolean;
  cursorVisible: boolean;
  captureAllKeys: boolean;
  softwareKeyboardEnabled?: boolean;
  softwareKeyboardForced?: boolean;
  routePastedTextExternally?: boolean;
  repeatAuthority: string;
  navigationCommand?: string;
  fontSize: number;
  onTextChange?: (event: { nativeEvent: EditorTextEvent }) => void;
  onSelectionChange?: (event: { nativeEvent: EditorSelectionEvent }) => void;
  onHardwareKey?: (event: { nativeEvent: HardwareKeyEvent }) => void;
  onFocusChange?: (event: { nativeEvent: FocusEvent }) => void;
  onEditorTap?: (event: { nativeEvent: EditorInteractionEvent }) => void;
  onHardwareKeyboardChange?: (event: { nativeEvent: HardwareKeyboardEvent }) => void;
  onPastedAttachment?: (event: { nativeEvent: PastedAttachmentEvent }) => void;
  onPastedText?: (event: { nativeEvent: PastedTextEvent }) => void;
  style?: StyleProp<ViewStyle>;
};
