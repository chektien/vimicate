import { useState } from 'react';
import { promptTouchRequestsSoftwareKeyboard } from './softwareKeyboardPolicy';
import type { Selection } from './vimPromptCore';

export function usePromptKeyboardController(enterAndFocus: (selection?: Selection) => void, leaveInsert: () => void) {
  const [requested, setRequested] = useState(false);
  const [hardwareConnected, setHardwareConnected] = useState(false);
  const activateFromTouch = (selection?: Selection) => {
    setRequested(promptTouchRequestsSoftwareKeyboard(hardwareConnected));
    enterAndFocus(selection);
  };
  const request = () => { setRequested(true); enterAndFocus(); };
  const hide = () => setRequested(false);
  const dismiss = () => { hide(); leaveInsert(); };
  const recordHardware = (connected: boolean) => {
    setHardwareConnected(connected);
    if (connected) hide();
  };
  return { requested, forced: requested && hardwareConnected, activateFromTouch, request, hide, dismiss, recordHardware };
}
