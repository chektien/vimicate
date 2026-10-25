import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WorkspaceCommandBar, type CommandSession, type SearchSession } from '../ui/WorkspaceCommandBar';
import { workspaceCommandLineActions } from '../keyboard/workspaceCommandLineActions';
import { SoftwareKeyboardViewport } from '../layout/SoftwareKeyboardViewport';
import { useSynchronousState } from './useSynchronousState';
import { colors, type } from '../theme/tokens';

const modelChoices = ['openai/gpt-6-astra', 'openai/gpt-6.1-sol', 'anthropic/claude-opus-5', ...Array.from({ length: 25 }, (_, i) => `example/long-model-name-for-wrapping-and-scroll-${i + 1}`)];

/** Isolated UI acceptance. No Gateway, workspace persistence or command execution. */
export function SimulatorCommandCompletionFixture() {
  const [command, setCommand, commandRef] = useSynchronousState<CommandSession | null>({ query: 'model ', softwareKeyboardEnabled: true });
  const [, setSearch, searchRef] = useSynchronousState<SearchSession | null>(null);
  const [submitted, setSubmitted] = useState('Nothing submitted');
  const actions = workspaceCommandLineActions({ commandRef, searchRef, setCommand, setSearch, commands: [],
    modelChoices,
  });
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
    <SoftwareKeyboardViewport>
      <View style={{ flex: 1, padding: 12 }}>
        <Text style={{ color: colors.ink, fontFamily: type.mono, fontSize: type.sizeLg }}>vimicate · command completion QA</Text>
        <Text style={{ color: colors.inkMuted, marginTop: 12 }}>{submitted}</Text>
        <Pressable onPress={() => setCommand({ query: '', softwareKeyboardEnabled: true })} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.yellow }}>Open command catalog</Text></Pressable>
      </View>
      <WorkspaceCommandBar command={command} search={null} commands={[]} modelChoices={modelChoices}
        onQueryChange={actions.updateQuery} onComplete={actions.complete} onSelectCompletion={actions.selectCompletion}
        onHistory={actions.recall} onCancel={actions.cancel} onSubmit={() => setSubmitted(`Submitted: ${commandRef.current?.query}`)} />
    </SoftwareKeyboardViewport>
  </SafeAreaView>;
}
