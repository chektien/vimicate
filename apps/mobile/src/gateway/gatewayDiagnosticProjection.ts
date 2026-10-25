export function isAssistantProjectionDiagnostic(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /(?:^|\b)(?:error:\s*)?content=text=.*\brole=assistant\b.*\btimestamp=/i.test(normalized);
}
