import type { WorkspaceMessage } from '../workspace/workspaceTypes';

import { sameWorkspaceMessageExceptText } from '../gateway/transcriptPublicationEquality';

/** Presentation-only headers: canonical messages/order/cache remain untouched.
 * A continuing group inherits its committed key through member overlap, so both
 * live appends and older-page prepends preserve the same fold/selection/cell.
 * Every non-tool is a boundary; approvals and media must remain directly visible.
 */
export function projectTranscriptToolGroups(messages: WorkspaceMessage[], previous: WorkspaceMessage[] = []): WorkspaceMessage[] {
  const owners = new Map<string, WorkspaceMessage>();
  let owner: WorkspaceMessage | undefined;
  for (const message of previous) {
    if (message.toolGroup) { owner = message; continue; }
    if (!groupable(message)) { owner = undefined; continue; }
    if (owner) owners.set(message.id, owner);
    if (message.id === owner?.toolGroup?.lastMessageId) owner = undefined;
  }
  const used = new Set<string>();
  const projected: WorkspaceMessage[] = [];
  for (let index = 0; index < messages.length;) {
    const first = messages[index]!;
    if (!groupable(first)) { projected.push(first); index++; continue; }
    let end = index + 1;
    while (end < messages.length && groupable(messages[end]!)) end++;
    const members = messages.slice(index, end);
    const count = members.length;
    const notices = members.filter(m => m.internalEvent !== undefined).length;
    const unit = notices === count ? 'update' : notices ? 'item' : 'call';
    const running = members.filter(m => m.state === 'streaming').length;
    const failed = members.filter(m => m.state === 'error').length;
    const text = [activityLabel(members), `${count} ${unit}${count === 1 ? '' : 's'}`, running ? `${running} running` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(' · ');
    const lastMessageId = members.at(-1)!.id;
    const prior = members.map(member => owners.get(member.id)).find(header => header && !used.has(header.id));
    let id = prior?.id ?? `tool-group:${first.id}`;
    // Canonical prose can split a previously continuous group. Never give two
    // visible segments one recycler key, even if the old first member moved.
    while (used.has(id)) id += ':segment';
    used.add(id);
    const header: WorkspaceMessage = {
      id, role: 'tool', text,
      ...(first.sessionKey ? { sessionKey: first.sessionKey } : {}),
      ...(first.transcriptSessionId ? { transcriptSessionId: first.transcriptSessionId } : {}),
      ...(first.runId ? { runId: first.runId } : {}),
      ...(first.timestamp ? { timestamp: first.timestamp } : {}),
      toolGroup: { count, lastMessageId },
    };
    projected.push(prior?.text === text && sameWorkspaceMessageExceptText(prior, header) ? prior : header, ...members);
    index = end;
  }
  return projected;
}

function groupable(message: WorkspaceMessage) {
  return message.role === 'tool' && !message.toolGroup && !message.attachments?.length && !message.approval && !message.recovery;
}
/** Labels describe only recognizable call operations, never arbitrary payload text.
 * Mixed batches deliberately stay generic; a hidden run boundary is not an activity.
 */
function activityLabel(messages: WorkspaceMessage[]): string {
  const labels = new Set(messages.map(message => {
    if (message.internalEvent === 'inter_session') return 'Session messages';
    if (message.internalEvent === 'exec') return 'Background command status';
    const name = message.tool?.name.toLowerCase().split(/__|\./).at(-1) ?? '';
    switch (name) {
      case 'read': case 'read_file': return 'Reading files';
      case 'edit': case 'write': case 'write_file': case 'apply_patch': return 'Editing files';
      case 'rg': case 'grep': case 'search': case 'web_search': return 'Searching';
      case 'web_fetch': return 'Fetching pages';
      case 'view_image': return 'Viewing images';
      case 'exec': case 'exec_command': {
        const command = message.tool?.summary.split(' · ').at(-1)?.trim() ?? '';
        // Do not infer a whole shell/script batch from one embedded command.
        if (!/[;|&`$\n\r]/.test(command)) {
          const operation = /^(?:pnpm|npm|yarn|bun) (?:run )?(test|typecheck|lint|doctor|check|build)(?:$|[ :])/.exec(command)?.[1];
          if (operation) return operation === 'build' ? 'Building' : 'Running checks';
        }
        return 'Running commands';
      }
      default: return 'Tool activity';
    }
  }));
  return labels.size === 1 ? [...labels][0]! : 'Tool activity';
}
