import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { beginVimicateFileShare, isVimicateStreamedFileShareAvailable, maximumVimicateFileShareBytes,
  shareVimicateFile, type VimicateFileShareAnchor } from '../../modules/vimicate-file-links';
import type { ProjectFileEntry } from '../gateway/projectFiles';
import { PROJECT_FILE_SHARE_MAX_BYTES, type ProjectFileShareReader } from '../gateway/projectFileSharing';
import { colors, space, type } from '../theme/tokens';
import { workspaceFontMetrics } from '../ui/workspaceTypography';
import { projectFileShareFailure } from './projectFileShareFailure';

/** Failed/unsupported previews retain an explicit original-file escape hatch.
 * Transfer custody ends on selection change, close, cancel or backgrounding. */
export function ProjectFileShareFallback({ entry, projectId, readFileForSharing, message, fontScale, onFocus, registerOpen }: {
  entry: ProjectFileEntry; projectId: string; readFileForSharing?: ProjectFileShareReader | undefined;
  message: string; fontScale: number; onFocus: () => void;
  registerOpen?: (entry: ProjectFileEntry, action: () => void) => () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'sharing'>('idle');
  const [problem, setProblem] = useState('');
  const request = useRef<AbortController | null>(null);
  const chooser = useRef<AbortController | null>(null);
  const button = useRef<View>(null);
  useLayoutEffect(() => {
    setPhase('idle'); setProblem('');
    const subscription = AppState.addEventListener('change', state => {
      // Opening a receiving app may background Vimicate before the activity's
      // completion. Native custody lasts through that handoff, not just foreground.
      if (state !== 'active' && request.current !== chooser.current) { request.current?.abort(); setPhase('idle'); }
    });
    return () => { subscription.remove(); request.current?.abort(); request.current = null; };
  }, [projectId, entry.path, entry.size, entry.mtimeMs, readFileForSharing]);
  const share = async () => {
    if (request.current || AppState.currentState !== 'active') return;
    onFocus(); setProblem('');
    const streamed = isVimicateStreamedFileShareAvailable();
    if (!streamed && entry.size > PROJECT_FILE_SHARE_MAX_BYTES) {
      setProblem('Sharing is limited to 32 MiB on this build. Install the next TestFlight build to share this file.'); return;
    }
    if (!streamed && (entry.size > maximumVimicateFileShareBytes() || maximumVimicateFileShareBytes() === 0)) {
      setProblem('Install the next TestFlight build to share this file.'); return;
    }
    if (!readFileForSharing) { setProblem('This Gateway does not support original-file sharing yet.'); return; }
    const current = new AbortController(); request.current = current; setPhase('downloading');
    const expire = () => {
      if (request.current === current && !current.signal.aborted) setProblem('File transfer timed out. Try again.');
      current.abort();
    };
    let timeout = setTimeout(expire, 5 * 60 * 1000);
    let stage: Awaited<ReturnType<typeof beginVimicateFileShare>> | undefined;
    const cancelStage = () => { void stage?.cancel().catch(() => undefined); };
    current.signal.addEventListener('abort', cancelStage, { once: true });
    let presenting = false;
    try {
      if (streamed) stage = await beginVimicateFileShare(entry.name, entry.size);
      if (current.signal.aborted) return;
      const file = await readFileForSharing({ projectId, path: entry.path, size: entry.size, mtimeMs: entry.mtimeMs, signal: current.signal,
        ...(stage ? { writeChunk: async (offset: number, dataBase64: string) => {
          await stage!.append(offset, dataBase64);
          if (current.signal.aborted || request.current !== current) return;
          clearTimeout(timeout); timeout = setTimeout(expire, 5 * 60 * 1000);
        } } : {}) });
      const anchor = await measureAnchor(button.current);
      if (request.current !== current || current.signal.aborted || AppState.currentState !== 'active') return;
      clearTimeout(timeout); presenting = true; chooser.current = current; setPhase('sharing');
      // The native owner retains the original in its private directory until
      // the chooser finishes. No URI or provider permission escapes this bridge.
      if (stage && file.streamed) await stage.present(anchor);
      else if (!stage && !file.streamed) await shareVimicateFile(file.dataBase64, file.filename, file.mimeType, anchor);
      else throw new Error('Invalid original file transfer response.');
    } catch (error) {
      if (request.current === current && !current.signal.aborted) setProblem(projectFileShareFailure(error, presenting));
    } finally {
      clearTimeout(timeout);
      current.signal.removeEventListener('abort', cancelStage);
      await stage?.cancel().catch(() => undefined);
      if (chooser.current === current) chooser.current = null;
      if (request.current === current) { request.current = null; setPhase('idle'); }
    }
  };
  useLayoutEffect(() => registerOpen?.(entry, () => { void share(); }));
  return <View style={styles.container}>
    <Text style={[styles.notice, workspaceFontMetrics(type.sizeSm, fontScale)]}>{message}</Text>
    <Pressable ref={button} accessibilityRole="button" accessibilityLabel={`Share original ${entry.name}`}
      accessibilityHint="Downloads the original file and opens the iOS share sheet for another app"
      accessibilityState={{ disabled: phase !== 'idle', busy: phase !== 'idle' }} disabled={phase !== 'idle'}
      onPress={() => { void share(); }} style={({ pressed }) => [styles.button, pressed && styles.pressed, phase !== 'idle' && styles.disabled]}>
      <Text style={[styles.label, workspaceFontMetrics(type.sizeSm, fontScale)]}>{phase === 'downloading' ? 'Downloading original…' : phase === 'sharing' ? 'Opening share sheet…' : 'Share / Open in…'}</Text>
    </Pressable>
    {phase === 'downloading' ? <Pressable accessibilityRole="button" accessibilityLabel="Cancel file download" style={styles.button}
      onPress={() => { request.current?.abort(); setPhase('idle'); }}><Text style={[styles.label, workspaceFontMetrics(type.sizeSm, fontScale)]}>Cancel download</Text></Pressable> : null}
    {problem ? <Text accessibilityRole="alert" style={[styles.problem, workspaceFontMetrics(type.sizeSm, fontScale)]}>{problem}</Text> : null}
  </View>;
}

function measureAnchor(view: View | null): Promise<VimicateFileShareAnchor> {
  return new Promise(resolve => {
    const fallback = { x: 0, y: 0, width: 0, height: 0 };
    if (!view) { resolve(fallback); return; }
    const timeout = setTimeout(() => resolve(fallback), 750);
    view.measureInWindow((x, y, width, height) => { clearTimeout(timeout); resolve({ x, y, width, height }); });
  });
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, padding: space.sm, gap: space.sm, backgroundColor: colors.inset },
  notice: { color: colors.inkMuted, fontFamily: type.mono },
  button: { minHeight: 44, paddingHorizontal: space.md, paddingVertical: space.sm, justifyContent: 'center', alignSelf: 'flex-start' },
  label: { color: colors.blue, fontFamily: type.mono, fontWeight: '800' },
  pressed: { backgroundColor: colors.raised }, disabled: { opacity: 0.4 }, problem: { color: colors.red, fontFamily: type.mono },
});
