import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import VimicateEditor from '../../modules/vimicate-editor';
import type { ProjectFileContent, ProjectFileList } from '../gateway/projectFiles';
import { insertPromptHandoff, type PromptState } from '../prompt/vimPromptCore';
import { owningProjectFilesId } from '../projectFiles/projectFileBrowserCore';
import type { ProjectFilesFixture, ProjectFilesPort } from '../projectFiles/projectFilesTypes';
import { useProjectFilesController } from '../projectFiles/useProjectFilesController';
import { resolveProjectFileLink } from '../projectFiles/projectFileLink';
import { isSharedDownloadsLink } from '../projectFiles/sharedDownloadsLink';
import { openTranscriptLink, transcriptLinkAccessibilityHint } from '../transcript/openTranscriptLink';
import type { TranscriptLinkOpener } from '../transcript/TranscriptLinkOpener';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import type { ResolvedFileLocation } from '../gateway/locatedFiles';
import type { GatewayFileLocations } from '../gateway/useGatewayFileLocations';
import { useLocatedFilesBrowser } from '../projectFiles/useLocatedFilesBrowser';

export function useAppShellProjectFiles(options: GatewayFileLocations & {
  project: WorkspaceProject | undefined;
  projects: readonly WorkspaceProject[];
  fixture?: ProjectFilesFixture | undefined;
  isPad: boolean;
  listProjectFiles: (projectId: string, path: string) => Promise<ProjectFileList>;
  readProjectFile: (projectId: string, path: string) => Promise<ProjectFileContent>;
  resolveSharedFile: (sourcePath: string) => Promise<{ path: string }>;
  listSharedFiles: (projectId: string, path: string) => Promise<ProjectFileList>;
  readSharedFile: (projectId: string, path: string) => Promise<ProjectFileContent>;
  setPrompt: Dispatch<SetStateAction<PromptState>>;
  setStatus: (detail: string) => void;
  focusPrompt: () => void;
  hidePromptKeyboard: () => void;
  beforeOpen: () => void;
}) {
  const projectId = owningProjectFilesId(options.project, options.projects);
  const projectPath = options.projects.find((candidate) => candidate.id === projectId)?.path ?? '';
  const linkScope = `${projectId}:${options.project?.sessionKey ?? ''}:${projectPath}`;
  const currentLinkScope = useRef(linkScope); currentLinkScope.current = linkScope;
  const linkRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; linkRequest.current += 1; }; }, []);
  const currentOptions = useRef(options); currentOptions.current = options;
  const port = useMemo<ProjectFilesPort>(() => options.fixture?.port ?? ({
    listDirectory: ({ projectId: id, path }) => options.listProjectFiles(id, path),
    readFile: ({ projectId: id, path }) => options.readProjectFile(id, path),
    readFileForSharing: input => options.readLocatedFileForSharing({ location: 'project', projectId: input.projectId }, input),
  }), [options.fixture, options.listProjectFiles, options.readProjectFile, options.readLocatedFileForSharing]);
  const sharedPort = useMemo<ProjectFilesPort>(() => ({
    listDirectory: ({ projectId: id, path }) => options.listSharedFiles(id, path),
    readFile: ({ projectId: id, path }) => options.readSharedFile(id, path),
    readFileForSharing: input => options.readLocatedFileForSharing({ location: 'icloud-downloads', projectId: input.projectId }, input),
  }), [options.listSharedFiles, options.readSharedFile, options.readLocatedFileForSharing]);
  const [focused, setFocused] = useState(Boolean(options.fixture?.initiallyOpen));
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const publishFocused = (next: boolean) => { focusedRef.current = next; setFocused(next); };
  type Location = 'project' | 'shared' | 'located';
  const [threadLocations, setThreadLocations] = useState(() => new Map<string, { location: Location; target: ResolvedFileLocation | null }>());
  const selection = threadLocations.get(linkScope);
  const location = selection?.location ?? 'project';
  const rememberLocation = (next: Location, target?: ResolvedFileLocation) => setThreadLocations(current => {
    const nextLocations = new Map(current);
    const previous = current.get(linkScope);
    nextLocations.delete(linkScope);
    nextLocations.set(linkScope, { location: next, target: target ?? previous?.target ?? null });
    while (nextLocations.size > 24) nextLocations.delete(nextLocations.keys().next().value!);
    return nextLocations;
  });
  const locationRef = useRef(location); locationRef.current = location;
  const projectBrowser = useProjectFilesController({
    projectId, scopeKey: linkScope, active: location === 'project', port, ...(options.fixture?.initiallyOpen !== undefined ? { initiallyOpen: options.fixture.initiallyOpen } : {}), closeOnHandoff: !options.isPad,
    onStatus: options.setStatus,
    onYank: (text) => { options.setPrompt((current) => ({ ...current, register: text, registerKind: 'character' })); VimicateEditor.setClipboardText(text); },
    onHandoff: (payload) => { options.setPrompt((current) => insertPromptHandoff(current, payload.text, payload.caretOffset)); options.setStatus(`${payload.path} handed to prompt`); publishFocused(false); options.focusPrompt(); },
    onClose: () => { if (locationRef.current === 'project') { linkRequest.current += 1; publishFocused(false); } },
  });
  const sharedBrowser = useProjectFilesController({
    projectId: 'shared-icloud-downloads', scopeKey: linkScope, active: location === 'shared', port: sharedPort, closeOnHandoff: !options.isPad,
    onStatus: options.setStatus,
    onYank: (text) => { options.setPrompt((current) => ({ ...current, register: text, registerKind: 'character' })); VimicateEditor.setClipboardText(text); },
    onHandoff: (payload) => { options.setPrompt((current) => insertPromptHandoff(current, payload.text, payload.caretOffset)); options.setStatus(`iCloud Downloads/${payload.path} handed to prompt`); publishFocused(false); options.focusPrompt(); },
    onClose: () => { if (locationRef.current === 'shared') { linkRequest.current += 1; publishFocused(false); } },
  });
  const located = useLocatedFilesBrowser({ ...options, target: selection?.target ?? null, scopeKey: linkScope, active: location === 'located', closeOnHandoff: !options.isPad,
    onStatus: options.setStatus,
    onYank: (text) => { options.setPrompt(current => ({ ...current, register: text, registerKind: 'character' })); VimicateEditor.setClipboardText(text); },
    onHandoff: payload => { options.setPrompt(current => insertPromptHandoff(current, payload.text, payload.caretOffset)); publishFocused(false); options.focusPrompt(); },
    onClose: () => { if (locationRef.current === 'located') { linkRequest.current += 1; publishFocused(false); } },
  });

  const browser = location === 'shared' ? sharedBrowser : location === 'located' ? located.browser : projectBrowser;
  const previousSurface = useRef({ scope: linkScope, open: browser.open, focused });
  useEffect(() => {
    const previous = previousSurface.current;
    previousSurface.current = { scope: linkScope, open: browser.open, focused };
    if (previous.scope === linkScope) return;
    linkRequest.current += 1;
    if (location !== 'project') projectBrowser.close();
    if (location !== 'shared') sharedBrowser.close();
    if (location !== 'located') located.browser.close();
    if (previous.open && !browser.open) browser.openBrowser();
    publishFocused(previous.open && previous.focused);
  }, [linkScope, browser, location, focused]);
  const selectLocation = (next: Location, target?: ResolvedFileLocation) => {
    rememberLocation(next, target);
    if (locationRef.current !== next) {
      const previous = locationRef.current; locationRef.current = next;
      if (previous === 'shared') sharedBrowser.close(); else if (previous === 'located') located.browser.close(); else projectBrowser.close();
    }
    currentOptions.current.beforeOpen(); currentOptions.current.hidePromptKeyboard(); publishFocused(true);
  };
  const linkOpener = useMemo<TranscriptLinkOpener>(() => ({
    openLink: async (target) => {
      if (!mounted.current || currentLinkScope.current !== linkScope) return;
      const request = ++linkRequest.current;
      const relative = target.kind === 'local-file' && !target.path.startsWith('/') && !target.path.startsWith('~/');
      const file = relative && projectId ? resolveProjectFileLink(target, projectPath) : null;
      if (file) { selectLocation('project'); projectBrowser.openFilePath(file.path, file.line); return; }
      if (target.kind === 'web') return openTranscriptLink(target);
      try {
        const current = () => mounted.current && currentLinkScope.current === linkScope && linkRequest.current === request;
        if (isSharedDownloadsLink(target)) {
          const resolved = await currentOptions.current.resolveSharedFile(target.path);
          if (!current()) return;
          selectLocation('shared'); sharedBrowser.openFilePath(resolved.path, target.line);
        } else {
          const resolved = await currentOptions.current.resolveFileLocation(target.path, projectId);
          if (!current()) return;
          selectLocation('located', resolved); located.openResolved(resolved, target.line, current);
        }
      } catch {
        if (mounted.current && currentLinkScope.current === linkScope && linkRequest.current === request) currentOptions.current.setStatus('This file location could not be opened through the Gateway. No other folder was opened.');
      }
    },
    getAccessibilityHint: (target) => target.kind === 'local-file' && projectId && resolveProjectFileLink(target, projectPath)
      ? 'Opens this repository document in the Files pane'
      : isSharedDownloadsLink(target) ? 'Opens this document in iCloud Downloads in the Files pane when the Gateway supports it'
      : target.kind === 'local-file' ? 'Opens the exact file location in the Files pane; previews supported files' : transcriptLinkAccessibilityHint(target),
  }), [linkScope, projectId, projectPath, projectBrowser.openFilePath, sharedBrowser.openFilePath]);
  const open = () => { linkRequest.current += 1; selectLocation(location); if (!browser.open) browser.openBrowser(); };
  const requestFocus = () => { options.hidePromptKeyboard(); publishFocused(true); };
  const releaseFocus = () => publishFocused(false);
  return { browser, rootLabel: location === 'shared' ? 'iCloud Downloads' : location === 'located' ? located.rootLabel : 'Project', rootPath: location === 'shared' ? '~/icloud/Downloads' : location === 'located' ? located.rootPath : projectPath, focused, focusedRef, open, requestFocus, releaseFocus, linkOpener };
}
