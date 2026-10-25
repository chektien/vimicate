type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object';
const coordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 1e12;

// RN 0.86's exception decorator supplies the originating JS stack, unlike its
// native fatal message's component stack. Keep coordinates, never rawStack or
// arbitrary exception payloads. This owner does not change error propagation.
export function reactFatalDiagnostic(data: unknown): { summary: string; frames: string[] } | null {
  if (!record(data) || data.isFatal !== true || typeof data.message !== 'string' || !Array.isArray(data.stack)) return null;
  const frames: string[] = [];
  for (const frame of data.stack.slice(0, 16)) {
    if (!record(frame) || typeof frame.methodName !== 'string' || typeof frame.file !== 'string'
      || !coordinate(frame.lineNumber) || !coordinate(frame.column)) continue;
    const name = frame.methodName.slice(0, 96);
    const file = frame.file.slice(0, 4096).split(/[?#]/, 1)[0]!.replace(/\\/g, '/').split('/').at(-1)!.slice(0, 64);
    if (!/^[A-Za-z_$][A-Za-z0-9_$.<> -]*$/.test(name) || !file || /[\r\n():]/.test(file)) continue;
    frames.push(`at ${name} (${file}:${frame.lineNumber}:${frame.column})`);
  }
  return { summary: data.message.slice(0, 16_384).split(/[\r\n]/, 1)[0]!.slice(0, 220), frames };
}
