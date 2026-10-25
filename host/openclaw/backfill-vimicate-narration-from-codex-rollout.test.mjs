import assert from "node:assert/strict";
import test from "node:test";

import {
  extractNarrationRecords,
  parseArguments,
  verifyPromptBinding
} from "./backfill-vimicate-narration-from-codex-rollout.mjs";

const runId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";

function rolloutLine({ id, timestamp, text, turn = turnId }) {
  return JSON.stringify({
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      id,
      phase: "commentary",
      content: [{ type: "output_text", text }],
      internal_chat_message_metadata_passthrough: { turn_id: turn }
    }
  });
}

test("extracts exact timestamped commentary for only the requested turn", () => {
  const text = [
    rolloutLine({
      id: "item-a",
      timestamp: "2026-08-26T17:17:55.398Z",
      text: "First preamble."
    }),
    rolloutLine({
      id: "ignored",
      timestamp: "2026-08-26T17:18:00.000Z",
      text: "Different turn.",
      turn: "33333333-3333-4333-8333-333333333333"
    }),
    rolloutLine({
      id: "item-b",
      timestamp: "2026-08-26T17:18:11.802Z",
      text: "Second preamble."
    })
  ].join("\n");
  assert.deepEqual(extractNarrationRecords(text, turnId), [
    {
      itemId: "item-a",
      sequence: 1,
      text: "First preamble.",
      timestampMs: 1787764675398
    },
    {
      itemId: "item-b",
      sequence: 3,
      text: "Second preamble.",
      timestampMs: 1787764691802
    }
  ]);
});

test("requires exact OpenClaw run-to-Codex-turn prompt ownership", () => {
  const valid = JSON.stringify({
    type: "message",
    message: {
      role: "user",
      idempotencyKey: `${runId}:user`,
      __openclaw: {
        mirrorIdentity: `${turnId}:prompt`,
        mirrorOrigin: "codex-app-server"
      }
    }
  });
  assert.doesNotThrow(() => verifyPromptBinding(valid, { runId, turnId }));
  assert.throws(
    () => verifyPromptBinding(valid, {
      runId: "44444444-4444-4444-8444-444444444444",
      turnId
    }),
    /exactly one user prompt/
  );
});

test("requires an explicit dry-run or apply boundary", () => {
  const common = [
    "--state-dir", "/state",
    "--vimicate-dir", "/vimicate",
    "--stable-session-key", "agent:main:direct:project",
    "--session-id", "55555555-5555-4555-8555-555555555555",
    "--run-id", runId,
    "--turn-id", turnId,
    "--rollout-file", "/rollout.jsonl"
  ];
  assert.throws(() => parseArguments(common), /choose exactly one/);
  assert.equal(parseArguments([...common, "--dry-run"]).dryRun, true);
  assert.equal(parseArguments([...common, "--apply"]).apply, true);
});
