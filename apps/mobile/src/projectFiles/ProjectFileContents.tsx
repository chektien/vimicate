import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { isVimicateFileShareAvailable, shareVimicateFile } from '../../modules/vimicate-file-links';
import type { ProjectFileContent } from '../gateway/projectFiles';
import { colors, space, type } from '../theme/tokens';
import { workspaceFontMetrics } from '../ui/workspaceTypography';
import { ProjectHTMLPreview } from './ProjectHTMLPreview';
import { isHTMLFile, projectFileTransfer } from './projectFileTransfer';

/** One selected-file lifetime, keyed by the parent. Toolbar stays outside the scroller. */
export function ProjectFileContents({ content, checking, fontScale, onFocus, onNativePreviewActive, expanded, onToggleExpanded, children }: {
  expanded?: boolean; onToggleExpanded?: () => void; content: ProjectFileContent; checking: boolean; fontScale: number; onFocus: () => void; onNativePreviewActive?: (active: boolean) => void; children: ReactNode;
}) {
  const html = isHTMLFile(content); const [source, setSource] = useState(false);
  const [sharing, setSharing] = useState(false); const [problem, setProblem] = useState('');
  const busy = useRef(false); const alive = useRef(true); const ready = useRef(!checking); ready.current = !checking;
  const shareButton = useRef<View>(null); const file = useMemo(() => projectFileTransfer(content), [content]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => {
    onNativePreviewActive?.(html && !source);
    return () => onNativePreviewActive?.(false);
  }, [html, source, onNativePreviewActive]);
  const share = () => {
    if (busy.current || !ready.current) return;
    onFocus(); setProblem('');
    if (!isVimicateFileShareAvailable()) { setProblem('Install the next TestFlight build to share files.'); return; }
    busy.current = true; setSharing(true);
    const present = async (x: number, y: number, width: number, height: number) => {
      try { if (alive.current && ready.current) await shareVimicateFile(file.dataBase64, file.filename, file.mimeType, { x, y, width, height }); }
      catch { if (alive.current) setProblem('This file could not be shared. Try again.'); }
      finally { busy.current = false; if (alive.current) setSharing(false); }
    };
    if (shareButton.current) shareButton.current.measureInWindow((x, y, width, height) => { void present(x, y, width, height); });
    else void present(0, 0, 0, 0);
  };
  const hint = checking ? 'checking file…' : sharing ? 'opening share sheet…'
    : html && !source ? 'Interactive HTML · pinch to zoom · embedded assets only'
      : content.kind === 'text' ? 'Enter/Tab preview · y copies source · i edits in prompt' : 'Share the complete file';
  return <View style={styles.container}>
    <View style={styles.header}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Focus file preview" onPress={onFocus} style={styles.identity}>
          <Text numberOfLines={1} style={[styles.filename, workspaceFontMetrics(type.sizeXs, fontScale)]}>{content.path}</Text>
        </Pressable>
        {html && onToggleExpanded ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Restore file pane' : 'Expand file preview'} onPress={onToggleExpanded} style={styles.share}>
          <SymbolView name={expanded ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'} size={18} weight="regular" tintColor={colors.inkMuted} style={styles.symbol} />
        </Pressable> : null}
        <Pressable ref={shareButton} accessibilityRole="button" accessibilityLabel={`Share ${file.filename}`} accessibilityHint="Opens the iOS share sheet with the complete file"
          accessibilityState={{ disabled: checking || sharing, busy: sharing }} disabled={checking || sharing} onPress={share}
          style={({ pressed }) => [styles.share, pressed && styles.pressed, (checking || sharing) && styles.disabled]}>
          <SymbolView name="square.and.arrow.up" size={18} weight="regular" tintColor={colors.inkMuted}
            fallback={<Text style={styles.controlText}>↑</Text>} style={styles.symbol} />
        </Pressable>
      </View>
      {html ? <View accessibilityLabel="HTML display mode" style={styles.modes}>
        {(['Preview', 'Source'] as const).map(label => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Show HTML ${label.toLowerCase()}`}
          accessibilityState={{ selected: (label === 'Source') === source }} onPress={() => { onFocus(); setSource(label === 'Source'); }}
          style={[styles.mode, (label === 'Source') === source && styles.selected]}><Text style={[styles.controlText, (label === 'Source') === source && styles.selectedText]}>{label}</Text></Pressable>)}
      </View> : null}
      <Text style={styles.hint}>{hint}</Text>
    </View>
    {problem ? <Text accessibilityRole="alert" style={styles.problem}>{problem}</Text> : null}
    <View style={styles.body}>
      {html ? <View style={[styles.layer, source && styles.hidden]} pointerEvents={source ? 'none' : 'auto'} accessibilityElementsHidden={source} importantForAccessibility={source ? 'no-hide-descendants' : 'auto'}><ProjectHTMLPreview file={file} onFocus={onFocus} /></View> : null}
      <View onTouchStart={onFocus} style={[styles.layer, html && !source && styles.hidden]} pointerEvents={html && !source ? 'none' : 'auto'} accessibilityElementsHidden={html && !source} importantForAccessibility={html && !source ? 'no-hide-descendants' : 'auto'}>{children}</View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, backgroundColor: colors.inset }, body: { flex: 1, minHeight: 0 }, layer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, hidden: { opacity: 0 },
  header: { paddingHorizontal: space.sm, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs }, identity: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  filename: { color: colors.blue, fontFamily: type.mono, fontWeight: '800' },
  share: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, symbol: { width: 22, height: 22 },
  pressed: { backgroundColor: colors.raised }, disabled: { opacity: 0.4 },
  modes: { flexDirection: 'row', gap: space.xs, marginBottom: space.xs }, mode: { minHeight: 44, paddingHorizontal: space.md, justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  selected: { borderColor: colors.activeAccent, backgroundColor: colors.raised }, selectedText: { color: colors.yellow },
  controlText: { color: colors.inkMuted, fontFamily: type.mono, fontSize: type.sizeSm }, hint: { color: colors.faint, fontFamily: type.mono, fontSize: type.sizeXs },
  problem: { color: colors.red, fontFamily: type.mono, fontSize: type.sizeSm, padding: space.sm },
});
