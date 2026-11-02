import { expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ listeners: new Map<string, (state?: string) => void>(), events: [] as string[] }));
vi.mock('react-native', () => ({ AppState: { addEventListener: (type: string, listener: (state?: string) => void) => { probe.listeners.set(type, listener); return { remove: () => undefined }; } } }));
vi.mock('./runtimeEventLedger', () => ({ recordRuntimeEvent: (kind: string) => { probe.events.push(kind); } }));

it('records launch, foreground and background transitions and memory warnings once per process', async () => {
  const { installRuntimeEventLedger } = await import('./installRuntimeEventLedger');
  installRuntimeEventLedger(); installRuntimeEventLedger();
  probe.listeners.get('change')!('inactive');
  probe.listeners.get('change')!('background');
  probe.listeners.get('memoryWarning')!();
  probe.listeners.get('change')!('active');
  expect(probe.events).toEqual(['launch', 'background', 'memory-warning', 'foreground']);
});
