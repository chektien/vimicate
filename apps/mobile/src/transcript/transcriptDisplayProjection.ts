import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { coalesceTranscriptIdentities } from '../gateway/transcriptIdentityWall';
import { projectGeneratedMediaDeliveries } from './generatedMediaPresentation';
import { projectClaudeHistoryDeliveries } from './claudeHistoryPresentation';
import { projectTranscriptToolGroups } from './transcriptToolGroups';

/** Shared production display projection; prior committed groups preserve fold keys. */
export function projectTranscriptDisplayGroups(messages: WorkspaceMessage[], previous?: WorkspaceMessage[]) {
  return projectTranscriptToolGroups(projectGeneratedMediaDeliveries(projectClaudeHistoryDeliveries(coalesceTranscriptIdentities(messages))), previous);
}
