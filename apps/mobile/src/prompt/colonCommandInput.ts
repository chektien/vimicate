/** Commands occupy one line; pasted reports/code remain literal prompt text. */
export function colonCommandInput(input: string): string | null {
  if (/[\r\n\u2028\u2029]/.test(input)) return null;
  const text = input.trim();
  return /^:[a-z][a-z0-9_-]*(?:[ \t]+.*)?$/i.test(text) ? text : null;
}
