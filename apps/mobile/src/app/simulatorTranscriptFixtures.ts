import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

export const SIMULATOR_TRANSCRIPT_FIXTURE_MODE = 'qa-transcript-v1';
export const SIMULATOR_TRANSCRIPT_GEOMETRY_MODE = 'qa-transcript-history-geometry';
export const SIMULATOR_TRANSCRIPT_ROOT_MARKER = 'SIMTRANS-FIXTURE-ROOT';

export const SIMULATOR_TRANSCRIPT_MARKERS = {
  skillPositive: 'SIMTRANS-SKILL-POSITIVE',
  skillNegative: 'SIMTRANS-SKILL-NEGATIVE',
  skillInferred: 'SIMTRANS-SKILL-INFERRED',
  citationLink: 'SIMTRANS-CITATION-LINK',
  citationUnavailable: 'SIMTRANS-CITATION-UNAVAILABLE',
  citationInlineCode: 'SIMTRANS-CITATION-INLINE-CODE',
  citationFence: 'SIMTRANS-CITATION-FENCE',
  toolSecret: 'SIMTRANS-TOOL-DETAIL-SECRET',
  protocolAnswer: 'SIMTRANS-PROTOCOL-ANSWER',
  protocolSecret: 'SIMTRANS-PROTOCOL-DETAIL-SECRET',
  searchTarget: 'SIMTRANS-SEARCH-TARGET',
  historyInitialOldest: 'SIMTRANS-HISTORY-INITIAL-OLDEST',
  historyPageOneOldest: 'SIMTRANS-HISTORY-PAGE-1-OLDEST',
  historyPageOneApproach: 'SIMTRANS-HISTORY-PAGE-1-APPROACH',
  historyPageTwoOldest: 'SIMTRANS-HISTORY-PAGE-2-OLDEST',
  historyPageTwoApproach: 'SIMTRANS-HISTORY-PAGE-2-APPROACH',
  historyPageThree: 'SIMTRANS-HISTORY-PAGE-3-CASCADE',
} as const;

export const SIMULATOR_TRANSCRIPT_ACTIONABLE_FILE = 'simulator transcript report.docx';
export const SIMULATOR_TRANSCRIPT_UNAVAILABLE_FILE = 'unsupported-relative-result.txt';

const SESSION = 'agent:fixture:qa-transcript-v1';
const RUN = 'qa-transcript-v1-run';
export const SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT = 3;
export const SIMULATOR_TRANSCRIPT_HISTORY_PAGE_SIZE = 2;

function olderHistoryMessage(id: string, text: string, timestamp: string): WorkspaceMessage {
  return {
    id: `simulator-transcript-history-${id}`,
    role: 'assistant',
    text,
    source: 'history',
    state: 'complete',
    sessionKey: SESSION,
    runId: RUN,
    timestamp,
  };
}

const olderHistoryPages: readonly (readonly WorkspaceMessage[])[] = [
  [
    olderHistoryMessage('page-1-oldest', `${SIMULATOR_TRANSCRIPT_MARKERS.historyPageOneOldest}: retained first-page boundary.`, '2026-09-19T10:59:00+08:00'),
    olderHistoryMessage('page-1-approach', `${SIMULATOR_TRANSCRIPT_MARKERS.historyPageOneApproach}: one k reaches the oldest loaded stop.`, '2026-09-19T10:59:01+08:00'),
  ],
  [
    olderHistoryMessage('page-2-oldest', `${SIMULATOR_TRANSCRIPT_MARKERS.historyPageTwoOldest}: explicit second-k page.`, '2026-09-19T10:58:00+08:00'),
    olderHistoryMessage('page-2-approach', `${SIMULATOR_TRANSCRIPT_MARKERS.historyPageTwoApproach}: second-page retained row.`, '2026-09-19T10:58:01+08:00'),
  ],
  [
    olderHistoryMessage('page-3-oldest', `${SIMULATOR_TRANSCRIPT_MARKERS.historyPageThree}: this row proves an unintended request cascade.`, '2026-09-19T10:57:00+08:00'),
    olderHistoryMessage('page-3-approach', 'Third synthetic older-history page.', '2026-09-19T10:57:01+08:00'),
  ],
];

/**
 * One synthetic transcript plus bounded older pages exercises the production
 * projection, Markdown, fold, skill and buffer owners without pairing a
 * Gateway or injecting precomputed presentation results.
 */
export function simulatorTranscriptFixtureMessages(loadedOlderPageCount = 0): WorkspaceMessage[] {
  let sequence = 0;
  const message = (id: string, role: WorkspaceMessage['role'], text: string): WorkspaceMessage => ({
    id: `simulator-transcript-${id}`,
    role,
    text,
    source: 'history',
    state: 'complete',
    sessionKey: SESSION,
    runId: RUN,
    timestamp: `2026-09-19T11:00:${String(sequence++).padStart(2, '0')}+08:00`,
  });
  const projectedProtocol = messagesFromPayload({
    sessionKey: SESSION,
    messages: [{
      id: 'simulator-transcript-protocol-envelope',
      role: 'assistant',
      runId: RUN,
      timestamp: '2026-09-19T11:00:09+08:00',
      content: [{
        type: 'text',
        text: [
          `${SIMULATOR_TRANSCRIPT_MARKERS.protocolAnswer}: the readable answer remains ordinary prose.`,
          '',
          '˚',
          '=',
          '±',
          '±',
          'Ë',
          '{"command":"inspect synthetic transcript","description":"Inspect synthetic transcript protocol"}',
          'functionresults',
          SIMULATOR_TRANSCRIPT_MARKERS.protocolSecret,
          'status: complete',
        ].join('\n'),
      }],
    }],
  });

  const currentMessages = [
    message(
      'skill-positive',
      'narration',
      `${SIMULATOR_TRANSCRIPT_MARKERS.historyInitialOldest}: ${SIMULATOR_TRANSCRIPT_MARKERS.skillPositive}: I'm using the browser-automation recovery workflow before inspection.`,
    ),
    message(
      'skill-negative',
      'narration',
      `${SIMULATOR_TRANSCRIPT_MARKERS.skillNegative}: I'm using the browser automation review workflow before inspection.`,
    ),
    message(
      'skill-inferred',
      'narration',
      `${SIMULATOR_TRANSCRIPT_MARKERS.skillInferred}: I'm loading that operating skill before inspection.`,
    ),
    {
      ...message(
        'skill-evidence',
        'tool',
        'read /fixture/skills/sit-authentication/SKILL.md\n# Synthetic skill evidence',
      ),
      tool: {
        name: 'exec',
        summary: 'read /fixture/skills/sit-authentication/SKILL.md',
        durationMs: 4,
      },
    },
    message(
      'citations',
      'assistant',
      [
        `${SIMULATOR_TRANSCRIPT_MARKERS.citationLink}: :codex-file-citation{path="/Users/fixture/Documents/${SIMULATOR_TRANSCRIPT_ACTIONABLE_FILE}" line="12"}`,
        `${SIMULATOR_TRANSCRIPT_MARKERS.citationUnavailable}: :codex-file-citation{path="relative/${SIMULATOR_TRANSCRIPT_UNAVAILABLE_FILE}"}`,
        `${SIMULATOR_TRANSCRIPT_MARKERS.citationInlineCode}: \`:codex-file-citation{path="/Users/fixture/Documents/literal-control.txt"}\``,
      ].join('\n'),
    ),
    message(
      'citation-fence',
      'assistant',
      [
        SIMULATOR_TRANSCRIPT_MARKERS.citationFence,
        '```text',
        ':codex-file-citation{path="/Users/fixture/Documents/fenced-control.txt"}',
        '```',
      ].join('\n'),
    ),
    {
      ...message(
        'folded-tool',
        'tool',
        [
          'exec · inspect synthetic transcript fixture',
          '{"scope":"simulator-only"}',
          SIMULATOR_TRANSCRIPT_MARKERS.toolSecret,
          'status: complete',
        ].join('\n'),
      ),
      tool: {
        name: 'exec',
        summary: 'exec · inspect synthetic transcript fixture',
        durationMs: 8,
      },
    },
    ...projectedProtocol,
    message('search-before', 'assistant', 'Readable geometry before the unique search target.'),
    message(
      'search-target',
      'assistant',
      `${SIMULATOR_TRANSCRIPT_MARKERS.searchTarget}: navigation keeps this source row readable.`,
    ),
    message('root', 'assistant', `${SIMULATOR_TRANSCRIPT_ROOT_MARKER}: static transcript fixture ready.`),
  ];
  const boundedPageCount = Math.max(0, Math.min(SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT, loadedOlderPageCount));
  const loadedOlder = olderHistoryPages
    .slice(0, boundedPageCount)
    .reverse()
    .flat();
  return [...loadedOlder, ...currentMessages];
}

/** Native-only mixed-height prepend: 24 source records per page plus folded tool groups. */
export function simulatorTranscriptGeometryMessages(loadedOlderPageCount = 0): WorkspaceMessage[] {
  const page = (pageIndex: number): WorkspaceMessage[] => Array.from({ length: 24 }, (_, index) => {
    const tool = index % 6 === 2 || index % 6 === 3;
    const id = `geometry-page-${pageIndex}-row-${String(index).padStart(2, '0')}`;
    return {
      id, role: tool ? 'tool' : 'assistant', source: 'history', state: 'complete',
      sessionKey: SESSION, runId: `geometry-run-${pageIndex}-${Math.floor(index / 6)}`,
      timestamp: `2026-09-${String(19 - pageIndex).padStart(2, '0')}T10:${String(index).padStart(2, '0')}:00+08:00`,
      text: `SIMTRANS-GEOMETRY-PAGE-${pageIndex}-ROW-${index}: ${tool ? 'synthetic tool output' : 'variable-height answer'}\n${'wrapped source text '.repeat((index % 5) * 5 + 1)}`,
      ...(tool ? { tool: { name: 'exec', summary: `geometry step ${index}`, durationMs: index + 1 } } : {}),
    } as WorkspaceMessage;
  });
  const initial = simulatorTranscriptFixtureMessages().map((message) => message.id.endsWith('-skill-positive')
    ? { ...message, text: `SIMTRANS-GEOMETRY-ANCHOR: ${message.text}` } : message);
  // Keep more than one full viewport *after* the reviewed key. Without this,
  // native ScrollView cannot preserve a top-row anchor after prepend because
  // its maximum offset is clamped by the short tail, regardless of the owner.
  const trailing = Array.from({ length: 32 }, (_, index): WorkspaceMessage => ({
    id: `geometry-later-${index}`, role: 'assistant', source: 'history', state: 'complete',
    sessionKey: SESSION, runId: `geometry-later-run-${index}`,
    timestamp: `2026-09-19T12:${String(index).padStart(2, '0')}:00+08:00`,
    text: `SIMTRANS-GEOMETRY-LATER-${index}: retained newer transcript after the reviewed key.\n${'variable answer '.repeat((index % 4) * 4 + 1)}`,
  }));
  const loaded = Array.from({ length: Math.max(0, Math.min(loadedOlderPageCount, SIMULATOR_TRANSCRIPT_HISTORY_PAGE_COUNT)) },
    (_, index) => page(index + 1)).reverse().flat();
  return [...loaded, ...initial, ...trailing];
}
