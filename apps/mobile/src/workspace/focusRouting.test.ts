import { describe, expect, it } from 'vitest';
import { adjacentProjectKey, applyPaneShortcut, applyProjectNavigation, createFocusRouting, focusAfterProjectActivation, focusWorkspaceTarget, resolvePaneShortcutPrefix, type ProjectNavigationState } from './focusRouting';

const control = (key: string) => ({ key, control: true, shift: false, option: false, command: false });

describe('workspace focus routing', () => {
  it('matches native horizontal pane shortcuts and remembers the terminal surface', () => {
    const transcript = focusWorkspaceTarget(createFocusRouting(), 'transcript');
    const projects = applyPaneShortcut(transcript, control('h')).state;
    expect(projects.target).toBe('projects');
    expect(applyPaneShortcut(projects, control('l')).state.target).toBe('transcript');
    expect(applyPaneShortcut(createFocusRouting(), control('left')).state.target).toBe('projects');
  });

  it('opens closed Files from either center pane and navigates through an open pane', () => {
    const transcript = focusWorkspaceTarget(createFocusRouting(), 'transcript');
    const files = applyPaneShortcut(transcript, control('l'), { filesOpen: true, filesFocused: false });
    expect(files).toMatchObject({ state: transcript, handled: true, fileFocus: 'acquire' });

    const conversation = applyPaneShortcut(transcript, control('h'), { filesOpen: true, filesFocused: true });
    expect(conversation).toMatchObject({ state: transcript, handled: true, fileFocus: 'release' });

    const closed = applyPaneShortcut(transcript, control('l'), { filesOpen: false, filesFocused: false });
    expect(closed).toMatchObject({ state: transcript, handled: true, fileFocus: 'open' });
    expect(applyPaneShortcut(createFocusRouting('prompt'), control('l')).fileFocus).toBe('open');
  });

  it('accepts the classic control-w pane prefix outside Insert mode', () => {
    const prefix = resolvePaneShortcutPrefix(false, control('w'), true);
    expect(prefix).toMatchObject({ pending: true, input: null, consumed: true });
    const motion = resolvePaneShortcutPrefix(prefix.pending, { ...control('l'), control: false }, true);
    expect(motion).toMatchObject({ pending: false, input: { key: 'l', control: true }, consumed: false });
    expect(resolvePaneShortcutPrefix(true, { ...control('escape'), control: false }, true)).toMatchObject({ pending: false, input: { key: 'escape' } });
    expect(resolvePaneShortcutPrefix(false, control('w'), false)).toMatchObject({ pending: false, input: { key: 'w' }, consumed: false });
  });

  it('routes vertical split shortcuts from every pane', () => {
    const projects = focusWorkspaceTarget(createFocusRouting(), 'projects');
    expect(applyPaneShortcut(projects, control('k')).state.target).toBe('transcript');
    expect(applyPaneShortcut(projects, control('j')).state.target).toBe('prompt');
  });

  it('transfers both touch and keyboard project activation to the prompt', () => {
    const projects = focusWorkspaceTarget(createFocusRouting('transcript'), 'projects');
    expect(focusAfterProjectActivation(projects)).toEqual({ target: 'prompt', rememberedTerminal: 'prompt' });
  });

  it('moves the project cursor without wrapping or activating', () => {
    const keys = ['a', 'b', 'c'];
    expect(adjacentProjectKey(keys, 'a', 1)).toBe('b');
    expect(adjacentProjectKey(keys, 'b', -1)).toBe('a');
    expect(adjacentProjectKey(keys, 'c', 1)).toBe('c');
  });

  it('routes every project navigation key without activating on movement', () => {
    const keys = ['a', 'b', 'c'];
    let state: ProjectNavigationState = { focusedKey: 'a', prefix: '' };
    let result = applyProjectNavigation(keys, state, { key: 'j', shift: false, control: false, option: false, command: false });
    expect(result).toMatchObject({ state: { focusedKey: 'b', prefix: '' }, handled: true });
    expect(result.activateKey).toBeUndefined();
    state = result.state;
    result = applyProjectNavigation(keys, state, { key: 'down', shift: false, control: false, option: false, command: false });
    expect(result.state.focusedKey).toBe('c');
    result = applyProjectNavigation(keys, result.state, { key: 'k', shift: false, control: false, option: false, command: false });
    expect(result.state.focusedKey).toBe('b');
    result = applyProjectNavigation(keys, result.state, { key: 'up', shift: false, control: false, option: false, command: false });
    expect(result.state.focusedKey).toBe('a');
  });

  it('supports gg, shifted G, ordinals, and explicit activation', () => {
    const keys = ['a', 'b', 'c'];
    const base: ProjectNavigationState = { focusedKey: 'b', prefix: '' };
    const pending = applyProjectNavigation(keys, base, { key: 'g', shift: false, control: false, option: false, command: false });
    expect(applyProjectNavigation(keys, pending.state, { key: 'g', shift: false, control: false, option: false, command: false }).state.focusedKey).toBe('a');
    expect(applyProjectNavigation(keys, base, { key: 'g', shift: true, control: false, option: false, command: false }).state.focusedKey).toBe('c');
    expect(applyProjectNavigation(keys, base, { key: '3', shift: false, control: false, option: false, command: false }).activateKey).toBe('c');
    expect(applyProjectNavigation(keys, base, { key: 'enter', shift: false, control: false, option: false, command: false }).activateKey).toBe('b');
  });

  it('routes project-pane dd as one removal operator without activating the row', () => {
    const keys = ['root', 'child', 'other'];
    const base: ProjectNavigationState = { focusedKey: 'child', prefix: '' };
    const pending = applyProjectNavigation(keys, base, { key: 'd', shift: false, control: false, option: false, command: false });
    expect(pending).toMatchObject({ state: { focusedKey: 'child', prefix: 'd' }, handled: true });
    expect(pending.activateKey).toBeUndefined();
    expect(pending.removeKey).toBeUndefined();

    const removed = applyProjectNavigation(keys, pending.state, { key: 'd', shift: false, control: false, option: false, command: false });
    expect(removed).toMatchObject({ state: { focusedKey: 'child', prefix: '' }, removeKey: 'child', handled: true });
    expect(removed.activateKey).toBeUndefined();

    const cancelled = applyProjectNavigation(keys, pending.state, { key: 'x', shift: false, control: false, option: false, command: false });
    expect(cancelled).toMatchObject({ state: { focusedKey: 'child', prefix: '' }, handled: true });
    expect(cancelled.removeKey).toBeUndefined();

    const modified = applyProjectNavigation(keys, base, { key: 'd', shift: false, control: false, option: false, command: true });
    expect(modified).toMatchObject({ state: base, handled: false });
    expect(modified.removeKey).toBeUndefined();
  });
});
