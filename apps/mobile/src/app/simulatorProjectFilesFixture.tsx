import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { AppShell } from './AppShell';
import { simulatorPDFFixture } from './SimulatorFilePreviewFixture';
import type { ProjectFileContent, ProjectFileEntry } from '../gateway/projectFiles';
import type { ProjectFilesFixture } from '../projectFiles/projectFilesTypes';
import { saveDraft, setWorkspacePersistenceActive } from '../storage/workspaceStore';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

export const SIMULATOR_PROJECT_FILES_FIXTURE_MODE = 'qa-files-v1';
export const SIMULATOR_PROJECT_FILE_LINKS_FIXTURE_MODE = 'qa-filelinks-v1';
const sessionKey = 'fixture:simulator:project-files-v1';
const project: WorkspaceProject = {
  id: 'project-files-fixture', sessionKey, name: 'field notes', path: '/fixture/field-notes',
  branch: 'qa', starred: true, threadCount: 1, state: 'idle', kind: 'project', rootSessionKey: sessionKey,
};
const markdown = '# Field notes\n\nA quiet workspace for **reading** and making precise changes.\n\n## This week\n\n- Keep the conversation in view.\n- Browse with `j`, `k`, Enter and `-`.\n- Hand the original source to the prompt.\n\n> Read here. Revise together.\n\n## Checkpoints\n\n| Area | State |\n| --- | --- |\n| Markdown | Rendered |\n| Source | Preserved |\n\n```ts\nconst mode = "read-only";\n```\n';
const textFiles: Record<string, string> = {
  'README.md': markdown,
  '.notes.md': 'Hidden files are visible.\nNo writes are performed.\n',
  'notes.txt': '# This is plain text, not a heading\n**Literal asterisks stay visible.**\n',
  'docs/design.md': '# Design notes\n\nThe nested document is inside the project root.\n',
};
// Small valid PNG, fixture data only; no remote image fetch.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAlUlEQVR4nO3PsQ3DQBDEQFVjqP/IgJtzA9pAEZ8ADxcy2Lm+v8/j3+NO66/TBgWgBwWgBwWgB70GWIauPgDdB6D7AHTvB1iGrj4A3Qeg+wB07wdYhq4+AN0HoPsAdO8HWIauPgDdB6D7AHTvB1iGrj4A3Qeg+wB07wdYhq4+AN0HoPsAdO8HWIauPgDdB6D7AHSvB/wBICOI8cGnd2YAAAAASUVORK5CYII=';
const entry = (name: string, kind: ProjectFileEntry['kind'], mtimeMs: number, parent = ''): ProjectFileEntry => ({
  name, path: parent ? `${parent}/${name}` : name, kind, size: kind === 'directory' ? 0 : 128, mtimeMs,
  ...(kind === 'directory' ? {} : { mimeType: kind === 'image' ? 'image/png' : name.endsWith('.md') ? 'text/markdown' : 'text/plain' }),
});
const fixture: ProjectFilesFixture = {
  initiallyOpen: true,
  port: {
    async listDirectory({ projectId, path, signal }) {
      if (signal?.aborted) throw new Error('Cancelled');
      const entries = path === '' ? [entry('README.md', 'text', 5), entry('docs', 'directory', 4), entry('notes.txt', 'text', 3), entry('sample.png', 'image', 2), entry('.notes.md', 'text', 1), { ...simulatorPDFFixture, name: 'preview.pdf', path: 'preview.pdf' }]
        : path === 'docs' ? [entry('design.md', 'text', 4, 'docs')] : [];
      return { projectId, path, entries };
    },
    async readFile({ projectId, path, signal }): Promise<ProjectFileContent> {
      if (signal?.aborted) throw new Error('Cancelled');
      if (path === 'preview.pdf') return { ...simulatorPDFFixture, projectId, path };
      if (path === 'sample.png') return { projectId, path, kind: 'image', mimeType: 'image/png', size: 206, mtimeMs: 2, dataBase64: png };
      const text = textFiles[path];
      if (text === undefined) throw new Error('Fixture file unavailable');
      return { projectId, path, kind: 'text', mimeType: path.endsWith('.md') ? 'text/markdown' : 'text/plain', size: text.length, mtimeMs: 5, text };
    },
  },
};

export function SimulatorProjectFilesFixtureApp({ linkedDocuments = false }: { linkedDocuments?: boolean }) {
  const [state, setState] = useState('preparing');
  useEffect(() => {
    let active = true;
    setWorkspacePersistenceActive(true);
    void saveDraft(sessionKey, 'Keep this existing draft.').then(() => { if (active) setState('ready'); })
      .catch(() => { if (active) setState('fixture draft preparation failed'); });
    return () => { active = false; setWorkspacePersistenceActive(false); };
  }, []);
  if (state !== 'ready') return <Text>{state}</Text>;
  return <AppShell fixtureGatewayStatus="connected" fixtureProjectFiles={linkedDocuments ? { ...fixture, initiallyOpen: false } : fixture}
    fixtureProjectRail={{ projects: [project], selectedKey: sessionKey }}
    fixtureMessages={[{ id: 'files-fixture-root', role: 'assistant', text: linkedDocuments ? 'Open repository documents here:\n\n[Design notes](docs/design.md#L3)\n\n[Readme](/fixture/field-notes/README.md)\n\n[Image](sample.png)\n\n[Hidden note](.notes.md)\n\n[Missing document](docs/missing.md)\n\n[Web reference](https://example.com)' : 'The project files are beside this conversation. Open README.md, browse the rendered document, then use an insert key to prepare your changes in the prompt.', source: 'history', state: 'complete', sessionKey }]} />;
}
