// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('native command and search input ownership', () => {
  it('routes unmodified Up/Down to command recall without taking arrows from search', () => {
    const input = source('modules/vimicate-editor/ios/VimicateCommandInputView.swift');
    const module = source('modules/vimicate-editor/ios/VimicateCommandInputModule.swift');
    const bar = source('src/ui/WorkspaceCommandBar.tsx');
    expect(input).toContain('let historyCommands = historyEnabled ? [');
    expect(input).toContain('UIKeyCommand.inputUpArrow, modifierFlags: []');
    expect(input).toContain('UIKeyCommand.inputDownArrow, modifierFlags: []');
    expect(input).toContain('onHistory(["direction": direction])');
    expect(module).toContain('"onHistory"');
    expect(bar).toContain('historyEnabled={Boolean(command)}');
    expect(bar).toContain('onHistory(nativeEvent.direction)');
  });

  it('keeps Escape and Ctrl-[ on the focused iOS text-field responder path', () => {
    const input = source('modules/vimicate-editor/ios/VimicateCommandInputView.swift');
    expect(input).toContain('UIKeyCommand.inputEscape');
    expect(input).toContain('input: "["');
    expect(input).toContain('modifierFlags: .control');
    expect(input).toContain('onCancel()');
    expect(input).toContain('wantsPriorityOverSystemBehavior = true');
    expect(input).toContain('override func pressesBegan');
    expect(input).toContain('key.keyCode == .keyboardEscape');
    expect(input).toContain('override func insertText(_ text: String)');
    expect(input).toContain('text.unicodeScalars.first?.value == 0x1B');
    expect(input).toContain('super.insertText(text)');
  });

  it('bridges the prompt-to-command focus handoff with one native responder owner', () => {
    const input = source('modules/vimicate-editor/ios/VimicateCommandInputView.swift');
    expect(input.match(/override var keyCommands/g)).toHaveLength(1);
    expect(input).toContain('if !input.becomeFirstResponder()');
    expect(input).toContain('UIWindow.didBecomeKeyNotification');
    expect(input).toContain('UIApplication.didBecomeActiveNotification');
    expect(input).toContain('guard !cancellationPublished else { return }');
    expect(input).toContain('onCancel([:])');
  });

  it('gives every mounted command line one focused native responder', () => {
    const bar = source('src/ui/WorkspaceCommandBar.tsx');
    const prompt = source('src/prompt/PromptPane.tsx');
    const shell = source('src/app/AppShell.tsx');
    const input = source('modules/vimicate-editor/ios/VimicateCommandInputView.swift');
    expect(bar).toMatch(/<VimicateCommandInputView\s+active\s/);
    expect(prompt).toContain('focused={keyboardCapture && (!commandLineActive || !commandLineNativeInputActive)}');
    expect(shell).toContain('commandLineNativeInputActive={Boolean(command || search)}');
    expect(input).toContain('Every mounted command/search line owns the native responder');
    expect(input).not.toContain('VimicateCommandLineCancelHardwarePress');
  });

  it('uses the native command leaf for both colon commands and pane search', () => {
    const bar = source('src/ui/WorkspaceCommandBar.tsx');
    expect(bar).toContain('<VimicateCommandInputView');
    expect(bar).toContain('onCancel={onCancel}');
    expect(bar).toContain('onSubmit={onSubmit}');
    expect(bar).toContain('const softwareKeyboardEnabled = search?.softwareKeyboardEnabled ?? command?.softwareKeyboardEnabled ?? false;');
    expect(bar).toContain('softwareKeyboardEnabled={softwareKeyboardEnabled}');
    expect(bar).not.toContain('<TextInput');
  });

  it('suppresses software input for hardware-opened search while preserving touch command entry', () => {
    const input = source('modules/vimicate-editor/ios/VimicateCommandInputView.swift');
    const module = source('modules/vimicate-editor/ios/VimicateCommandInputModule.swift');
    const shell = source('src/app/AppShell.tsx');
    expect(input).toContain('softwareKeyboardEnabled && GCKeyboard.coalesced == nil');
    expect(input).toContain('input.inputView = shouldShow ? nil : hardwareCaptureInputView');
    expect(input).toContain('acceptanceForcesSoftwareKeyboard');
    expect(module).toContain('Prop("softwareKeyboardEnabled")');
    expect(shell).toContain("setSearch({ scope, query: '', direction, softwareKeyboardEnabled: false })");
    expect(shell).toContain("setCommand({ query: '', softwareKeyboardEnabled: true })");
  });

  it('does not leave an empty UIKit input-assistant bar below the command line', () => {
    const input = source('modules/vimicate-editor/ios/VimicateCommandInputView.swift');
    expect(input).toContain('input.inputAssistantItem.leadingBarButtonGroups = []');
    expect(input).toContain('input.inputAssistantItem.trailingBarButtonGroups = []');
    expect(input).toContain('input.inputAssistantItem.allowsHidingShortcuts = true');
  });


});
