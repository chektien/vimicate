import type { EditorInteractionEvent, EditorSelectionEvent, EditorTextEvent, HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { EditorCommitClock } from '../prompt/editorCommitClock';
import { acceptNativeSelection, acceptNativeText, applyBridgedNativeInsert, createPromptState, enterPromptInsertMode, handlePromptKey, type PromptState } from '../prompt/vimPromptCore';

/** One mounted answer owns its buffer and bridge generation, including between React commits. */
export class QuestionOtherEditorOwner {
  state: PromptState;
  closed = false;
  observedValue: string;

  constructor(readonly scope: string, value: string, public maxLength: number, authority = 0, readonly clock = new EditorCommitClock()) {
    this.observedValue = value;
    this.state = { ...enterPromptInsertMode(createPromptState(value.slice(0, maxLength))), authority };
  }

  serialized() { return this.clock.serialized(this.state, this.scope); }

  private bounded(next: PromptState): PromptState {
    if (next.text.length <= this.maxLength) return next;
    const text = next.text.slice(0, this.maxLength);
    return { ...next, text, authority: next.authority + 1, selection: {
      start: Math.min(next.selection.start, text.length), end: Math.min(next.selection.end, text.length),
    } };
  }

  text(event: EditorTextEvent) {
    if (this.closed || this.state.mode !== 'insert' || event.textAuthority !== this.state.authority) return;
    this.state = this.bounded(acceptNativeText(this.state, event.text, {
      start: event.selectionStart, end: event.selectionEnd,
    }, event.textAuthority));
  }

  selection(event: EditorSelectionEvent) {
    if (this.closed) return;
    const commit = this.clock.commit(this.state, this.scope);
    if (event.scope !== undefined && event.scope !== this.scope) return;
    if (event.editorRevision !== undefined && event.editorRevision !== commit.revision) return;
    this.state = acceptNativeSelection(this.state, { start: event.selectionStart, end: event.selectionEnd }, event.userInitiated);
  }

  key(event: HardwareKeyEvent): 'done' | 'exit' | null {
    if (this.closed) return null;
    if (event.text !== undefined && event.textAuthority !== undefined) this.text({
      text: event.text, textAuthority: event.textAuthority,
      selectionStart: event.selectionStart ?? this.state.selection.start,
      selectionEnd: event.selectionEnd ?? this.state.selection.end,
    });
    const current = this.state;
    const key = normalizedHardwareKey(event);
    const escape = key === 'escape' || (event.control && key === '[');
    if (escape && current.mode === 'normal' && !current.pending && !current.count && !current.visualMode) {
      this.closed = true;
      return 'exit';
    }
    if (key === 'enter' && current.mode === 'normal' && !event.control && !event.command && !event.option) {
      this.closed = true;
      return 'done';
    }
    const next = applyBridgedNativeInsert(current, event) ?? handlePromptKey(current, event).state;
    // Leaving native insertion invalidates callbacks already queued by that insertion generation.
    this.state = this.bounded(current.mode === 'insert' && next.mode === 'normal'
      ? { ...next, authority: next.authority + 1 } : next);
    return null;
  }

  tap(event: EditorInteractionEvent) {
    if (this.closed) return;
    this.state = acceptNativeSelection(enterPromptInsertMode(this.state), { start: event.selectionStart, end: event.selectionEnd }, true);
  }

  insert() { if (!this.closed) this.state = enterPromptInsertMode(this.state); }
}
