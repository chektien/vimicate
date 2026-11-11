import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { activeThreadEntry, assertThreadRegistryRemoval, assertThreadRegistryUpdate, removedThreadEntries, rootProjectForSelection, retiredThreadSessionKeys, threadBootstrapMessage, type CreatedGatewaySession, type ThreadRegistryWireEntry } from './threadRegistryMutation';

export type ThreadMutationClient = {
  createSession: (parentSessionKey: string, label: string | undefined, message: string) => Promise<CreatedGatewaySession>;
  updateThreadRegistry: (mode: 'upsert' | 'remove', entries: ThreadRegistryWireEntry[]) => Promise<unknown>;
};

export type ThreadActionResult = {
  selectedKey: string;
  message: string;
  registryPayload: Record<string, unknown>;
  runId?: string;
};

export async function createWorkspaceThread(client: ThreadMutationClient, projects: WorkspaceProject[], selectedKey: string, labelInput: string, registryPayload: Record<string, unknown>, nowSeconds = Date.now() / 1000): Promise<ThreadActionResult> {
  const label = labelInput.trim();
  if (!label) throw new Error(':new-thread needs a thread name.');
  const parent = rootProjectForSelection(projects, selectedKey);
  if (!parent) throw new Error(':new-thread could not find the selected project.');
  if (!parent.sessionId) throw new Error('Send a first prompt in this project before creating a thread. Its Gateway session does not exist yet.');
  if (projects.some((project) => project.kind === 'thread' && project.rootSessionKey === parent.sessionKey && project.name.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error(`:${'new-thread'} ${label} already exists in ${parent.name}.`);
  const knownKeys = new Set(projects.map((project) => project.sessionKey));
  const retiredKeys = retiredThreadSessionKeys(registryPayload, parent, label);
  // Recreate through a fresh native identity without renaming or deleting the
  // retained session. The registry continues to own the project-local name.
  const native = await client.createSession(parent.sessionKey, retiredKeys.size ? undefined : label, threadBootstrapMessage(label, parent));
  if (retiredKeys.has(native.sessionKey)) throw new Error(':new-thread rejected a retired session key returned during recreation.');
  const created = retiredKeys.size ? { ...native, label } : native;
  if (created.sessionKey === parent.sessionKey) throw new Error(':new-thread rejected a child session key equal to its parent.');
  if (knownKeys.has(created.sessionKey)) throw new Error(':new-thread rejected a session key that already existed before creation.');
  const acceptedRegistry = assertThreadRegistryUpdate(await client.updateThreadRegistry('upsert', [activeThreadEntry(created, parent, label, registryPayload, nowSeconds)]));
  const resolvedLabel = created.label || label;
  return { selectedKey: created.sessionKey, message: `:new-thread ${resolvedLabel} — created under ${parent.name}.`, registryPayload: acceptedRegistry, ...(created.runStarted && created.runId ? { runId: created.runId } : {}) };
}

export type ProjectRemovalClient = { removeRegistryProject: (projectID: string, expectedSha256: string) => Promise<Record<string, unknown>> };

/** Removes a top-level project from projects.md only. Its folder, OpenClaw
 * session and child-thread registry rows stay, so re-adding the entry restores it. */
export async function removeWorkspaceProject(client: ProjectRemovalClient, projects: WorkspaceProject[], selectedKey: string, registryPayload: Record<string, unknown>, runActive: boolean, argumentsInput = ''): Promise<ThreadActionResult> {
  if (argumentsInput.trim()) throw new Error(':remove-project removes the selected project and takes no arguments.');
  const selected = projects.find((project) => project.sessionKey === selectedKey);
  if (!selected || selected.kind !== 'project' || !selected.id) throw new Error(':remove-project needs a selected top-level project. Use :close-thread for a child thread.');
  if (runActive) throw new Error(`:remove-project ${selected.name} has an active run. Use :stop first.`);
  const capabilities = registryPayload.capabilities as Record<string, unknown> | undefined;
  const projectsFile = registryPayload.projects as Record<string, unknown> | undefined;
  if (capabilities?.projectRemoval !== 'projects-md-v1') throw new Error(':remove-project needs the updated Vimicate Gateway plugin.');
  if (typeof projectsFile?.sha256 !== 'string' || !projectsFile.sha256) throw new Error(':remove-project needs a loaded project registry. Run :reload-projects first.');
  const result = await client.removeRegistryProject(selected.id, projectsFile.sha256);
  const accepted = result.projects as Record<string, unknown> | undefined;
  if (result.outcome !== 'removed' || result.projectID !== selected.id || typeof accepted?.markdown !== 'string') throw new Error(':remove-project received an invalid Gateway reply.');
  return { selectedKey: '', message: `:remove-project ${selected.name} — removed from Vimicate; its folder was kept.`, registryPayload: { projects: accepted } };
}

export async function closeWorkspaceThread(client: ThreadMutationClient, projects: WorkspaceProject[], selectedKey: string, registryPayload: Record<string, unknown>, runActive: boolean, argumentsInput = '', nowSeconds = Date.now() / 1000): Promise<ThreadActionResult> {
  if (argumentsInput.trim()) throw new Error(':close-thread closes the selected thread and takes no arguments.');
  const selected = projects.find((project) => project.sessionKey === selectedKey);
  if (!selected || selected.kind !== 'thread' || !selected.rootSessionKey) throw new Error(':close-thread needs a selected child thread.');
  if (runActive) throw new Error(`:close-thread ${selected.name} has an active run. Use :stop first.`);
  const entries = removedThreadEntries(registryPayload, projects, selectedKey, nowSeconds);
  if (!entries.length) throw new Error(':close-thread could not build an authoritative registry removal.');
  const acceptedRegistry = assertThreadRegistryRemoval(await client.updateThreadRegistry('remove', entries), entries);
  return { selectedKey: selected.rootSessionKey, message: `:close-thread ${selected.name} — removed; returned to its project.`, registryPayload: acceptedRegistry };
}
