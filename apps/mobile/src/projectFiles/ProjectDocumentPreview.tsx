import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { VimicateFilePreviewView } from '../../modules/vimicate-file-links';
import type { ProjectFileContent } from '../gateway/projectFiles';
import { colors, type } from '../theme/tokens';

/** Unsupported native formats remain selected in the same directory. */
export function ProjectDocumentPreview({ content, onFocus }: {
  content: Extract<ProjectFileContent, { dataBase64: string }>;
  onFocus: () => void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [problem, setProblem] = useState('');
  const [revision, setRevision] = useState(0);
  const active = useRef(true); const currentRevision = useRef(revision);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const filename = content.path.split('/').pop() ?? content.path;
  const message = !VimicateFilePreviewView
    ? 'Install the latest TestFlight build to preview this document. The file is selected in its folder.'
    : status === 'unsupported' ? 'Preview not supported for this file type on this device. The file is selected in its folder.'
      : status === 'error' ? problem || 'This document could not be previewed. The file is selected in its folder.'
        : 'Preparing document preview…';
  return <View style={styles.container} onTouchStart={onFocus} accessibilityLabel={`Document preview ${filename}`}>
    {status !== 'ready' ? <Text accessibilityRole="text" style={styles.notice}>{message}</Text> : null}
    {VimicateFilePreviewView && status === 'error' ? <Pressable accessibilityRole="button" accessibilityLabel="Retry document preview"
      onPress={() => { currentRevision.current += 1; setRevision(currentRevision.current); setStatus('loading'); setProblem(''); }}>
      <Text style={styles.retry}>Retry preview</Text>
    </Pressable> : null}
    {VimicateFilePreviewView && status !== 'unsupported' && status !== 'error' ? <VimicateFilePreviewView
      key={revision}
      style={styles.preview} dataBase64={content.dataBase64} filename={filename} mimeType={content.mimeType}
      onPreviewStatus={({ nativeEvent }) => { if (active.current && currentRevision.current === revision) { setStatus(nativeEvent.status); setProblem(nativeEvent.message ?? ''); } }}
    /> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, backgroundColor: colors.inset },
  preview: { flex: 1, minHeight: 0 },
  notice: { color: colors.faint, fontFamily: type.mono, fontSize: 12, padding: 12 },
  retry: { color: colors.yellow, fontFamily: type.mono, fontSize: 12, padding: 12, minHeight: 44 },
});
