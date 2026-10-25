import { useEffect, useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { colors, space, type } from '../theme/tokens';
import type { QueuedPromptState } from '../gateway/queuedPromptOwner';
import { useQueuedPromptActions } from './QueuedPromptContext';
const labels: Record<QueuedPromptState, string> = {
  preparing: 'Waiting for queue acceptance…', accepted: 'Message accepted. Checking queue…',
  queued: 'Queued after the current task. Runs automatically.', consumed: 'Sent to agent',
  interrupted: 'Queued message interrupted', cancelled: 'Queued message cancelled', unknown: 'Queued-message delivery unconfirmed',
};
export function TranscriptQueuedPrompt({ message }: { message: WorkspaceMessage }) {
  const actions = useQueuedPromptActions(); const queued = actions?.view(message);
  const pendingConfirmation = useRef<symbol | null>(null);
  const latest = useRef({ actions, message }); latest.current = { actions, message };
  useEffect(() => () => { pendingConfirmation.current = null; },
    [queued?.runId, queued?.predecessorRunId, queued?.sessionKey, queued?.sessionId, queued?.canRunNow]);
  if (!actions || !queued) return null;
  const confirmStop = () => {
    if (!queued.canRunNow || pendingConfirmation.current) return;
    const token = Symbol('queued-stop'); pendingConfirmation.current = token;
    const dismiss = () => { if (pendingConfirmation.current === token) pendingConfirmation.current = null; };
    Alert.alert('Stop the current task?',
      'Your queued message will run next. The current task will be interrupted and will not resume automatically. A self-scheduling task may not schedule its next run.',
      [
        { text: 'Keep queued', style: 'cancel', isPreferred: true, onPress: dismiss },
        { text: 'Stop task & run next', style: 'destructive', onPress: () => {
          if (pendingConfirmation.current !== token) return;
          dismiss();
          const current = latest.current; const fresh = current.actions?.view(current.message);
          if (!fresh?.canRunNow || fresh.runId !== queued.runId || fresh.predecessorRunId !== queued.predecessorRunId
            || fresh.sessionKey !== queued.sessionKey || fresh.sessionId !== queued.sessionId) return;
          void current.actions?.runNow(queued.runId);
        } },
      ], { cancelable: true, onDismiss: dismiss });
  };
  return <View style={styles.root} accessibilityLabel="Queued message status">
    <Text accessibilityLiveRegion="polite" style={styles.status}>{labels[queued.state]}</Text>
    {queued.canRunNow ? <Text style={styles.status}>The current task keeps running. Reply "interrupt" to stop it and run queued messages next.</Text> : null}
    {queued.detail ? <Text style={styles.status}>{queued.detail}</Text> : null}
    {actions.storageError ? <Text accessibilityRole="alert" style={styles.status}>{actions.storageError}</Text> : null}
    <View style={styles.actions}>
      {queued.canCancel ? <Pressable accessibilityRole="button" accessibilityLabel="Cancel queued message" style={styles.button} onPress={() => { void actions.cancel(queued.runId); }}><Text style={styles.action}>Cancel</Text></Pressable> : null}
      {queued.canRunNow ? <Pressable accessibilityRole="button" accessibilityLabel="Stop current task and run queued message next" style={styles.button} onPress={confirmStop}><Text style={styles.action}>Stop task &amp; run next…</Text></Pressable> : null}
    </View>
    {queued.busy ? <Text style={styles.status}>Checking queue…</Text> : null}
  </View>;
}
// Existing transcript palette/type/spacing. 44pt is the product's touch-target minimum.
const styles = StyleSheet.create({
  root: { gap: space.xs, paddingTop: space.xs },
  status: { color: colors.inkMuted, fontFamily: type.mono, fontSize: type.sizeSm, lineHeight: space.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  action: { color: colors.activeAccent, fontFamily: type.mono, fontSize: type.sizeSm, lineHeight: space.lg },
});
