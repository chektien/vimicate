export type TranscriptGutterRailKind = 'active' | 'authored' | 'grouped' | 'none';

/**
 * A transcript row has one gutter axis. Active Vim focus wins, followed by
 * authored-prompt and grouped-machine context; the renderer never stacks two
 * parallel rails for the same row.
 */
export function transcriptGutterRailKind(input: {
  focused: boolean;
  current: boolean;
  authoredPrompt: boolean;
  grouped: boolean;
}): TranscriptGutterRailKind {
  if (input.focused && input.current) return 'active';
  if (input.authoredPrompt) return 'authored';
  if (input.grouped) return 'grouped';
  return 'none';
}
