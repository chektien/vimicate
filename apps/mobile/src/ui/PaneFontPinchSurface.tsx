import { useRef, type ReactNode } from 'react';
import { View, type GestureResponderEvent, type NativeTouchEvent, type StyleProp, type ViewStyle } from 'react-native';
import { paneFontPinchStep } from './paneFontPinch';

export function PaneFontPinchSurface({ children, onStep, style }: { children: ReactNode; onStep: (direction: 1 | -1) => void; style?: StyleProp<ViewStyle> }) {
  const startDistance = useRef(0);
  const deliveredStep = useRef(0);

  const reset = () => {
    startDistance.current = 0;
    deliveredStep.current = 0;
  };
  const begin = (event: GestureResponderEvent) => {
    startDistance.current = touchDistance(event.nativeEvent.touches);
    deliveredStep.current = 0;
  };
  const move = (event: GestureResponderEvent) => {
    const distance = touchDistance(event.nativeEvent.touches);
    if (!distance) return;
    if (!startDistance.current) {
      startDistance.current = distance;
      return;
    }
    const targetStep = paneFontPinchStep(startDistance.current, distance);
    const delta = targetStep - deliveredStep.current;
    if (!delta) return;
    const direction: 1 | -1 = delta > 0 ? 1 : -1;
    for (let index = 0; index < Math.min(8, Math.abs(delta)); index += 1) onStep(direction);
    deliveredStep.current = targetStep;
  };

  return <View
    style={[{ flex: 1, minHeight: 0 }, style]}
    onStartShouldSetResponderCapture={(event) => event.nativeEvent.touches.length === 2}
    onMoveShouldSetResponderCapture={(event) => event.nativeEvent.touches.length === 2}
    onResponderGrant={begin}
    onResponderMove={move}
    onResponderRelease={reset}
    onResponderTerminate={reset}
    onResponderTerminationRequest={() => false}
  >{children}</View>;
}

function touchDistance(touches: readonly NativeTouchEvent[]) {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return 0;
  return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
}
