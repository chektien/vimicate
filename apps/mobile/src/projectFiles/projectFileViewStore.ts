import type { ProjectFileContent, ProjectFileEntry } from '../gateway/projectFiles';
import type { TranscriptVimState } from '../transcript/transcriptVim';

export type SavedFileView = {
  path: string;
  selectedPath: string | null;
  showHidden: boolean;
  region: 'list' | 'preview';
  helpVisible: boolean;
  previewNavigation: TranscriptVimState;
  lastSearch: string;
  lastSearchDirection: 1 | -1;
  entries: ProjectFileEntry[] | null;
  content: ProjectFileContent | null;
};

export const fileViewKey = (projectId: string, scopeKey: string) => `${projectId}\0${scopeKey}`;

const MAX_VIEWS = 24;
const MAX_VIEW_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

function viewCost(view: SavedFileView) {
  const stringUnits = view.path.length + (view.selectedPath?.length ?? 0)
    + (view.content?.kind === 'text' ? view.content.text.length : view.content?.dataBase64.length ?? 0)
    + (view.entries?.reduce((sum, entry) => sum + entry.name.length + entry.path.length + (entry.mimeType?.length ?? 0), 0) ?? 0);
  return 2 * stringUnits + 80 * (view.entries?.length ?? 0) + 256;
}

// Controller-local, LRU-bounded render snapshots; the directory/read RPC remains authoritative.
export class ProjectFileViewStore {
  private views = new Map<string, SavedFileView>();

  get(key: string) {
    const view = this.views.get(key);
    if (view) { this.views.delete(key); this.views.set(key, view); }
    return view;
  }

  set(key: string, view: SavedFileView) {
    this.views.delete(key);
    const cost = viewCost(view);
    if (cost > MAX_VIEW_BYTES) view = { ...view, entries: null, content: null };
    this.views.set(key, view);
    let total = [...this.views.values()].reduce((sum, candidate) => sum + viewCost(candidate), 0);
    while (this.views.size > MAX_VIEWS || total > MAX_TOTAL_BYTES) {
      const oldest = this.views.keys().next().value!;
      total -= viewCost(this.views.get(oldest)!);
      this.views.delete(oldest);
    }
  }
}
