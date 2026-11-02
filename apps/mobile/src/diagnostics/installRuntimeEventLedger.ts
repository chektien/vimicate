import { AppState } from 'react-native';
import { recordRuntimeEvent } from './runtimeEventLedger';

type LedgerGlobal = typeof globalThis & { __vimicateRuntimeEventLedgerInstalled?: boolean };

/**
 * Records launches, foreground/background transitions and iOS memory warnings.
 * A launch that follows foreground activity with no background entry points at
 * a kill or native crash that the JS fatal breadcrumb cannot see.
 */
export function installRuntimeEventLedger() {
  const ledgerGlobal = globalThis as LedgerGlobal;
  if (ledgerGlobal.__vimicateRuntimeEventLedgerInstalled) return;
  ledgerGlobal.__vimicateRuntimeEventLedgerInstalled = true;
  try {
    recordRuntimeEvent('launch');
    AppState.addEventListener('memoryWarning', () => recordRuntimeEvent('memory-warning'));
    AppState.addEventListener('change', (state) => {
      if (state === 'active' || state === 'background') recordRuntimeEvent(state === 'active' ? 'foreground' : 'background');
    });
  } catch { /* Diagnostics must never block application startup. */ }
}
