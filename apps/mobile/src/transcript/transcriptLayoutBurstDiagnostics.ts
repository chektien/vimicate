import type { TranscriptViewportDiagnosticFields } from './transcriptViewportDiagnostics';

// Count synchronous layout feedback, not elapsed-time activity. This observer
// never schedules React work or changes list geometry.
export function createTranscriptLayoutBurstDiagnostics(
  record: (fields: TranscriptViewportDiagnosticFields) => void,
  defer: (callback: () => void) => void = queueMicrotask,
) {
  let lifetime: object | null = null;
  let topology: object | null = null;
  let presentation: object | null = null;
  let burst: { layoutCommits: number; sourceCommits: number; topologyChanges: number; presentationChanges: number } | null = null;
  const currentBurst = () => {
    if (!lifetime) return null;
    if (!burst) {
      const owner = lifetime;
      const next = { layoutCommits: 0, sourceCommits: 0, topologyChanges: 0, presentationChanges: 0 };
      burst = next;
      defer(() => { if (lifetime === owner && burst === next) burst = null; });
    }
    return burst;
  };
  return {
    activate() {
      const owner = {};
      lifetime = owner; burst = null; topology = null; presentation = null;
      return () => {
        if (lifetime !== owner) return;
        lifetime = null; burst = null; topology = null; presentation = null;
      };
    },
    sourceCommit(nextTopology: object, nextPresentation: object) {
      const current = currentBurst();
      if (!current) return;
      current.sourceCommits++;
      if (topology !== nextTopology) current.topologyChanges++;
      if (presentation !== nextPresentation) current.presentationChanges++;
      topology = nextTopology; presentation = nextPresentation;
    },
    layoutCommit(readGeometry: () => TranscriptViewportDiagnosticFields) {
      const current = currentBurst();
      if (!current || current.layoutCommits >= 48) return;
      current.layoutCommits++;
      if (![8, 16, 32, 48].includes(current.layoutCommits)) return;
      // Telemetry must not turn a missing/disposed native ref into a crash.
      try { record({ ...readGeometry(), ...current }); } catch { /* observation only */ }
    },
  };
}
