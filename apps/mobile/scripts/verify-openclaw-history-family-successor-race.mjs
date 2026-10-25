#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MODULE = '/opt/homebrew/lib/node_modules/openclaw/dist/extensions/vimicate-history-family/vimicate-history-family-ledger.mjs';
const PROOF = 'audited-baseline+contiguous-ledger-v1';
const STABLE_KEY = 'agent:main:direct:vimicate-ios:project:successor-race-fixture';
const CLOSED_ID = '11111111-1111-4111-8111-111111111111';
const NEXT_ID = '22222222-2222-4222-8222-222222222222';
const WRONG_ID = '33333333-3333-4333-8333-333333333333';
const CLOSED_START = 1_787_800_000_000;
const NEXT_TIMESTAMP = '2026-08-27T09:00:00.000Z';

async function fixture(root, { headerId = NEXT_ID, sessionStartedAt } = {}) {
  const stateDir = path.join(root, 'state');
  const vimicateDir = path.join(root, 'vimicate');
  const sessionsDir = path.join(stateDir, 'agents', 'main', 'sessions');
  await fs.mkdir(sessionsDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(vimicateDir, { mode: 0o700 });

  const currentFile = path.join(sessionsDir, `${NEXT_ID}.jsonl`);
  const archivedFile = path.join(
    sessionsDir,
    `${CLOSED_ID}.jsonl.reset.2026-08-27T09-00-00.000Z`,
  );
  await fs.writeFile(
    currentFile,
    `${JSON.stringify({ type: 'session', version: 3, id: headerId, timestamp: NEXT_TIMESTAMP })}\n`,
    { mode: 0o600 },
  );
  await fs.writeFile(
    archivedFile,
    `${JSON.stringify({ type: 'session', version: 3, id: CLOSED_ID, timestamp: '2026-08-27T08:00:00.000Z' })}\n`,
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(sessionsDir, 'sessions.json'),
    `${JSON.stringify({
      [STABLE_KEY]: {
        sessionId: NEXT_ID,
        sessionFile: currentFile,
        ...(sessionStartedAt === undefined ? {} : { sessionStartedAt }),
      },
    })}\n`,
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(vimicateDir, 'openclaw-history-families.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      proof: PROOF,
      families: {
        [STABLE_KEY]: {
          agentId: 'main',
          segments: [{
            sessionId: CLOSED_ID,
            startedAtMs: CLOSED_START,
            transcriptFilename: `${CLOSED_ID}.jsonl`,
          }],
        },
      },
    })}\n`,
    { mode: 0o600 },
  );
  return { stateDir, vimicateDir, archivedFile };
}

async function record(writer, archivedFile) {
  return writer.record({
    sessionKey: STABLE_KEY,
    sessionId: CLOSED_ID,
    nextSessionId: NEXT_ID,
    nextSessionKey: STABLE_KEY,
    reason: 'reset',
    transcriptArchived: true,
    sessionFile: archivedFile,
  }, { sessionKey: STABLE_KEY, agentId: 'main' });
}

async function main() {
  const modulePath = path.resolve(process.argv[2] ?? DEFAULT_MODULE);
  const imported = await import(`${pathToFileURL(modulePath).href}?successor-race=${Date.now()}`);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-successor-race-'));
  try {
    const valid = await fixture(path.join(root, 'valid'));
    const validWriter = imported.createOpenClawHistoryFamilyLedgerWriter(valid);
    assert.deepEqual(await record(validWriter, valid.archivedFile), {
      status: 'appended',
      sessionKey: STABLE_KEY,
      closedSessionId: CLOSED_ID,
      nextSessionId: NEXT_ID,
    });
    const ledger = JSON.parse(await fs.readFile(
      path.join(valid.vimicateDir, 'openclaw-history-families.json'),
      'utf8',
    ));
    assert.equal(ledger.families[STABLE_KEY].segments.at(-1).startedAtMs, Date.parse(NEXT_TIMESTAMP));

    const mismatch = await fixture(path.join(root, 'mismatch'), { headerId: WRONG_ID });
    await assert.rejects(
      record(imported.createOpenClawHistoryFamilyLedgerWriter(mismatch), mismatch.archivedFile),
      /header sessionId|header disagrees/,
    );

    const malformedStore = await fixture(path.join(root, 'malformed-store'), { sessionStartedAt: 0 });
    await assert.rejects(
      record(imported.createOpenClawHistoryFamilyLedgerWriter(malformedStore), malformedStore.archivedFile),
      /successor start epoch is invalid/,
    );

    process.stdout.write(`${JSON.stringify({
      passed: 3,
      modulePath,
      fallbackEpoch: Date.parse(NEXT_TIMESTAMP),
    })}\n`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
