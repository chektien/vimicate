import { describe, expect, it } from 'vitest';
import { isAssistantProjectionDiagnostic } from './gatewayDiagnosticProjection';

describe('gateway diagnostic projection', () => {
  it('recognizes malformed assistant projection diagnostics only', () => {
    expect(isAssistantProjectionDiagnostic('error: content=text=search "x" role=assistant timestamp=1781229207542')).toBe(true);
    expect(isAssistantProjectionDiagnostic('provider error: quota exceeded')).toBe(false);
    expect(isAssistantProjectionDiagnostic('The text says role=assistant in documentation.')).toBe(false);
  });
});
