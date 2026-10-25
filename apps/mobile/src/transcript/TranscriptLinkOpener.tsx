import { createContext, useContext, type ReactNode } from 'react';
import { openTranscriptLink, transcriptLinkAccessibilityHint } from './openTranscriptLink';
import type { TranscriptLinkTarget } from './transcriptMarkdown';

export type TranscriptLinkOpener = {
  openLink: (target: TranscriptLinkTarget) => void | Promise<void>;
  getAccessibilityHint: (target: TranscriptLinkTarget) => string;
};

const defaultTranscriptLinkOpener: TranscriptLinkOpener = {
  openLink: openTranscriptLink,
  getAccessibilityHint: transcriptLinkAccessibilityHint,
};

const TranscriptLinkOpenerContext = createContext<TranscriptLinkOpener>(defaultTranscriptLinkOpener);

export function TranscriptLinkOpenerProvider({ value, children }: { value: TranscriptLinkOpener; children: ReactNode }) {
  return <TranscriptLinkOpenerContext.Provider value={value}>{children}</TranscriptLinkOpenerContext.Provider>;
}

export function useTranscriptLinkOpener() {
  return useContext(TranscriptLinkOpenerContext);
}
