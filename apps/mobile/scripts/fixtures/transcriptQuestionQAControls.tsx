import React from 'react';
import { Pressable, Text } from 'react-native';
export const qaStyle = { color: '#ebdbb2', fontSize: 12 };
export const qaNoop = () => {};
export function qaButton(label: string, action: () => void) {
  return <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={action} style={{ padding: 8, backgroundColor: '#3c3836', margin: 2 }}><Text style={qaStyle}>{label}</Text></Pressable>;
}
