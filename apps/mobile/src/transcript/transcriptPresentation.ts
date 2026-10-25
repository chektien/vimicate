import { colors } from '../theme/tokens';
import type { WorkspaceMessage, WorkspaceMessageRole } from '../workspace/workspaceTypes';

export type TranscriptTier = 'conversation' | 'activity' | 'status' | 'alert';
export type TranscriptGroupPosition = 'standalone' | 'first' | 'middle' | 'last';
export type TranscriptRolePresentation = {
  marker: string;
  tone: string;
  tier: TranscriptTier;
  conversation: boolean;
  user: boolean;
};

export function transcriptRolePresentation(role: WorkspaceMessageRole): TranscriptRolePresentation {
  switch (role) {
    case 'user': return fixed('❯', colors.activeAccent, 'conversation', true);
    case 'assistant': return fixed('', colors.inkMuted, 'conversation');
    case 'narration': return fixed('※', colors.inkMuted, 'conversation');
    case 'error': return fixed('✗', colors.red, 'alert');
    case 'run': return fixed('▸', colors.orange, 'activity');
    case 'tool': return fixed('⚙', colors.ink, 'activity');
    case 'approval': return fixed('◇', colors.orange, 'activity');
    case 'media': return fixed('▣', colors.purple, 'activity');
    case 'openclaw': return fixed('⇄', colors.blue, 'status');
    case 'session': return fixed('≡', colors.yellow, 'status');
    case 'workspace': return fixed('⊞', colors.yellow, 'status');
    case 'command': return fixed('»', colors.yellow, 'conversation');
    case 'boundary': return fixed('─', colors.faint, 'status');
    case 'config': return fixed('◈', colors.faint, 'status');
    case 'vimicate': return fixed('❖', colors.yellow, 'status');
    case 'operator':
    case 'system': return fixed('·', colors.faint, 'status');
  }
}

// Claude Code's fixed opening for an automatic context-compaction summary.
const CONTEXT_SUMMARY = /^This session is being continued from a previous conversation\b/;

export function transcriptMessageMarker(message: Pick<WorkspaceMessage, 'role' | 'text'>) {
  if (message.role === 'boundary' && message.text === '--- compaction ---') return '';
  if (message.role === 'system' && CONTEXT_SUMMARY.test(message.text)) return '§';
  return transcriptRolePresentation(message.role).marker;
}

export function transcriptGroupPositions(messages: WorkspaceMessage[]): TranscriptGroupPosition[] {
  const groupable = messages.map((message) => {
    const presentation = transcriptRolePresentation(message.role);
    return message.role !== 'boundary' && presentation.tier !== 'conversation';
  });
  return messages.map((_, index) => {
    if (!groupable[index]) return 'standalone';
    const previous = index > 0 && Boolean(groupable[index - 1]);
    const next = index + 1 < messages.length && Boolean(groupable[index + 1]);
    if (previous && next) return 'middle';
    if (previous) return 'last';
    if (next) return 'first';
    return 'standalone';
  });
}

function fixed(marker: string, tone: string, tier: TranscriptTier, user = false): TranscriptRolePresentation {
  return { marker, tone, tier, conversation: tier === 'conversation', user };
}
