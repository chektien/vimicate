// Test-only policy. Coverage is discovered from disk, including untracked additions.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const defaults = { lines: 350, bytes: 24000 };
export const sourceRoots = ['apps/mobile/src', 'apps/mobile/modules', 'host/openclaw'];
const excludedDirectories = new Set(['node_modules', '.build', '__tests__', '__fixtures__']);

export function productionSourceFiles(root, relative = '') {
  const files = [];
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = resolve(root, path);
    const moduleArtifact = /\/apps\/mobile\/modules\/[^/]+\/(?:tests|build|dist)$/.test(absolute);
    const rootBuild = /\/(?:apps\/mobile\/src|host\/openclaw)\/(?:build|dist)$/.test(absolute);
    if (entry.isDirectory() && !excludedDirectories.has(entry.name) && !moduleArtifact && !rootBuild) {
      files.push(...productionSourceFiles(root, path));
    } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|swift|mm?|h)$/.test(entry.name)
      && !/\.(?:test|spec|d)\.[^.]+$/.test(entry.name) && entry.name !== 'Package.swift') {
      files.push(path);
    }
  }
  return files.sort();
}

export function sourceSize(text) {
  // Preserve the existing architecture guard's nonblank/noncomment convention.
  // The independent UTF-8 byte ceiling also counts comments and string literals,
  // so packing statements onto one line cannot hide unbounded growth.
  const lines = text.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//')).length;
  return { lines, bytes: Buffer.byteLength(text, 'utf8') };
}

export function sizeViolations(path, text, exceptions = {}) {
  const size = sourceSize(text);
  const limit = { ...defaults, ...exceptions[path] };
  return ['lines', 'bytes'].filter(metric => size[metric] > limit[metric])
    .map(metric => `${path}: ${size[metric]} ${metric} exceeds ${limit[metric]}`);
}

export function inventory(root) {
  return sourceRoots.flatMap(sourceRoot => productionSourceFiles(join(root, sourceRoot))
    .map(path => {
      const relative = `${sourceRoot}/${path}`;
      return { path: relative, ...sourceSize(readFileSync(join(root, relative), 'utf8')) };
    }));
}
