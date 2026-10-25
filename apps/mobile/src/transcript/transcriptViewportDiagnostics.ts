export type TranscriptViewportDiagnosticEvent =
  | 'blank-content'
  | 'blank-check'
  | 'blank-schedule'
  | 'content'
  | 'dataset'
  | 'fold-hold'
  | 'layout'
  | 'layout-burst'
  | 'mode'
  | 'off-content'
  | 'partial-content'
  | 'reveal'
  | 'review-hold'
  | 'scroll'
  | 'visible'
  | 'writer';

export type TranscriptViewportDiagnosticFields = Readonly<{
  sourceCursor?: number;
  renderCursor?: number;
  requested?: number;
  target?: number;
  itemCount?: number;
  first?: number | null;
  last?: number | null;
  offset?: number;
  positionPermille?: number;
  actualPermille?: number | undefined;
  contentHeight?: number;
  viewportHeight?: number;
  viewportWidth?: number;
  layoutCommits?: number;
  sourceCommits?: number;
  topologyChanges?: number;
  presentationChanges?: number;
  firstItemOffset?: number;
  tail?: boolean;
  userScroll?: boolean;
  reset?: boolean;
  mounted?: boolean;
  work?: string;
  block?: string;
  action?: 'cancel-indexed' | 'cancel-post-layout' | 'cancel-revision-reveal' | 'cancel-tail' | 'confirm-review' | 'correct-review' | 'drop-indexed' | 'drop-post-layout' | 'drop-tail' | 'exhaust-review' | 'fallback-offset' | 'fallback-review' | 'indexed' | 'indexed-failed' | 'indexed-fallback' | 'indexed-offset' | 'noop' | 'older-anchor' | 'queue-post-layout' | 'queue-revision-reveal' | 'queue-tail' | 'release-review' | 'review-complete' | 'run-post-layout' | 'run-revision-reveal' | 'run-tail' | 'tail-failed';
  reason?: 'content' | 'dataset' | 'drag' | 'fold' | 'geometry' | 'navigation' | 'recovery' | 'revision' | 'tail';
}>;

const DEFAULT_INTERVAL_MS = 250;
const ANOMALY_INTERVAL_MS = 1_000;

export function transcriptBlankViewportDecline(state: {
  userScrollActive: boolean; pendingDatasetReset: boolean; viewportWorkPending: boolean;
  itemCount: number; hasMountedVisibleCells: boolean; contentHeight: number; viewportHeight: number;
}) {
  if (state.userScrollActive) return 'userScrollActive';
  if (state.pendingDatasetReset) return 'pendingDatasetReset';
  if (state.viewportWorkPending) return 'viewportWorkPending';
  if (state.itemCount <= 0) return 'itemCount';
  if (state.hasMountedVisibleCells) return 'hasMountedVisibleCells';
  if (state.contentHeight <= 0) return 'contentHeight';
  if (state.viewportHeight <= 0) return 'viewportHeight';
  return null;
}

export function transcriptViewportDiagnosticFields(
  current: { itemCount: number; recoveryRow: number; sourceCursorRow: number },
  visible: { first: number; last: number } | null,
  metrics: { offset: number; contentHeight: number; viewportHeight: number },
  tail: boolean,
  userScroll: boolean,
) {
  return {
    sourceCursor: current.sourceCursorRow, renderCursor: current.recoveryRow,
    itemCount: current.itemCount, first: visible?.first ?? null, last: visible?.last ?? null,
    ...metrics, tail, userScroll,
  };
}

function opaqueDatasetID(value: string) {
  // FNV-1a is deliberately an opaque correlation label, not identity or
  // security material. Raw session keys, project names and paths never leave
  // this module.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function finiteInteger(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value);
}

export function createTranscriptViewportDiagnostics(
  datasetKey: string,
  sink: (message: string) => void,
  now: () => number = Date.now,
) {
  const dataset = opaqueDatasetID(datasetKey);
  const lastAt = new Map<TranscriptViewportDiagnosticEvent, number>();
  const lastMessage = new Map<TranscriptViewportDiagnosticEvent, string>();

  return {
    record(event: TranscriptViewportDiagnosticEvent, fields: TranscriptViewportDiagnosticFields = {}, force = false) {
      const parts = [
        event,
        `ds=${dataset}`,
        ['s', finiteInteger(fields.sourceCursor)],
        ['r', finiteInteger(fields.renderCursor)],
        ['q', finiteInteger(fields.requested)],
        ['t', finiteInteger(fields.target)],
        ['n', finiteInteger(fields.itemCount)],
        ['v', fields.first === null || fields.last === null ? 'none' : fields.first === undefined || fields.last === undefined ? undefined : `${finiteInteger(fields.first)}-${finiteInteger(fields.last)}`],
        ['o', finiteInteger(fields.offset)],
        ['p', finiteInteger(fields.positionPermille)],
        ['a', finiteInteger(fields.actualPermille)],
        ['h', finiteInteger(fields.contentHeight)],
        ['vh', finiteInteger(fields.viewportHeight)],
        ['w', finiteInteger(fields.viewportWidth)],
        ['lc', finiteInteger(fields.layoutCommits)],
        ['pc', finiteInteger(fields.sourceCommits)],
        ['dc', finiteInteger(fields.topologyChanges)],
        ['rc', finiteInteger(fields.presentationChanges)],
        ['i', finiteInteger(fields.firstItemOffset)],
        ['f', fields.tail === undefined ? undefined : fields.tail ? 1 : 0],
        ['drag', fields.userScroll === undefined ? undefined : fields.userScroll ? 1 : 0],
        ['reset', fields.reset === undefined ? undefined : fields.reset ? 1 : 0],
        ['mounted', fields.mounted === undefined ? undefined : fields.mounted ? 1 : 0],
        ['work', fields.work],
        ['block', fields.block],
        ['act', fields.action],
        ['why', fields.reason],
      ].flatMap((entry) => typeof entry === 'string' ? [entry] : entry[1] === undefined ? [] : [`${entry[0]}=${entry[1]}`]);
      const message = parts.join(' ');
      const timestamp = now();
      const interval = event === 'off-content' || event === 'blank-content' || event === 'blank-check' || event === 'blank-schedule' ? ANOMALY_INTERVAL_MS : DEFAULT_INTERVAL_MS;
      if (!force && lastMessage.get(event) === message && timestamp - (lastAt.get(event) ?? -Infinity) < interval) return false;
      if (!force && event !== 'blank-check' && event !== 'blank-schedule' && timestamp - (lastAt.get(event) ?? -Infinity) < interval) return false;
      lastAt.set(event, timestamp);
      lastMessage.set(event, message);
      sink(message);
      return true;
    },
  };
}
