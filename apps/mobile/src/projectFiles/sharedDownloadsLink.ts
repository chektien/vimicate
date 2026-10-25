import type { TranscriptLinkTarget } from '../transcript/transcriptMarkdown';

/** Only nominate the host's explicit iCloud Downloads location; host resolution remains authoritative. */
export function isSharedDownloadsLink(target: TranscriptLinkTarget): boolean {
  if (target.kind !== 'local-file') return false;
  return /^~\/icloud\/Downloads\/[^/]/u.test(target.path)
    || /^\/Users\/[^/]+\/(?:icloud\/Downloads|Library\/Mobile Documents\/com~apple~CloudDocs\/Downloads)\/[^/]/u.test(target.path);
}
