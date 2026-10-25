import { reconcileTranscriptVimState, transcriptLineAt, type TranscriptBuffer, type TranscriptVimState } from './transcriptVim';

type SessionTranscriptNavigationSnapshot = {
  buffer: TranscriptBuffer;
  navigation: TranscriptVimState;
};

/**
 * Cursor/review ownership belongs to a session, just like the archived review
 * rows it navigates. A project switch may update that session's hidden live
 * tail, but it must not turn the saved review cursor back into tail-following
 * state when the reader returns.
 */
export class SessionTranscriptNavigationCache {
  private readonly values = new Map<string, SessionTranscriptNavigationSnapshot>();

  constructor(private readonly sessionLimit = 64) {}

  store(sessionKey: string, buffer: TranscriptBuffer, navigation: TranscriptVimState) {
    if (!sessionKey) return;
    const ownsNewConversationTail = Boolean(
      newConversationTailMessageID(buffer)
      && navigation.cursor.row === buffer.lines.length - 1,
    );
    const ownedNavigation = ownsNewConversationTail
      ? { ...navigation, followTail: true }
      : navigation;
    this.values.delete(sessionKey);
    this.values.set(sessionKey, { buffer, navigation: ownedNavigation });
    while (this.values.size > this.sessionLimit) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (!oldest) break;
      this.values.delete(oldest);
    }
  }

  restore(sessionKey: string, nextBuffer: TranscriptBuffer) {
    if (!sessionKey) return undefined;
    const snapshot = this.values.get(sessionKey);
    if (!snapshot) return undefined;
    this.values.delete(sessionKey);
    this.values.set(sessionKey, snapshot);
    return reconcileTranscriptVimState(snapshot.navigation, snapshot.buffer, nextBuffer);
  }
}

/** Return the durable reset boundary that owns the current source tail. */
export function newConversationTailMessageID(buffer: TranscriptBuffer) {
  const finalLine = transcriptLineAt(buffer, buffer.lines.length - 1);
  return finalLine?.role === 'boundary' && finalLine.text !== '--- compaction ---'
    ? finalLine.messageId
    : '';
}
