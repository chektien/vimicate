import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export type DiagnosticSnapshot = { appState: AppStateStatus; fps: number; device: string; build: string; events: string[]; record: (message: string) => void };
export function useDiagnostics(): DiagnosticSnapshot {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [fps, setFps] = useState(60);
  const [events, setEvents] = useState<string[]>([]);
  const frameRef = useRef({ count: 0, startedAt: Date.now(), raf: 0 });
  const record = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setEvents((current) => [`${stamp} ${message}`, ...current].slice(0, 80));
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => { setAppState(next); record(`scene -> ${next}`); });
    const tick = () => {
      const now = Date.now(); const frame = frameRef.current; frame.count += 1;
      if (now - frame.startedAt >= 1000) { setFps(Math.round((frame.count * 1000) / (now - frame.startedAt))); frame.count = 0; frame.startedAt = now; }
      frame.raf = requestAnimationFrame(tick);
    };
    frameRef.current.raf = requestAnimationFrame(tick);
    return () => { subscription.remove(); cancelAnimationFrame(frameRef.current.raf); };
  }, [record]);
  return { appState, fps, device: Device.modelName ?? Device.deviceName ?? 'iOS device', build: `${Application.nativeApplicationVersion ?? '0.1.0'} (${Application.nativeBuildVersion ?? 'dev'})`, events, record };
}
