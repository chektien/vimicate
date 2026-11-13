import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { PROFILES } from './sqlite-history-profiles.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;

test('profile partitioning preserves every audited fingerprint, binding and runtime identity', () => {
  // Captured from the complete audited pre-split data. Any future profile audit
  // must intentionally update this digest, not silently alter old accepted pins.
  assert.deepEqual(Object.keys(PROFILES), [
    '2026.8.1', '2026.9.1', '2026.9.2', '2026.9.4', '2026.9.5', '2026.9.6',
    '2026.9.7', '2026.9.8', '2026.9.9', '2026.10.2', '2026.10.4', '2026.10.5',
    '2026.10.6', '2026.10.7', '2026.10.8', '2026.10.10', '2026.11.1', '2026.11.3',
  ]);
  const accepted = Object.fromEntries(Object.entries(PROFILES).filter(([runtime]) => runtime !== '2026.11.3'));
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(canonical(accepted))).digest('hex'),
    '8e587ee226829fbd2cf8fa8822bc88545dd548e7fe774b94d703cd8780f2e157');
  // Audited 2026.11.3 owners, added without altering the accepted pins above.
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(canonical(PROFILES['2026.11.3']))).digest('hex'),
    '9352c165651eca4a7e8e8ec7f5bfd493528f4e636791b1581a1e6148cd842df1');
});
