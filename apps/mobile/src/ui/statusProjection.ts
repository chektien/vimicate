import type { WorkspaceProject } from '../workspace/workspaceTypes';
import type { PromptState } from '../prompt/vimPromptCore';
import type { TranscriptVimState } from '../transcript/transcriptVim';
import type { WorkspaceFocus } from '../workspace/focusRouting';

export function workspaceModeLabel(focus: WorkspaceFocus, prompt: PromptState, transcript: TranscriptVimState) {
  if (focus === 'prompt') return prompt.visualMode ? prompt.visualMode === 'line' ? 'visual-line' : prompt.visualMode === 'block' ? 'visual-block' : 'visual' : prompt.mode;
  if (focus !== 'transcript' || !transcript.visualMode) return 'normal';
  return transcript.visualMode === 'line' ? 'visual-line' : transcript.visualMode === 'block' ? 'visual-block' : 'visual';
}

export function textPosition(text: string, cursor: number) {
  const rows = text.slice(0, cursor).split('\n');
  return { line: rows.length, column: (rows.at(-1)?.length ?? 0) + 1 };
}

export function sessionUsage(project: WorkspaceProject | undefined) {
  // The Gateway withholds a stale total (e.g. after an unsized compaction);
  // keep the known window so an unknown size reads as unknown, not absent.
  const tokens = project?.contextTokens ? `${project.totalTokens ? compactNumber(project.totalTokens) : '—'}/${compactNumber(project.contextTokens)}` : '';
  const cost = project?.estimatedCostUsd ? `$${project.estimatedCostUsd.toFixed(2)}` : '';
  return [tokens, cost].filter(Boolean).join(' · ');
}

function compactNumber(value: number) { return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value); }
