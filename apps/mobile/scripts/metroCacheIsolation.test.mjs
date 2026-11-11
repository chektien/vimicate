import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const configPath = fileURLToPath(new URL('../metro.config.js', import.meta.url));
const expoRequire = createRequire(require.resolve('expo/metro-config'));
const metroRequire = createRequire(expoRequire.resolve('@expo/metro-config'));
const { getDefaultConfig } = require('expo/metro-config');
const getTransformCacheKey = metroRequire('@expo/metro/metro/DeltaBundler/getTransformCacheKey').default;
const originalMode = process.env.EXPO_PUBLIC_VIMICATE_UI_FIXTURE;

afterEach(() => {
  if (originalMode === undefined) delete process.env.EXPO_PUBLIC_VIMICATE_UI_FIXTURE;
  else process.env.EXPO_PUBLIC_VIMICATE_UI_FIXTURE = originalMode;
  delete require.cache[configPath];
});

function transformKey(mode, defaultsOnly = false) {
  if (mode === undefined) delete process.env.EXPO_PUBLIC_VIMICATE_UI_FIXTURE;
  else process.env.EXPO_PUBLIC_VIMICATE_UI_FIXTURE = mode;
  delete require.cache[configPath];
  const config = defaultsOnly || !existsSync(configPath) ? getDefaultConfig(projectRoot) : require(configPath);
  // Match Metro's real Transformer owner, including its transformer cache key.
  const { getTransformOptions, transformVariants, unstable_workerThreads, ...transformerConfig } = config.transformer;
  return getTransformCacheKey({ cacheVersion: config.cacheVersion, projectRoot: config.projectRoot,
    transformerConfig: { transformerPath: config.transformerPath, transformerConfig } });
}

describe('compiled fixture transform-cache isolation', () => {
  it('separates production and QA even when CI reuses Metro caches', () => {
    // Broken control. Expo's stock transform key does not include inlined env.
    expect(transformKey('', true)).toBe(transformKey('qa-command-completion-v1', true));
    expect(transformKey('')).not.toBe(transformKey('qa-command-completion-v1'));
  });

  it('unifies absent and empty production while separating every exact fixture mode', () => {
    expect(transformKey(undefined)).toBe(transformKey(''));
    const keys = ['', 'qa-command-completion-v1', 'qa-html-preview-v1', 'production', ' qa-html-preview-v1']
      .map(mode => transformKey(mode));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cannot reuse any pre-isolation transformed App entry', () => {
    const legacyKey = transformKey('', true);
    for (const mode of [undefined, '', 'qa-command-completion-v1']) {
      expect(transformKey(mode)).not.toBe(legacyKey);
    }
  });
});
