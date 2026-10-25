// Simulator-only native geometry probe. No Gateway, storage or production entry.
import React, { useRef, useState } from 'react';
import { Button, Keyboard, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SoftwareKeyboardViewport } from '../../src/layout/SoftwareKeyboardViewport';
import { BottomSafeAreaChrome } from '../../src/app/BottomSafeAreaChrome';
function Probe() {
  const editor = useRef<TextInput>(null);
  const footer = useRef<View>(null);
  const [measurement, setMeasurement] = useState('not measured');
  const insets = useSafeAreaInsets();
  const measure = () => footer.current?.measureInWindow((_x, y, _width, height) => {
    const keyboard = Keyboard.metrics();
    setMeasurement(keyboard ? `Keyboard gap: ${(keyboard.screenY - y - height).toFixed(1)}pt` : 'Keyboard hidden');
  });
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#1d2021' }} edges={['top', 'left', 'right']}>
    <SoftwareKeyboardViewport>
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ color: 'white', fontSize: 18 }}>Keyboard/footer QA</Text>
        <Text accessibilityLabel="Measured keyboard gap" style={{ color: '#ffee88', fontSize: 18 }}>{measurement} · home inset {insets.bottom}pt</Text>
        <Button title="Open keyboard" onPress={() => editor.current?.focus()} />
        <Button title="Measure gap" onPress={measure} />
        <Button title="Close keyboard" onPress={() => Keyboard.dismiss()} />
        <TextInput ref={editor} accessibilityLabel="Isolated keyboard fixture draft" multiline defaultValue="Fixture draft remains intact." style={{ flex: 1, color: 'white', backgroundColor: '#282828' }} />
      </View>
      <BottomSafeAreaChrome><View ref={footer} collapsable={false} style={{ height: 40, backgroundColor: '#aabb22', justifyContent: 'center' }}><Text>Footer controls</Text></View></BottomSafeAreaChrome>
    </SoftwareKeyboardViewport>
  </SafeAreaView>;
}
export default function KeyboardFooterGapProbe() { return <SafeAreaProvider><Probe /></SafeAreaProvider>; }
