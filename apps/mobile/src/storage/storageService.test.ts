import { describe, expect, it } from 'vitest';
import { contentHash } from './contentHash';
describe('storage content authority', () => {
  it('makes stable hashes and distinguishes changed frames', () => { expect(contentHash('same')).toBe(contentHash('same')); expect(contentHash('same')).not.toBe(contentHash('changed')); });
});
