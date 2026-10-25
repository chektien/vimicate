import fs from 'node:fs';
import path from 'node:path';

export const REGISTRY_LIMIT = 4 * 1024 * 1024;
export const DIRECTORY_ENTRY_LIMIT = 4096;
export const TEXT_LIMIT = 1024 * 1024;
export const IMAGE_LIMIT = 8 * 1024 * 1024;
// Darwin exposes O_NOFOLLOW_ANY in <sys/fcntl.h>, but Node does not currently
// surface it in fs.constants. It rejects a symlink in any path component.
const DARWIN_O_NOFOLLOW_ANY = 0x20000000;
const textExtensions = new Set([
  '.bash', '.bib', '.c', '.cc', '.cfg', '.conf', '.cpp', '.css', '.csv', '.cts', '.diff',
  '.ex', '.fish', '.go', '.gql', '.graphql', '.h', '.hpp', '.htm', '.html', '.ini', '.java',
  '.js', '.json', '.jsonc', '.jsx', '.kt', '.kts', '.less', '.log', '.lua', '.m', '.markdown',
  '.md', '.mdx', '.mjs', '.mm', '.mts', '.patch', '.py', '.r', '.rb', '.rs', '.scss', '.sh',
  '.sql', '.swift', '.tex', '.text', '.toml', '.ts', '.tsv', '.tsx', '.txt', '.vim', '.xml',
  '.yaml', '.yml', '.zsh',
  '.adoc', '.astro', '.cjs', '.clj', '.cljs', '.cljc', '.cmake', '.coffee', '.cs',
  '.dart', '.edn', '.erl', '.exs', '.gitattributes', '.gitignore', '.gradle', '.groovy',
  '.hcl', '.hrl', '.hs', '.ipynb', '.jl', '.json5', '.jsonl', '.lisp', '.mdown', '.mk',
  '.mkd', '.nix', '.php', '.pl', '.pm', '.properties', '.proto', '.ps1', '.psd1',
  '.psm1', '.rkt', '.rst', '.sass', '.scala', '.scm', '.svelte', '.tf', '.tfvars',
  '.typ', '.vue', '.zig',
]);
const textNames = new Set([
  'agents.md', 'dockerfile', 'gemfile', 'justfile', 'license', 'makefile', 'readme',
  '.gitignore', '.gitattributes', '.gitmodules', '.gitconfig', '.dockerignore',
  '.npmignore', '.eslintignore', '.prettierignore', '.ignore', '.rgignore',
  '.editorconfig', '.env', '.npmrc', '.yarnrc', '.nvmrc', '.node-version',
  '.python-version', '.ruby-version', '.tool-versions', '.browserslistrc',
  '.bashrc', '.bash_profile', '.bash_logout', '.zshrc', '.zprofile', '.zshenv',
  '.zlogin', '.profile', '.inputrc', '.vimrc', '.curlrc', '.wgetrc',
  '.eslintrc', '.prettierrc', '.babelrc', '.stylelintrc',
  'brewfile', 'podfile', 'rakefile', 'procfile', 'containerfile', 'jenkinsfile',
  'vagrantfile', 'gnumakefile', 'cmakelists.txt', 'authors', 'contributors',
  'copying', 'notice', 'changelog', 'gemfile.lock', 'podfile.lock', 'cargo.lock',
  'yarn.lock', 'bun.lock', 'composer.lock', 'pipfile', 'pipfile.lock', 'poetry.lock', 'uv.lock',
]);
const imageTypes = new Map([
  ['.bmp', 'image/bmp'], ['.gif', 'image/gif'], ['.heic', 'image/heic'],
  ['.heif', 'image/heif'], ['.ico', 'image/x-icon'], ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);
export const documentTypes = new Map([
  ['.pdf', 'application/pdf'], ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.rtf', 'application/rtf'], ['.pages', 'application/vnd.apple.pages'],
  ['.numbers', 'application/vnd.apple.numbers'], ['.key', 'application/vnd.apple.keynote'],
  ['.mp3', 'audio/mpeg'], ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'],
  ['.wav', 'audio/wav'], ['.aif', 'audio/aiff'], ['.aiff', 'audio/aiff'], ['.caf', 'audio/x-caf'],
  ['.mp4', 'video/mp4'], ['.m4v', 'video/mp4'], ['.mov', 'video/quicktime'],
  ['.zip', 'application/zip'],
]);
const textTypes = new Map([
  ['.css', 'text/css'], ['.csv', 'text/csv'], ['.htm', 'text/html'], ['.html', 'text/html'],
  ['.js', 'text/javascript'], ['.json', 'application/json'], ['.jsx', 'text/javascript'],
  ['.markdown', 'text/markdown'], ['.md', 'text/markdown'], ['.mdx', 'text/markdown'],
  ['.mjs', 'text/javascript'], ['.ts', 'text/typescript'], ['.tsx', 'text/typescript'],
  ['.txt', 'text/plain'], ['.xml', 'application/xml'], ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
]);

export function check(value, message) {
  if (!value) throw new Error(`vimicate project files: ${message}`);
}
export function failure(message) {
  return new Error(`vimicate project files: ${message}`);
}
export function inside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}
export function openConfined(filename, flags, message) {
  check(process.platform === 'darwin', 'secure filesystem traversal is unavailable');
  try { return fs.openSync(filename, flags | fs.constants.O_NONBLOCK | DARWIN_O_NOFOLLOW_ANY); }
  catch { throw failure(message); }
}
export function statFd(fd, message) {
  try {
    const stat = fs.fstatSync(fd);
    check(Number.isSafeInteger(stat.size) && stat.size >= 0 && Number.isFinite(stat.mtimeMs), message);
    return stat;
  }
  catch { throw failure(message); }
}
export const ICLOUD_DOWNLOADING = 'file is still downloading from iCloud; open it again in a moment';
/** macOS refuses to fault in an iCloud placeholder for a background service (EDEADLK). */
export function isICloudPlaceholderError(error) {
  return error?.code === 'EDEADLK' || error?.errno === -11;
}
export function boundedBytes(fd, limit, message) {
  const bytes = Buffer.allocUnsafe(limit + 1);
  let offset = 0;
  try {
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
  } catch (error) {
    if (isICloudPlaceholderError(error)) throw Object.assign(failure(ICLOUD_DOWNLOADING), { icloudPlaceholder: true });
    throw failure(message);
  }
  return bytes.subarray(0, offset);
}
export function relativePath(value, allowRoot) {
  check(typeof value === 'string' && value.length <= 4096 && !value.includes('\0'), 'invalid path');
  if (!value) {
    check(allowRoot, 'file path is required');
    return '';
  }
  check(!path.isAbsolute(value) && !value.includes('\\'), 'path must be project-relative');
  const parts = value.split('/');
  check(parts.every(part => part && part !== '.' && part !== '..'), 'path traversal is not allowed');
  return parts.join('/');
}
export function classified(name, stat, includeDocuments) {
  if (stat.isDirectory()) return { kind: 'directory' };
  if (!stat.isFile()) return { kind: 'unsupported' };
  const lower = name.toLocaleLowerCase('en-US');
  const extension = path.extname(lower);
  if (imageTypes.has(extension)) return { kind: 'image', mimeType: imageTypes.get(extension) };
  // Listing remains metadata-only. Conventional text-name variants use the
  // same bounded, strict UTF-8 read path as recognized text extensions.
  const textVariant = !documentTypes.has(extension) && /^(?:\.env|dockerfile|containerfile|makefile|procfile)(?:\.[a-z0-9_-]+)+$/u.test(lower);
  if (textExtensions.has(extension) || textNames.has(lower) || textVariant) {
    return { kind: 'text', mimeType: textTypes.get(extension) ?? 'text/plain' };
  }
  if (includeDocuments === true && documentTypes.has(extension)) {
    return { kind: 'document', mimeType: documentTypes.get(extension) };
  }
  return { kind: 'unsupported' };
}
export function parseProjects(markdown) {
  const projects = [];
  let current = null;
  const finish = () => {
    if (current?.id && current.repo) projects.push(current);
  };
  for (const line of markdown.split(/\r?\n/u)) {
    if (/^##\s+.+?\s*$/u.test(line)) {
      finish();
      current = {};
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s*-\s+(id|repo|default-executor):\s*(.*?)\s*$/iu);
    if (!field) continue;
    current[field[1].toLocaleLowerCase('en-US')] = field[2].trim();
  }
  finish();
  return projects;
}
