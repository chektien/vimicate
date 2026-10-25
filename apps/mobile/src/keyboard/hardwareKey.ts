export type HardwareKeyShape = { key: string; shift?: boolean };

const SHIFTED: Record<string, string> = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
  '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~',
};

/** Converts UIKit's charactersIgnoringModifiers plus modifier flags to Vim's key. */
export function normalizedHardwareKey(input: HardwareKeyShape) {
  if (!input.shift || input.key.length !== 1) return input.key;
  return SHIFTED[input.key] ?? input.key.toUpperCase();
}

export function hardwareTextCharacter(input: HardwareKeyShape) {
  const key = normalizedHardwareKey(input);
  return key.length === 1 ? key : '';
}
