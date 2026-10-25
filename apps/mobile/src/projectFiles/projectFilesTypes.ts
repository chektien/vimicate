import type { ProjectFileContent, ProjectFileList } from '../gateway/projectFiles';
import type { ProjectFileShareReader } from '../gateway/projectFileSharing';

export type ProjectFilesPort = {
  listDirectory(input: { projectId: string; path: string; signal?: AbortSignal }): Promise<ProjectFileList>;
  readFile(input: { projectId: string; path: string; signal?: AbortSignal }): Promise<ProjectFileContent>;
  readFileForSharing?: ProjectFileShareReader;
};

export type ProjectFilesFixture = {
  port: ProjectFilesPort;
  initiallyOpen?: boolean;
};
