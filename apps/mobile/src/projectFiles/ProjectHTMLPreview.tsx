import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { VimicateHTMLPreviewView } from '../../modules/vimicate-file-links';
import { colors, space, type } from '../theme/tokens';
import type { projectFileTransfer } from './projectFileTransfer';

export function ProjectHTMLPreview({ file, onFocus }: { file: ReturnType<typeof projectFileTransfer>; onFocus: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [problem, setProblem] = useState(''); const [revision, setRevision] = useState(0);
  const current = useRef(revision); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <View style={styles.body} onTouchStart={onFocus} accessibilityLabel={`HTML preview ${file.filename}`}>
    {!VimicateHTMLPreviewView ? <Text style={styles.notice}>Install the next TestFlight build to preview HTML. Source remains available.</Text> : <>
      {status !== 'ready' || problem ? <Text style={styles.notice}>{status === 'loading' ? 'Rendering HTML…' : problem || 'This HTML could not be displayed. You can still open Source or share the file.'}</Text> : null}
      {status === 'error' ? <Pressable accessibilityRole="button" accessibilityLabel="Retry HTML preview" style={styles.retry}
        onPress={() => { current.current += 1; setRevision(current.current); setStatus('loading'); setProblem(''); }}><Text style={styles.retryText}>Retry preview</Text></Pressable> : null}
      {status !== 'error' && status !== 'unsupported' ? <VimicateHTMLPreviewView key={revision} {...file} style={styles.body}
        onPreviewStatus={({ nativeEvent }) => { if (alive.current && current.current === revision) { setStatus(nativeEvent.status); setProblem(nativeEvent.message ?? ''); } }} /> : null}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0, backgroundColor: colors.inset },
  notice: { fontFamily: type.mono, fontSize: type.sizeSm, color: colors.inkMuted, padding: space.md },
  retry: { minHeight: 44, padding: space.md }, retryText: { fontFamily: type.mono, fontSize: type.sizeSm, color: colors.yellow },
});
