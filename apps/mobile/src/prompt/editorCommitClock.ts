import type { PromptState } from './vimPromptCore';

export type ControlledEditorCommit = {
  revision: number;
  scope: string;
  authority: number;
  text: string;
  mode: PromptState['mode'];
  selectionStart: number;
  selectionEnd: number;
};

/**
 * Gives every distinct controlled editor snapshot a monotonic bridge revision.
 * UIKit can then reject an older cursor commit that arrives after a newer one
 * during a held-key burst without coupling the editor core to React renders.
 */
export class EditorCommitClock {
  private current: ControlledEditorCommit | null = null;
  private serializedRevision = 0;
  private serializedValue = '';
  private revision = 0;

  commit(state: PromptState, scope = ''): ControlledEditorCommit {
    const current = this.current;
    if (current
      && current.scope === scope
      && current.authority === state.authority
      && current.text === state.text
      && current.mode === state.mode
      && current.selectionStart === state.selection.start
      && current.selectionEnd === state.selection.end) return current;

    this.revision += 1;
    this.current = {
      revision: this.revision,
      scope,
      authority: state.authority,
      text: state.text,
      mode: state.mode,
      selectionStart: state.selection.start,
      selectionEnd: state.selection.end,
    };
    return this.current;
  }

  serialized(state: PromptState, scope = ''): string {
    const current = this.commit(state, scope);
    if (this.serializedRevision !== current.revision) {
      this.serializedRevision = current.revision;
      this.serializedValue = JSON.stringify(current);
    }
    return this.serializedValue;
  }
}
