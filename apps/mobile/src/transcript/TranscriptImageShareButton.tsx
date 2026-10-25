import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { File, FileMode } from 'expo-file-system';
import { SymbolView } from 'expo-symbols';
import { isVimicateFileShareAvailable, shareVimicateFile } from '../../modules/vimicate-file-links';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import { type } from '../theme/tokens';
import { useGatewayImage } from './useGatewayImage';
import { prepareTranscriptImageShare } from './transcriptImageShare';

/** Selected-image lifetime. Resolution reuses the viewer's scoped, bounded source cache. */
export function TranscriptImageShareButton({ attachment, top }: { attachment: WorkspaceAttachment; top: number }) {
  const { source, phase } = useGatewayImage(attachment);
  const [sharing, setSharing] = useState(false); const [problem, setProblem] = useState('');
  const button = useRef<View>(null); const request = useRef<AbortController | null>(null);
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true; setSharing(false); setProblem('');
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') request.current?.abort(); });
    return () => { alive.current = false; request.current?.abort(); request.current = null; subscription.remove(); };
  }, [attachment.id, attachment.uri, attachment.headers, attachment.artifactId, attachment.artifactSessionKey, attachment.filename, attachment.mimeType]);
  const share = () => {
    if (!alive.current || request.current) return;
    setProblem('');
    if (!isVimicateFileShareAvailable()) { setProblem('Install the latest TestFlight build to share images.'); return; }
    if (!source.uri || phase === 'failed' || phase === 'resolving') { setProblem('Wait for the image to load, or retry the image first.'); return; }
    const controller = new AbortController(); request.current = controller; setSharing(true);
    const timer = setTimeout(() => controller.abort(), 30_000);
    const present = async () => {
      try {
        const anchor = await new Promise<{ x: number; y: number; width: number; height: number }>((resolve, reject) => {
          const abort = () => reject(new Error('Image sharing interrupted.'));
          controller.signal.addEventListener('abort', abort, { once: true });
          const measured = (x: number, y: number, width: number, height: number) => {
            controller.signal.removeEventListener('abort', abort); resolve({ x, y, width, height });
          };
          if (button.current) button.current.measureInWindow(measured); else measured(0, 0, 0, 0);
        });
        const file = await prepareTranscriptImageShare(source, attachment, controller.signal, uri => new File(uri).open(FileMode.ReadOnly));
        if (controller.signal.aborted) throw new Error('Image sharing interrupted.'); if (!alive.current) return;
        clearTimeout(timer);
        await shareVimicateFile(file.dataBase64, file.filename, file.mimeType, anchor);
      } catch (error) {
        if (alive.current && request.current === controller) setProblem(controller.signal.aborted ? 'Image sharing was interrupted. Try again.' : error instanceof Error ? error.message : 'This image could not be shared. Try again.');
      } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; if (alive.current) setSharing(false); } }
    };
    void present();
  };
  return <>
    <Pressable ref={button} accessibilityRole="button" accessibilityLabel="Share image" accessibilityHint="Copy or share the original image with the iOS share sheet"
      accessibilityState={{ disabled: sharing, busy: sharing }} disabled={sharing} onPress={share}
      style={[styles.button, { top }, sharing && styles.busy]}>
      <SymbolView name="square.and.arrow.up" size={21} weight="regular" tintColor="#fff" style={styles.symbol} fallback={<Text style={styles.fallback}>↑</Text>} />
    </Pressable>
    {problem ? <Text accessibilityRole="alert" style={[styles.problem, { top: top + 52 }]}>{problem}</Text> : null}
  </>;
}
const styles = StyleSheet.create({
  button: { position: 'absolute', right: 74, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.62)' },
  busy: { opacity: 0.4 }, symbol: { width: 24, height: 24 }, fallback: { color: '#fff', fontSize: 24 },
  problem: { position: 'absolute', left: 28, right: 28, padding: 8, backgroundColor: 'rgba(0,0,0,0.85)', color: '#fff', fontFamily: type.mono, fontSize: 12 },
});
