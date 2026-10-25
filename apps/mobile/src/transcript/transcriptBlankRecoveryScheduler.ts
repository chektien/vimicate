import { shouldRecoverTranscriptBlankViewport, shouldRestoreTranscriptTailRange, type VisibleTranscriptRange } from './transcriptViewportPolicy';
import { TranscriptBlankViewportRecoveryOwner } from './transcriptBlankViewportRecovery';
import { transcriptBlankViewportDecline, type TranscriptViewportDiagnosticEvent, type TranscriptViewportDiagnosticFields } from './transcriptViewportDiagnostics';

type Snapshot = {
  userScrollActive: boolean; pendingDatasetReset: boolean;
  writers: { tail: number | null; indexed: number | null; revision: number | null; postLayout: number | null; reviewRestore: boolean; olderHistory: boolean };
  itemCount: number; hasMountedVisibleCells: boolean; contentHeight: number; viewportHeight: number; offset: number;
  followTail: boolean; visible: VisibleTranscriptRange;
};

type ScheduleInput = {
  datasetKey: string; generation: unknown; ownsGeneration: (generation: unknown) => boolean;
  snapshot: () => Snapshot;
  record: (event: TranscriptViewportDiagnosticEvent, fields: TranscriptViewportDiagnosticFields, force?: boolean) => void;
  diagnosticFields: () => TranscriptViewportDiagnosticFields;
  recoverTailRange: (row: number) => void;
  recoverBlank: () => void;
};

/** Couples the bounded frame owner to blank-viewport policy and diagnostics. */
export class TranscriptBlankRecoveryScheduler {
  private readonly recovery: TranscriptBlankViewportRecoveryOwner;

  constructor(requestFrame: (callback: () => void) => number | null, cancelFrame: (frame: number) => void) {
    this.recovery = new TranscriptBlankViewportRecoveryOwner(requestFrame, cancelFrame);
  }

  schedule(input: ScheduleInput) {
    const scheduled = this.recovery.schedule(input.datasetKey, input.generation, input.ownsGeneration,
      () => {
        const state = input.snapshot();
        const work = [state.writers.tail !== null && 'tail', state.writers.indexed !== null && 'indexed',
          state.writers.revision !== null && 'revision', state.writers.postLayout !== null && 'post-layout',
          state.writers.reviewRestore && 'review-restore', state.writers.olderHistory && 'older-history'].filter(Boolean).join('+') || 'none';
        const guard = { ...state, viewportWorkPending: work !== 'none' };
        const blank = shouldRecoverTranscriptBlankViewport(guard.userScrollActive, guard.pendingDatasetReset,
          guard.viewportWorkPending, guard.itemCount, guard.hasMountedVisibleCells, guard.contentHeight, guard.viewportHeight);
        input.record('blank-check', { itemCount: state.itemCount, offset: state.offset,
          contentHeight: state.contentHeight, viewportHeight: state.viewportHeight, userScroll: state.userScrollActive,
          reset: state.pendingDatasetReset, mounted: state.hasMountedVisibleCells, work,
          block: blank ? 'none' : transcriptBlankViewportDecline(guard) ?? 'none' });
        return !state.writers.olderHistory
          && (blank || shouldRestoreTranscriptTailRange(state.followTail, state.userScrollActive, state.itemCount, state.visible));
      },
      () => {
        const state = input.snapshot();
        const tailRange = shouldRestoreTranscriptTailRange(state.followTail, state.userScrollActive, state.itemCount, state.visible);
        input.record(tailRange ? 'partial-content' : 'blank-content', { ...input.diagnosticFields(), reason: 'recovery' }, true);
        tailRange ? input.recoverTailRange(state.itemCount - 1) : input.recoverBlank();
      });
    const state = input.snapshot();
    input.record('blank-schedule', { itemCount: state.itemCount, offset: state.offset,
      contentHeight: state.contentHeight, viewportHeight: state.viewportHeight, block: scheduled });
  }

  settledVisible() { this.recovery.settledVisible(); }
  cancel() { this.recovery.cancel(); }
}
