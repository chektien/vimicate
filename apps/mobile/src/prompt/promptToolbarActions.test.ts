import { describe, expect, it } from 'vitest';
import { PROMPT_TOOLBAR_NAVIGATION_KEYS, promptToolbarKeyEvent, promptToolbarNavigationTarget } from './promptToolbarActions';

describe('prompt toolbar actions', () => {
  it('exposes the requested Vim navigation key order', () => {
    expect(PROMPT_TOOLBAR_NAVIGATION_KEYS).toEqual(['left', 'down', 'up', 'right']);
  });

  it('routes a toolbar key through the ordinary hardware-key dispatcher', () => {
    expect(promptToolbarKeyEvent('escape')).toEqual({
      key: 'escape',
      shift: false,
      control: false,
      option: false,
      command: false,
      isRepeat: false,
    });
  });

  it('moves the prompt caret while no command line is open', () => {
    const inactive = { commandLineActive: false, commandHistoryActive: false };
    for (const key of PROMPT_TOOLBAR_NAVIGATION_KEYS) expect(promptToolbarNavigationTarget(key, inactive)).toBe('prompt');
  });

  it('recalls colon command history instead of moving the prompt caret', () => {
    const command = { commandLineActive: true, commandHistoryActive: true };
    expect(promptToolbarNavigationTarget('up', command)).toBe('command-history-older');
    expect(promptToolbarNavigationTarget('down', command)).toBe('command-history-newer');
    expect(promptToolbarNavigationTarget('left', command)).toBe('inert');
    expect(promptToolbarNavigationTarget('right', command)).toBe('inert');
  });

  it('leaves every arrow inert for a search line, which keeps no history', () => {
    const search = { commandLineActive: true, commandHistoryActive: false };
    for (const key of PROMPT_TOOLBAR_NAVIGATION_KEYS) expect(promptToolbarNavigationTarget(key, search)).toBe('inert');
  });
});
