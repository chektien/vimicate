import { useEffect, useMemo, useState } from 'react';
import type { GatewayFileLocations } from '../gateway/useGatewayFileLocations';
import type { ResolvedFileLocation } from '../gateway/locatedFiles';
import { useProjectFilesController } from './useProjectFilesController';
import type { ProjectFilesPort } from './projectFilesTypes';

type ControllerOptions = Parameters<typeof useProjectFilesController>[0];
/** Reuses the Files owner, committing the resolved root before admitting its open intent. */
export function useLocatedFilesBrowser(options: GatewayFileLocations & Pick<ControllerOptions, 'onStatus' | 'onYank' | 'onHandoff' | 'onClose' | 'closeOnHandoff' | 'active'> & { target: ResolvedFileLocation | null; scopeKey: string }) {
  const target = options.target;
  const [pending, setPending] = useState<{ target: ResolvedFileLocation; line?: number; current: () => boolean } | null>(null);
  const port = useMemo<ProjectFilesPort>(() => ({
    listDirectory: ({ path }) => {
      if (!target) return Promise.reject(new Error('File location unavailable.'));
      return options.listLocatedFiles(target, path);
    },
    readFile: ({ path }) => {
      if (!target) return Promise.reject(new Error('File location unavailable.'));
      return options.readLocatedFile(target, path);
    },
    readFileForSharing: input => {
      if (!target) return Promise.reject(new Error('File location unavailable.'));
      return options.readLocatedFileForSharing(target, input);
    },
  }), [target, options.listLocatedFiles, options.readLocatedFile, options.readLocatedFileForSharing]);
  const browser = useProjectFilesController({ ...options, port, projectId: target?.projectId ?? '',
    scopeKey: `${options.scopeKey}:${target ? `${target.location}:${target.projectId}:${target.rootPath}` : ''}` });
  useEffect(() => {
    if (!pending || pending.target !== target) return;
    setPending(null);
    if (pending.current()) browser.openFilePath(target.path, pending.line);
  }, [pending, target, browser.openFilePath]);
  return {
    browser, rootPath: target?.rootPath ?? '',
    rootLabel: target?.location === 'assistant-artifacts' ? 'Artifacts' : target?.location === 'icloud-downloads' ? 'iCloud Downloads' : 'Project',
    openResolved: (next: ResolvedFileLocation, line: number | undefined, current: () => boolean) => {
      setPending({ target: next, ...(line === undefined ? {} : { line }), current });
    },
  };
}
