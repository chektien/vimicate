export type ResolvedProjectFileLink = { path: string; line?: number };

export type ProjectFileLinkTarget = {
  path: string;
  rawTarget?: string;
  line?: number;
};

/** Resolves a transcript file target to a project-root-relative path. */
export function resolveProjectFileLink(
  target: string | ProjectFileLinkTarget,
  projectRootPath: string,
): ResolvedProjectFileLink | null {
  const parsed = typeof target === 'string' ? parsedRawTarget(target) : parsedTarget(target);
  const root = normalizedRoot(projectRootPath);
  if (!parsed || !root) return null;

  const relative = relativePathWithinRoot(parsed.path, root);
  if (relative === null || !relative) return null;
  return { path: relative, ...(parsed.line ? { line: parsed.line } : {}) };
}

type ParsedPath = { path: string; line?: number };
type NormalizedRoot = { kind: 'absolute' | 'home'; parts: string[] };

function parsedTarget(target: ProjectFileLinkTarget): ParsedPath | null {
  if (!target.path || unsupportedPathShape(target.path) || !validLine(target.line)) return null;
  return { path: target.path, ...(target.line ? { line: target.line } : {}) };
}

function parsedRawTarget(value: string): ParsedPath | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^file:/i.test(trimmed)) return parsedFileUrl(trimmed);

  const separated = separatedLineReference(trimmed);
  if (!separated || /^[a-z][a-z\d+.-]*:/i.test(separated.path)) return null;
  try {
    const path = decodeURIComponent(separated.path);
    return path && !unsupportedPathShape(path) ? { path, ...(separated.line ? { line: separated.line } : {}) } : null;
  } catch {
    return null;
  }
}

function parsedFileUrl(value: string): ParsedPath | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:' || url.hostname || url.username || url.password || url.port || url.search) return null;
    const line = parsedLineFragment(url.hash);
    const path = decodeURIComponent(url.pathname);
    return path.startsWith('/') && !unsupportedPathShape(path) ? { path, ...(line ? { line } : {}) } : null;
  } catch {
    return null;
  }
}

function separatedLineReference(value: string): ParsedPath | null {
  const hash = value.indexOf('#');
  if (hash >= 0) {
    const line = parsedLineFragment(value.slice(hash));
    return { path: value.slice(0, hash), ...(line ? { line } : {}) };
  }
  const suffix = value.match(/:(\d+)(?::\d+)?$/);
  if (!suffix) return { path: value };
  const line = Number(suffix[1]);
  return validLine(line) ? { path: value.slice(0, -suffix[0].length), line } : null;
}

function parsedLineFragment(fragment: string) {
  const match = fragment.match(/^#L(\d+)$/i);
  const line = match ? Number(match[1]) : 0;
  return validLine(line) ? line : 0;
}

function validLine(line: number | undefined): boolean {
  return line === undefined || (Number.isSafeInteger(line) && line > 0);
}

function unsupportedPathShape(path: string) {
  return path.includes('\0') || path.includes('\\') || path.includes('?') || path.includes('#');
}

function normalizedRoot(value: string): NormalizedRoot | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('~/')) {
    const parts = normalizedParts(trimmed.slice(2));
    return parts?.length ? { kind: 'home', parts } : null;
  }
  if (trimmed.startsWith('/')) {
    const parts = normalizedParts(trimmed.slice(1));
    return parts?.length ? { kind: 'absolute', parts } : null;
  }
  return null;
}

function relativePathWithinRoot(path: string, root: NormalizedRoot): string | null {
  if (!path.startsWith('/') && !path.startsWith('~/')) return normalizedRelativePath(path);

  if (path.startsWith('~/')) {
    const target = normalizedParts(path.slice(2));
    if (!target) return null;
    if (root.kind === 'home') return suffixAfterPrefix(target, root.parts);
    const absoluteHome = standardHomeParts(root.parts);
    return absoluteHome ? suffixAfterPrefix(target, absoluteHome.relative) : null;
  }

  const target = normalizedParts(path.slice(1));
  if (!target) return null;
  if (root.kind === 'absolute') return suffixAfterPrefix(target, root.parts);
  const targetHome = standardHomeParts(target);
  return targetHome ? suffixAfterPrefix(targetHome.relative, root.parts) : null;
}

function standardHomeParts(parts: string[]) {
  if (parts.length < 3) return null;
  if (parts[0] !== 'Users' && parts[0] !== 'home') return null;
  if (!parts[1] || parts[1] === '.' || parts[1] === '..') return null;
  return { relative: parts.slice(2) };
}

function suffixAfterPrefix(path: string[], root: string[]) {
  if (path.length <= root.length || !root.every((part, index) => path[index] === part)) return null;
  return path.slice(root.length).join('/');
}

function normalizedRelativePath(path: string) {
  const parts = normalizedParts(path);
  return parts?.length ? parts.join('/') : null;
}

function normalizedParts(path: string) {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts;
}
