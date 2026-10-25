import { useRef, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Action, Label, Metric, Panel, SectionTitle } from '../ui/Primitives';
import { colors, space, type } from '../theme/tokens';
import { applyNormalKey, applyTextChange, createEditorState, type Selection } from './editorCore';

const SAMPLE = `Vimicate prompt buffer\n\nUse the hardware keyboard here. Escape enters NORMAL; i/a/I/A return to INSERT.\nThe stock TextInput path is deliberately instrumented before any native editor leaf is accepted.`;
const LONG_PROMPT = Array.from({ length: 850 }, (_, index) => `${String(index + 1).padStart(4, '0')}  Diagnose this gateway frame without losing the current draft or focus ownership.`).join('\n');

export function EditorLab({ record }: { record: (message: string) => void }) {
  const [state, setState] = useState(() => createEditorState(SAMPLE));
  const [focused, setFocused] = useState(false);
  const [keys, setKeys] = useState(0);
  const [latency, setLatency] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const suppressChange = useRef(false);
  const keyStarted = useRef(0);

  const handleKey = (key: string) => {
    keyStarted.current = performance.now();
    setKeys((value) => value + 1);
    if (key === 'Escape') {
      suppressChange.current = true;
      setState((current) => ({ ...current, mode: 'NORMAL' }));
      record('editor NORMAL via Escape');
      return;
    }
    if (state.mode === 'NORMAL') {
      suppressChange.current = key.length === 1;
      setState((current) => applyNormalKey(current, key));
    }
  };

  const handleChange = (text: string) => {
    setLatency(Math.round((performance.now() - keyStarted.current) * 10) / 10);
    if (suppressChange.current) { suppressChange.current = false; return; }
    setState((current) => applyTextChange(current, text, current.selection));
  };

  return (
    <View style={styles.root}>
      <SectionTitle index="01" title="EDITOR / FOCUS" detail="Hardware keyboard, controlled selection, long drafts, IME and scene ownership." />
      <View style={styles.metrics}><Metric label="mode" value={state.mode} tone={state.mode === 'NORMAL' ? 'warn' : 'good'} /><Metric label="focus" value={focused ? 'owned' : 'released'} tone={focused ? 'good' : 'normal'} /><Metric label="chars" value={state.text.length.toLocaleString()} /><Metric label="keys" value={keys} /><Metric label="input Δ" value={`${latency} ms`} tone={latency > 16 ? 'warn' : 'good'} /></View>
      <View style={styles.actions}>
        <Action label="FOCUS" onPress={() => inputRef.current?.focus()} />
        <Action label="ESC / NORMAL" active={state.mode === 'NORMAL'} onPress={() => setState((current) => ({ ...current, mode: 'NORMAL' }))} />
        <Action label="i / INSERT" active={state.mode === 'INSERT'} onPress={() => setState((current) => applyNormalKey({ ...current, mode: 'NORMAL' }, 'i'))} />
        <Action label="LOAD 40K" onPress={() => { setState(createEditorState(LONG_PROMPT)); record('editor loaded 40k workload'); }} />
        <Action label="DISMISS KB" onPress={() => Keyboard.dismiss()} />
        <Action label="RESET" danger onPress={() => setState(createEditorState(SAMPLE))} />
      </View>
      <Panel style={styles.editorPanel}>
        <View style={styles.gutter}><Label tone="accent">{state.mode}</Label><Text style={styles.gutterText}>stock RN{`\n`}TextInput{`\n`}{focused ? 'FOCUSED' : 'IDLE'}</Text></View>
        <ScrollView style={styles.editorScroll} keyboardShouldPersistTaps="always">
          <TextInput
            ref={inputRef}
            accessibilityLabel="Phase 1 prompt editor"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onBlur={() => { setFocused(false); record('editor focus released'); }}
            onChangeText={handleChange}
            onFocus={() => { setFocused(true); record('editor focus acquired'); }}
            onKeyPress={(event) => handleKey(event.nativeEvent.key)}
            onSelectionChange={(event) => setState((current) => ({ ...current, selection: event.nativeEvent.selection as Selection }))}
            selection={state.selection}
            selectionColor={colors.yellow}
            style={styles.editor}
            textAlignVertical="top"
            value={state.text}
          />
        </ScrollView>
      </Panel>
      <Text style={styles.note}>PASS GATE  //  no lost draft · no cursor jump · no focus theft · typing stays responsive at 40K · Stage Manager survives.</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 }, metrics: { flexDirection: 'row', gap: space.sm, marginBottom: space.md }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  editorPanel: { flex: 1, flexDirection: 'row', padding: 0, minHeight: 340 }, gutter: { width: 104, padding: space.md, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.inset },
  gutterText: { color: colors.faint, fontFamily: type.mono, fontSize: 10, lineHeight: 18, marginTop: space.md }, editorScroll: { flex: 1 },
  editor: { minHeight: 520, color: colors.inkBright, fontFamily: type.mono, fontSize: 14, lineHeight: 21, padding: space.lg },
  note: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 10, lineHeight: 16, marginTop: space.sm },
});
