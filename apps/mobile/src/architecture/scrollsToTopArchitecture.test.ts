// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { join } from 'node:path';
import { expect, it } from 'vitest';

// iOS gives the window's top strip to a status-bar scroll-to-top gesture when a
// scrollsToTop view is visible. That consumed the first tap of iPadOS's
// double-tap-to-fill-screen, and jumped the transcript to its oldest rows.
const labs = /(?:Lab|Fixture|Fixtures)\.tsx$/;
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) && !/\.test\./.test(name) && !labs.test(name) ? [path] : [];
  });
}

it('opts every production scroll container out of status-bar scroll-to-top', () => {
  const missing: string[] = [];
  for (const path of files('src')) {
    const source = readFileSync(path, 'utf8');
    const tags = source.match(/(?<![\w.])<(?:ScrollView|FlatList|FlashList|SectionList)(?=\s)[^>]*/g) ?? [];
    for (const tag of tags) if (!tag.includes('scrollsToTop={false}')) missing.push(`${path}: ${tag.slice(0, 60)}`);
  }
  expect(missing).toEqual([]);
});
