import React, { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { VimicateEditorView } from '../../modules/vimicate-editor';
import { colors, type } from '../theme/tokens';
import { QuestionOtherEditorOwner } from './questionOtherEditorOwner';

export type QuestionOtherEditorProps = {
  value: string;
  scope: string;
  fontScale: number;
  maxLength: number;
  accessibilityLabel: string;
  onChange: (text: string) => void;
  onDone: () => void;
  onExit: () => void;
};

/** Mounted only while Other owns question keyboard focus, in both Vim modes. */
export function QuestionOtherEditor(props: QuestionOtherEditorProps) {
  const ownerRef = useRef<QuestionOtherEditorOwner | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [, refresh] = useState(0);
  const previous = ownerRef.current;
  const changedValue = previous && previous.observedValue !== props.value;
  if (!previous || previous.scope !== props.scope || (changedValue && previous.state.text !== props.value)) {
    ownerRef.current = new QuestionOtherEditorOwner(props.scope, props.value, props.maxLength, (previous?.state.authority ?? -1) + 1, previous?.clock);
  }
  const owner = ownerRef.current!;
  owner.observedValue = props.value;
  owner.maxLength = props.maxLength;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = () => mounted.current && ownerRef.current === owner && !owner.closed;
  const update = (reduce: () => 'done' | 'exit' | null | void) => {
    if (!active()) return;
    const previousState = owner.state;
    const action = reduce();
    if (owner.state.text !== previousState.text) callbacks.current.onChange(owner.state.text);
    if (owner.state !== previousState || action) refresh(revision => revision + 1);
    if (action === 'done') callbacks.current.onDone();
    if (action === 'exit') callbacks.current.onExit();
  };
  const mode = owner.state.visualMode ? 'VISUAL' : owner.state.mode.toUpperCase();
  const escape = () => update(() => owner.key({ key: 'escape', shift: false, control: false, option: false, command: false }));
  return <View style={styles.root} accessibilityLabel={props.accessibilityLabel}>
    <View style={styles.toolbar}>
      <Text style={[styles.mode, { fontSize: 11 * props.fontScale }]}>{mode}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={owner.state.mode === 'insert' ? 'Other answer normal mode' : 'Other answer insert mode'} onPress={owner.state.mode === 'insert' ? escape : () => update(() => owner.insert())} style={styles.button}>
        <Text style={styles.label}>{owner.state.mode === 'insert' ? 'esc' : 'i'}</Text>
      </Pressable>
      <Text style={[styles.hint, { fontSize: 10 * props.fontScale }]}>{owner.state.mode === 'insert' ? 'esc normal · ↵ newline' : '↵ done · esc back'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Done editing other answer" onPress={() => update(() => { owner.closed = true; return 'done'; })} style={styles.button}>
        <Text style={styles.label}>Done</Text>
      </Pressable>
    </View>
    <VimicateEditorView editorState={owner.serialized()} focused={!owner.closed} cursorVisible={!owner.closed}
      captureAllKeys={false} softwareKeyboardEnabled={owner.state.mode === 'insert'} repeatAuthority={props.scope}
      fontSize={14 * props.fontScale} style={styles.editor}
      onEditorTap={({ nativeEvent }) => update(() => owner.tap(nativeEvent))}
      onTextChange={({ nativeEvent }) => update(() => owner.text(nativeEvent))}
      onSelectionChange={({ nativeEvent }) => update(() => owner.selection(nativeEvent))}
      onHardwareKey={({ nativeEvent }) => update(() => owner.key(nativeEvent))} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 128, borderWidth: 1, borderColor: colors.activeAccent, backgroundColor: colors.inset },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  mode: { color: colors.activeAccent, fontFamily: type.mono, fontWeight: '700' },
  hint: { flex: 1, color: colors.faint, fontFamily: type.mono },
  button: { minHeight: 32, minWidth: 34, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.raised, borderRadius: 4 },
  label: { color: colors.ink, fontFamily: type.mono, fontSize: 12 },
  editor: { height: 100, minHeight: 100 },
});
