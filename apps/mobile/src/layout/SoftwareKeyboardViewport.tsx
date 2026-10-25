import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Keyboard, Platform, StyleSheet, View, type KeyboardEvent, type LayoutChangeEvent } from 'react-native';
import { SoftwareKeyboardInsetContext } from './softwareKeyboardInsetContext';
import { keyboardViewportInset, usesManagedKeyboardViewport, type KeyboardViewportBounds } from './softwareKeyboardViewportPolicy';

export function SoftwareKeyboardViewport({ children }: PropsWithChildren) {
  const root = useRef<View>(null);
  const bounds = useRef<KeyboardViewportBounds>({ y: 0, height: 0 });
  const keyboardEvent = useRef<KeyboardEvent | null>(null);
  const active = useRef(AppState.currentState === 'active');
  const [bottomInset, setBottomInset] = useState(0);

  const publishInset = useCallback((event: KeyboardEvent | null = keyboardEvent.current) => {
    const next = event ? keyboardViewportInset(bounds.current, event.endCoordinates, {
      active: active.current,
      local: event.isEventFromThisApp,
    }) : 0;
    if (event && next > 0) Keyboard.scheduleLayoutAnimation(event);
    setBottomInset((current) => current === next ? current : next);
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const fallback = event.nativeEvent.layout;
    bounds.current = { y: fallback.y, height: fallback.height };
    publishInset();
    root.current?.measureInWindow((_x, y, _width, height) => {
      bounds.current = { y, height };
      publishInset();
    });
  }, [publishInset]);

  useEffect(() => {
    if (!usesManagedKeyboardViewport(Platform.OS)) return;
    const receiveFrame = (event: KeyboardEvent) => {
      if (event.isEventFromThisApp === false) {
        keyboardEvent.current = null;
        publishInset(null);
        return;
      }
      keyboardEvent.current = event;
      publishInset(event);
    };
    const shown = Keyboard.addListener('keyboardWillShow', receiveFrame);
    const changed = Keyboard.addListener('keyboardWillChangeFrame', receiveFrame);
    const hidden = Keyboard.addListener('keyboardWillHide', () => {
      keyboardEvent.current = null;
      publishInset(null);
    });
    const appState = AppState.addEventListener('change', (next) => {
      active.current = next === 'active';
      // Scene inactivity suppresses layout, not knowledge of a local keyboard.
      // iOS may restore its frame before 'active', or emit no second show event.
      // Explicit hide/foreign-frame notifications still retire that knowledge.
      publishInset(active.current ? keyboardEvent.current : null);
    });
    return () => {
      shown.remove();
      changed.remove();
      hidden.remove();
      appState.remove();
    };
  }, [publishInset]);

  return (
    <SoftwareKeyboardInsetContext value={bottomInset}>
      <View ref={root} onLayout={onLayout} style={[styles.root, bottomInset > 0 && { paddingBottom: bottomInset }]}>
        {children}
      </View>
    </SoftwareKeyboardInsetContext>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
