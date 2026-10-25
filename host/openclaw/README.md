# OpenClaw integration

This directory contains the optional host-side integration for Vimicate. The
mobile app is a client of an existing Gateway, not a replacement agent harness.
The source is not activated by checking out the repository or starting the app.

Use the [independent contributor setup](../../docs/CONTRIBUTOR_SETUP.md) to
prepare an isolated stock host, pair a contributor app and check a complete
interaction without maintainer state or credentials. See
[known limitations](../../docs/KNOWN_LIMITATIONS.md) before relying on the alpha.

## Ownership and authority

OpenClaw owns session generations, native SQLite transcripts, resets and run
lifecycle. The plugin does not write a second transcript or fall back to a JSONL
history writer. Its registry, import proof, history secret and bounded narration
sidecar belong in an explicitly selected private state directory.

`sqlite-gateway-plugin.mjs` composes the project registry, authorized history,
shared narration and project-file boundaries. Capabilities are advertised only
while their individual authority checks pass. Calls need an explicit concrete
session generation. Missing or rebound authority fails closed.

`sqlite-history-runtime.mjs` and `session-run-truth.mjs` validate exact supported
runtime fingerprints before importing upstream internals. A matching version
string alone is insufficient. A newer or modified package may be incompatible
until separately reviewed. The contributor recipe targets stock
`openclaw@2026.10.6`. It does not require a private updater or existing history.

## Prepare a new host

`prepare-contributor-host.mjs` accepts fixed absolute package, destination and
project directories. It verifies the runtime, builds a new plugin artifact and
creates a fresh private registry, empty import manifest, random local secret and
configuration fragment. It refuses an existing destination. It never patches the
installed package, discovers another host's private state, merges a live config
or starts a Gateway.

The full commands, environment isolation, pairing and prompt/question/answer
checks are in the [setup guide](../../docs/CONTRIBUTOR_SETUP.md). Keep generated
state and credentials outside the source checkout. Use your own provider account
for live acceptance. Do not commit setup codes, secrets or transcripts.

## Source checks

Run from the repository root.

```sh
node --test host/openclaw/*.test.mjs
```

The ordinary suite uses synthetic files, sessions and wire envelopes. Tests that
need a reviewed stock package or native OpenClaw authority are opt-in and report
an explicit skip when the relevant target is absent. A source pass with those
skips does not establish runtime acceptance, networking, pairing or live question
support. Execute the setup guide's independent acceptance before publication.

## Changing a compatibility boundary

Add the smallest failing regression at its owner, preserve exact scope and
identity checks, and test stock package behavior independently. Never broaden a
fingerprint to a version wildcard or bypass native generation authority to make
a new package appear compatible. Keep plugin artifact integrity and its source
manifest aligned. Installation and live activation remain separate actions.
