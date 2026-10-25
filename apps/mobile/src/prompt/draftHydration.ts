import type { PromptState } from './vimPromptCore';
export type DraftHydrationDecision =
  | { kind: 'restore'; text: string }
  | { kind: 'preserve-edit'; text: string };

export type SessionDraftStage = {
  sessionKey: string;
  text: string;
  source: 'memory' | 'empty';
  editor?: PromptState;
};

export type SessionDraftRevision = Readonly<{ sessionKey: string; revision: number }>;

type SessionDraftMemoryValue = { text: string; revision: number; editor?: PromptState };

/**
 * Synchronous per-session draft authority used while SQLite hydration is in
 * flight. A project switch must never paint the previous project's prompt in
 * the newly selected workspace, even for one frame.
 */
export class SessionPromptDraftMemory {
  private activeSessionKey = '';
  private readonly drafts: BoundedSessionCache<SessionDraftMemoryValue>;
  private revision = 0;
  // History snapshots are full strings. Bound their aggregate UTF-16 payload,
  // independently of the 64 text-only drafts, while retaining cursor and mode.
  private readonly histories = new Map<string, { value: SessionDraftMemoryValue; characters: number }>();
  private historyCharacters = 0;

  constructor(sessionLimit = 64, private readonly historyCharacterLimit = 2_000_000) {
    this.drafts = new BoundedSessionCache(sessionLimit);
  }

  private retainHistory(sessionKey: string, value: SessionDraftMemoryValue) {
    this.forgetHistory(sessionKey);
    const characters = value.editor ? [...value.editor.undo, ...value.editor.redo].reduce((sum, item) => sum + item.text.length, 0) : 0;
    if (characters) {
      this.histories.set(sessionKey, { value, characters });
      this.historyCharacters += characters;
    }
    while (this.historyCharacters > Math.max(0, this.historyCharacterLimit)) {
      const oldest = this.histories.entries().next().value;
      if (!oldest) break;
      const [key, retained] = oldest;
      if (retained.value.editor) retained.value.editor = { ...retained.value.editor, undo: [], redo: [] };
      this.forgetHistory(key);
    }
  }

  private forgetHistory(sessionKey: string) {
    this.historyCharacters -= this.histories.get(sessionKey)?.characters ?? 0;
    this.histories.delete(sessionKey);
  }

  enter(sessionKey: string, outgoingText: string, outgoingAuthoritative: boolean, outgoingEditor?: PromptState): SessionDraftStage {
    if (this.activeSessionKey && outgoingAuthoritative) this.remember(this.activeSessionKey, outgoingText, outgoingEditor);
    this.activeSessionKey = sessionKey;
    const remembered = this.drafts.restore(sessionKey);
    const history = this.histories.get(sessionKey);
    if (history) { this.histories.delete(sessionKey); this.histories.set(sessionKey, history); }
    if (remembered !== undefined) return { sessionKey, text: remembered.text, source: 'memory', ...(remembered.editor ? { editor: remembered.editor } : {}) };
    return { sessionKey, text: '', source: 'empty' };
  }

  remember(sessionKey: string, text: string, editor?: PromptState) {
    const previous = this.drafts.restore(sessionKey);
    // Text-only autosaves may acknowledge a parked editor, but a changed
    // off-route draft must not resurrect an undo stack for different text.
    const retained = editor?.text === text ? editor : previous?.text === text ? previous.editor : undefined;
    const value = { text, revision: ++this.revision, ...(retained ? { editor: retained } : {}) };
    const evicted = this.drafts.store(sessionKey, value);
    if (evicted) this.forgetHistory(evicted);
    if (sessionKey) this.retainHistory(sessionKey, value);
  }

  capture(sessionKey: string): SessionDraftRevision {
    return { sessionKey, revision: this.drafts.restore(sessionKey)?.revision ?? 0 };
  }

  /**
   * Merge an asynchronous durable read without overwriting a process edit that
   * happened after the read started. The returned text is synchronously parked
   * for the session, so switching back cannot let an older memory entry outrank
   * the just-written durable result.
   */
  mergeLoaded(snapshot: SessionDraftRevision, loadedText: string, merge: (latestText: string) => string) {
    const current = this.drafts.restore(snapshot.sessionKey);
    const latestText = current && current.revision !== snapshot.revision ? current.text : loadedText;
    const next = merge(latestText);
    this.remember(snapshot.sessionKey, next);
    return next;
  }
}

/** Pure authority rule used by async draft hydration tests and the hook. */
export function draftHydrationDecision(textAtStart: string, currentText: string, restoredText: string): DraftHydrationDecision {
  return currentText === textAtStart
    ? { kind: 'restore', text: restoredText }
    : { kind: 'preserve-edit', text: currentText };
}
import { BoundedSessionCache } from '../workspace/boundedSessionCache';
