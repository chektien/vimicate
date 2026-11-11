import type { ModelChoice } from '../gateway/modelMatching';
import { useEffect, useRef } from 'react';
import type { CommandHistorySelection } from '../keyboard/commandHistory';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { VimicateCommandInputView } from '../../modules/vimicate-editor';
import { commandCompletionOptions, type CommandCompletionOption, type CommandCompletionState } from '../gateway/commandCompletion';
import type { GatewayCommand } from '../gateway/gatewayCommands';
import { colors, space, type } from '../theme/tokens';
import type { WorkspaceFocus } from '../workspace/focusRouting';

export type SearchSession = { nativeEventCount?: number; scope: WorkspaceFocus; query: string; direction: 1 | -1; softwareKeyboardEnabled?: boolean };
export type CommandSession = CommandCompletionState & CommandHistorySelection & { nativeEventCount?: number; softwareKeyboardEnabled?: boolean };

type Props = {
  search: SearchSession | null; command: CommandSession | null;
  commands: GatewayCommand[]; modelChoices: ModelChoice[];
  onQueryChange: (query: string, eventCount?: number) => void;
  onSubmit: () => void; onCancel: () => void;
  onComplete: (reverse: boolean) => void; onHistory: (direction: -1 | 1) => void;
  onSelectCompletion: (value: string, offered: CommandSession) => void;
};

export function WorkspaceCommandBar({ search, command, commands, modelChoices, onQueryChange, onSubmit, onCancel, onComplete, onHistory, onSelectCompletion }: Props) {
  const { width, height } = useWindowDimensions();
  const list = useRef<FlatList<CommandCompletionOption>>(null);
  const offer = command ? commandCompletionOptions(commands, command, { models: modelChoices }) : null;
  const cycle = command?.completion;
  const selectedValue = cycle && cycle.query === command?.query ? command.query.slice(cycle.start, cycle.end) : undefined;
  const selectedIndex = offer?.options.findIndex((option) => option.value === selectedValue) ?? -1;
  const optionsKey = offer?.options.map((option) => option.value).join('\n') ?? '';
  const scrollToSelection = () => {
    if (selectedIndex >= 0) list.current?.scrollToIndex({ index: selectedIndex, animated: false, viewPosition: 0.5 });
  };
  useEffect(() => {
    if (selectedIndex >= 0) list.current?.scrollToIndex({ index: selectedIndex, animated: false, viewPosition: 0.5 });
    else list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [selectedIndex, optionsKey]);
  if (!search && !command) return null;
  const softwareKeyboardEnabled = search?.softwareKeyboardEnabled ?? command?.softwareKeyboardEnabled ?? false;
  const touchLayout = width < 600 || softwareKeyboardEnabled;
  return <View style={styles.root}>
    {command && offer ? <>
      {offer.options.length ? <FlatList scrollsToTop={false}
        ref={list}
        accessibilityLabel="Command completion options"
        data={offer.options}
        extraData={selectedValue}
        keyExtractor={(option) => option.value}
        keyboardDismissMode="none"
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator
        persistentScrollbar
        style={{ maxHeight: Math.min(132, height * 0.2) }}
        onContentSizeChange={scrollToSelection}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // Admit unmeasured wrapped rows, then align the selection after layout.
          list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
        }}
        renderItem={({ item }) => <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Complete ${item.label}`}
          accessibilityHint="Fills the command without running it"
          accessibilityState={{ selected: item.value === selectedValue }}
          onLayout={item.value === selectedValue ? scrollToSelection : undefined}
          onPress={() => onSelectCompletion(item.value, command)}
          style={({ pressed }) => [styles.option, (pressed || item.value === selectedValue) && styles.pressed]}
        >
          <Text style={styles.optionLabel}>{item.label}</Text>
          {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
        </Pressable>}
      /> : <Text style={styles.notice}>{offer.notice}</Text>}
      {offer.options.length ? <Text style={styles.caption}>{`${offer.options.length} ${offer.options.length === 1 ? 'match' : 'matches'} · tap to fill · scroll for more`}</Text> : null}
    </> : null}
    <View style={[styles.entry, touchLayout && styles.touchEntry]}>
      <Text style={styles.prompt}>{search ? search.direction === 1 ? '/' : '?' : ':'}</Text>
      <VimicateCommandInputView
        active
        softwareKeyboardEnabled={softwareKeyboardEnabled}
        inputAccessibilityLabel={search ? 'Transcript search input' : 'Colon command input'}
        onQueryChange={({ nativeEvent }) => onQueryChange(nativeEvent.text, nativeEvent.eventCount)}
        onCancel={onCancel}
        onComplete={({ nativeEvent }) => onComplete(nativeEvent.reverse)}
        historyEnabled={Boolean(command)}
        onHistory={({ nativeEvent }) => onHistory(nativeEvent.direction)}
        onSubmit={onSubmit}
        value={search?.query ?? command?.query ?? ''}
        mostRecentEventCount={search?.nativeEventCount ?? command?.nativeEventCount ?? 0}
        style={[styles.input, touchLayout && styles.touchInput]}
      />
      {!touchLayout ? <Text style={styles.description}>{command ? '↑↓ / Tab complete · Shift-↑↓ history · ' : ''}Esc cancel · ↵ {search ? 'search' : 'run'}</Text> : null}
      {touchLayout ? <>
        <Pressable accessibilityRole="button" accessibilityLabel={search ? 'Cancel search' : 'Cancel command'} onPress={onCancel} style={styles.action}>
          <Text style={styles.description}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={search ? 'Search' : 'Run command'} onPress={onSubmit} style={styles.action}>
          <Text style={styles.run}>{search ? 'Find' : 'Run'}</Text>
        </Pressable>
      </> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.inset, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.yellow, flexShrink: 0 },
  entry: { minHeight: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  touchEntry: { minHeight: 44 },
  prompt: { color: colors.yellow, fontFamily: type.mono, fontSize: type.sizeMd },
  input: { flex: 1, minWidth: 0, height: 22 }, touchInput: { height: 44 },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.raised },
  optionLabel: { color: colors.inkBright, fontFamily: type.mono, fontSize: type.sizeMd, flexShrink: 1 },
  description: { color: colors.inkMuted, fontFamily: type.mono, fontSize: type.sizeSm },
  caption: { color: colors.faint, fontFamily: type.mono, fontSize: type.sizeSm, paddingHorizontal: space.md, paddingVertical: space.xs },
  notice: { color: colors.inkMuted, fontFamily: type.mono, fontSize: type.sizeSm, padding: space.sm },
  action: { minWidth: 44, minHeight: 44, paddingHorizontal: space.sm, justifyContent: 'center', alignItems: 'center' },
  run: { color: colors.yellow, fontFamily: type.mono, fontSize: type.sizeSm },
});
