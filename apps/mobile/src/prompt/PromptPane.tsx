import { useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { PromptDropSurface, VimicateEditorView, type PromptDropEvent, type EditorNavigationCommand, type HardwareKeyEvent, type PastedAttachmentEvent } from '../../modules/vimicate-editor';
import { colors, type } from '../theme/tokens';
import type { WorkspaceFocus } from '../workspace/focusRouting';
import { acceptNativeSelection, acceptNativeText, type PromptState, type Selection } from './vimPromptCore';
import type { PromptAttachment } from './promptAttachments';
import { ATTACHMENT_SLOT_WIDTH, COMPACT_ATTACHMENT_SLOT_WIDTH, PromptAttachmentRail } from './PromptAttachmentRail';
import { EditorCommitClock } from './editorCommitClock';
import { promptSoftwareKeyboardEnabled } from './softwareKeyboardPolicy';
import { PROMPT_TOOLBAR_NAVIGATION_KEYS, promptToolbarKeyEvent, promptToolbarNavigationTarget, type PromptToolbarNavigationKey, type PromptToolbarNavigationTarget } from './promptToolbarActions';
import { PromptHistoryBrowserPanel } from './PromptHistoryBrowserPanel';
import type { PromptHistoryBrowserState } from './promptHistoryBrowser';
import { promptModeHint } from './promptCommand';

// Room for the regular-width mode hint. Compact toolbars show no hint.
const MIN_TOOLBAR_FREE_SPACE = 56;

export type PromptNavigationRequest = { revision: number; key: 'halfPageUp' | 'halfPageDown'; scope: string; state: PromptState };

export function PromptPane({ navigationRequest, sessionKey = '', onDrop, dropEnabled, state, focusedPane, keyboardCapture, inputBlocked = false, commandLineActive = false, commandLineNativeInputActive = false, commandHistoryActive = false, softwareKeyboardRequested, softwareKeyboardForced, fontScale, height, sending, attachments, importing, attachmentLimitReached, compact = false, historyBrowser, onState, onFocusPrompt, onRequestPromptFocus, onHardwareKeyboardChange, onHardwareKey, onCommandHistory, onPastedAttachment, onPastedCommandLineText, onSubmit, onAbort, onPickDocument, onPickImage, onPreviewAttachment, onRemoveAttachment, onOpenCommand, onOpenNewThread, onToggleHistory, onCloseHistory, onAcceptHistory }: { navigationRequest?: PromptNavigationRequest | null; sessionKey?: string; dropEnabled?: boolean; onDrop?: (event: PromptDropEvent) => void; state: PromptState; focusedPane: WorkspaceFocus; keyboardCapture: boolean; inputBlocked?: boolean; commandLineActive?: boolean; commandLineNativeInputActive?: boolean; commandHistoryActive?: boolean; softwareKeyboardRequested: boolean; softwareKeyboardForced: boolean; fontScale: number; height: number; sending: boolean; attachments: PromptAttachment[]; importing: boolean; attachmentLimitReached: boolean; compact?: boolean; historyBrowser: PromptHistoryBrowserState; onState: Dispatch<SetStateAction<PromptState>>; onFocusPrompt: (selection: Selection) => void; onRequestPromptFocus: () => void; onHardwareKeyboardChange: (connected: boolean) => void; onHardwareKey: (event: HardwareKeyEvent) => void; onCommandHistory: (direction: -1 | 1) => void; onPastedAttachment: (event: PastedAttachmentEvent) => void; onPastedCommandLineText: (text: string) => void; onSubmit: () => void; onAbort: () => void; onPickDocument: () => void; onPickImage: () => void; onPreviewAttachment: (id: string) => void; onRemoveAttachment: (id: string) => void; onOpenCommand: () => void; onOpenNewThread: () => void; onToggleHistory: () => void; onCloseHistory: () => void; onAcceptHistory: (index: number) => void }) {
  const editorCommitClock = useRef(new EditorCommitClock());
  const navigationRevision = useRef(0);
  const [navigationExpanded, setNavigationExpanded] = useState(false);
  const [attachmentSpaceWidth, setAttachmentSpaceWidth] = useState(0);
  const [navigationCommand, setNavigationCommand] = useState<EditorNavigationCommand>({ revision: 0, key: 'left' });
  const editorState = editorCommitClock.current.serialized(state, sessionKey);
  const editorRevision = editorCommitClock.current.commit(state, sessionKey).revision;
  const navigationEnabled = !inputBlocked && !commandLineActive && !historyBrowser.open && focusedPane === 'prompt';
  const selectionOwner = useRef({ state, scope: sessionKey, editorRevision, enabled: navigationEnabled });
  useLayoutEffect(() => { selectionOwner.current = { state, scope: sessionKey, editorRevision, enabled: navigationEnabled }; });
  const consumedRequest = useRef(0);
  useLayoutEffect(() => {
    if (!navigationRequest || navigationRequest.revision <= consumedRequest.current) return;
    consumedRequest.current = navigationRequest.revision;
    if (!navigationEnabled || navigationRequest.scope !== sessionKey || navigationRequest.state !== state) return;
    navigationRevision.current += 1;
    setNavigationCommand({ revision: navigationRevision.current, key: navigationRequest.key, scope: sessionKey, editorRevision });
  }, [navigationRequest, navigationEnabled, sessionKey, state, editorRevision]);
  const serializedNavigationCommand = useMemo(() => JSON.stringify(navigationCommand), [navigationCommand]);
  const softwareKeyboardVisible = promptSoftwareKeyboardEnabled(softwareKeyboardRequested && !inputBlocked, focusedPane === 'prompt', state.mode);
  const attachmentSlotWidth = compact ? COMPACT_ATTACHMENT_SLOT_WIDTH : ATTACHMENT_SLOT_WIDTH;
  const visibleAttachmentSlots = Math.max(1, Math.min(attachments.length, Math.floor((attachmentSpaceWidth - (compact ? 0 : MIN_TOOLBAR_FREE_SPACE)) / attachmentSlotWidth)));
  const routeToolbarKey = (key: PromptToolbarNavigationKey | 'escape') => onHardwareKey(promptToolbarKeyEvent(key));
  const navigationTarget = (key: PromptToolbarNavigationKey) => promptToolbarNavigationTarget(key, { commandLineActive, commandHistoryActive });
  const navigateFromToolbar = (key: PromptToolbarNavigationKey) => {
    const target = navigationTarget(key);
    if (target === 'inert') return;
    if (target !== 'prompt') { onCommandHistory(target === 'command-history-older' ? -1 : 1); return; }
    onRequestPromptFocus();
    navigationRevision.current += 1;
    setNavigationCommand({ revision: navigationRevision.current, key });
  };
  return (
    <PromptDropSurface sessionKey={sessionKey} enabled={!importing && !attachmentLimitReached && (dropEnabled ?? !inputBlocked) && !commandLineActive && !historyBrowser.open} onDrop={onDrop} style={[styles.root, { height }, focusedPane === 'prompt' && !inputBlocked && (state.mode === 'insert' ? styles.insertFocus : styles.normalFocus)]}>
      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <PromptToolbarButton label="Attach images" symbol="photo.badge.plus" fallback="▣＋" compact={compact} disabled={importing || attachmentLimitReached} onPress={onPickImage} />
        <PromptToolbarButton label="Attach files" symbol="paperclip" fallback="⌁" compact={compact} disabled={importing || attachmentLimitReached} onPress={onPickDocument} />
        <View style={styles.attachmentSpace} onLayout={({ nativeEvent }) => setAttachmentSpaceWidth(nativeEvent.layout.width)}>
          {attachments.length ? <PromptAttachmentRail attachments={attachments} compact={compact} visibleSlots={visibleAttachmentSlots} onPreviewAttachment={onPreviewAttachment} onRemoveAttachment={onRemoveAttachment} /> : null}
          {compact ? null : <Text numberOfLines={1} style={styles.hint}>{promptModeHint(state)}</Text>}
        </View>
        <PromptToolbarButton label={historyBrowser.open ? 'Close prompt history' : 'Open prompt history'} symbol="clock.arrow.circlepath" fallback="↶" compact={compact} selected={historyBrowser.open} onPress={() => { setNavigationExpanded(false); onRequestPromptFocus(); onToggleHistory(); }} />
        <PromptToolbarButton label="Open colon command" text=":" compact={compact} onPress={() => { setNavigationExpanded(false); onCloseHistory(); onOpenCommand(); }} />
        <PromptToolbarButton label="Start new thread" symbol="plus.bubble" fallback="＋" compact={compact} onPress={() => { setNavigationExpanded(false); onCloseHistory(); onOpenNewThread(); }} />
        <PromptToolbarButton label="Escape" symbol="escape" fallback="esc" compact={compact} onPress={() => { setNavigationExpanded(false); if (historyBrowser.open) onCloseHistory(); else { onRequestPromptFocus(); routeToolbarKey('escape'); } }} />
        <PromptToolbarButton label={navigationExpanded ? 'Hide navigation keys' : 'Show navigation keys'} symbol="ellipsis" fallback="•••" compact={compact} selected={navigationExpanded} onPress={() => { onCloseHistory(); setNavigationExpanded((current) => !current); }} />
        {sending ? <PromptToolbarButton label="Stop run" symbol="stop.fill" fallback="■" compact={compact} tone="danger" wide onPress={onAbort} /> : null}
        <PromptToolbarButton label={sending ? 'Send prompt to active run' : 'Send prompt'} symbol="arrow.up.circle.fill" fallback="↑" compact={compact} disabled={importing || historyBrowser.open || (!state.text.trim() && !attachments.length)} prominent wide onPress={onSubmit} />
      </View>
      <PromptHistoryBrowserPanel state={historyBrowser} height={height} compact={compact} onCancel={onCloseHistory} onAccept={onAcceptHistory} />
      {navigationExpanded ? <View accessibilityRole="toolbar" accessibilityLabel="Vim navigation keys" style={[styles.navigationFlyout, compact && styles.navigationFlyoutCompact]}>
        {PROMPT_TOOLBAR_NAVIGATION_KEYS.map((key) => { const target = navigationTarget(key); return <PromptToolbarButton key={key} label={NAVIGATION_LABELS[target] ?? `Move ${key}`} symbol={NAVIGATION_SYMBOLS[key]} fallback={NAVIGATION_FALLBACKS[key]} compact={compact} disabled={target === 'inert'} onPress={() => navigateFromToolbar(key)} />; })}
      </View> : null}
      <View style={styles.editorShell}>
        <VimicateEditorView
          focused={keyboardCapture && (!commandLineActive || !commandLineNativeInputActive)}
          cursorVisible={!inputBlocked && !commandLineActive && !historyBrowser.open && focusedPane === 'prompt'}
          captureAllKeys={inputBlocked || commandLineActive || historyBrowser.open || focusedPane !== 'prompt'}
          routePastedTextExternally={commandLineActive}
          softwareKeyboardEnabled={softwareKeyboardVisible}
          softwareKeyboardForced={softwareKeyboardForced}
          repeatAuthority={focusedPane}
          editorState={editorState}
          navigationCommand={serializedNavigationCommand}
          fontSize={14 * fontScale}
          onEditorTap={({ nativeEvent }) => { onFocusPrompt({ start: nativeEvent.selectionStart, end: nativeEvent.selectionEnd }); }}
          onHardwareKeyboardChange={({ nativeEvent }) => onHardwareKeyboardChange(nativeEvent.connected)}
          onHardwareKey={({ nativeEvent }) => onHardwareKey(nativeEvent)}
          onPastedAttachment={({ nativeEvent }) => onPastedAttachment(nativeEvent)}
          onPastedText={({ nativeEvent }) => onPastedCommandLineText(nativeEvent.text)}
          onTextChange={({ nativeEvent }) => onState((current) => acceptNativeText(current, nativeEvent.text, { start: nativeEvent.selectionStart, end: nativeEvent.selectionEnd }, nativeEvent.textAuthority))}
          onSelectionChange={({ nativeEvent }) => onState((current) => {
            if (nativeEvent.editorRevision !== undefined || nativeEvent.scope !== undefined) {
              const owner = selectionOwner.current;
              if (!owner.enabled || current !== owner.state || nativeEvent.scope !== owner.scope || nativeEvent.editorRevision !== owner.editorRevision) return current;
            }
            return acceptNativeSelection(current, { start: nativeEvent.selectionStart, end: nativeEvent.selectionEnd }, nativeEvent.userInitiated);
          })}
          style={styles.editor}
        />
      </View>
    </PromptDropSurface>
  );
}


const NAVIGATION_SYMBOLS: Record<PromptToolbarNavigationKey, SFSymbol> = { left: 'arrow.left', down: 'arrow.down', up: 'arrow.up', right: 'arrow.right' };
const NAVIGATION_FALLBACKS: Record<PromptToolbarNavigationKey, string> = { left: '←', down: '↓', up: '↑', right: '→' };
const NAVIGATION_LABELS: Partial<Record<PromptToolbarNavigationTarget, string>> = { 'command-history-older': 'Recall older command', 'command-history-newer': 'Recall newer command' };

function PromptToolbarButton({ label, symbol, fallback = '', text, compact, disabled = false, prominent = false, selected = false, wide = false, tone = 'keycap', onPress }: { label: string; symbol?: SFSymbol; fallback?: string; text?: string; compact: boolean; disabled?: boolean; prominent?: boolean; selected?: boolean; wide?: boolean; tone?: 'keycap' | 'danger'; onPress: () => void }) {
  const tint = prominent ? colors.canvas : tone === 'danger' ? colors.red : colors.inkMuted;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, expanded: label.includes('navigation keys') ? selected : undefined, selected }} disabled={disabled} hitSlop={4} onPress={onPress} style={[styles.toolButton, compact && styles.toolButtonCompact, wide && styles.toolButtonWide, wide && compact && styles.toolButtonWideCompact, prominent && styles.toolButtonProminent, selected && styles.toolButtonSelected, tone === 'danger' && styles.toolButtonDanger, disabled && styles.disabledTool]}>{symbol ? <SymbolView name={symbol} size={prominent ? 17 : 15} weight="bold" tintColor={tint} fallback={<Text style={[styles.symbolFallback, { color: tint }]}>{fallback}</Text>} style={styles.symbol} /> : <Text style={[styles.keyText, { color: tint }]}>{text}</Text>}</Pressable>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, insertFocus: { borderWidth: 2, borderColor: colors.activeAccent }, normalFocus: { borderWidth: 2, borderColor: colors.activeAccent },
  toolbar: { height: 42, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7, zIndex: 5 }, toolbarCompact: { height: 40, paddingHorizontal: 6, gap: 4 }, attachmentSpace: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0, overflow: 'hidden' },
  toolButton: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.raised }, toolButtonCompact: { width: 30, height: 29 }, toolButtonWide: { width: 46 }, toolButtonWideCompact: { width: 34 }, toolButtonProminent: { borderColor: colors.activeAccent, backgroundColor: colors.activeAccent }, toolButtonDanger: { borderColor: colors.red }, disabledTool: { opacity: 0.35 }, symbol: { width: 19, height: 19 }, symbolFallback: { fontFamily: type.mono, fontSize: 12, fontWeight: '800', textAlign: 'center' }, hint: { flex: 1, minWidth: 0, color: colors.faint, fontFamily: type.mono, fontSize: 9 }, editorShell: { flex: 1, minHeight: 0 }, editor: { flex: 1 },
  toolButtonSelected: { borderColor: colors.yellow, backgroundColor: colors.inset }, keyText: { fontFamily: type.mono, fontSize: 11, fontWeight: '800', textAlign: 'center' }, navigationFlyout: { position: 'absolute', zIndex: 8, top: 41, right: 60, flexDirection: 'row', gap: 4, padding: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.inset }, navigationFlyoutCompact: { top: 39, right: 51 },
});
