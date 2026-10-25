# Independent contributor setup

Vimicate requires a native iOS development build. Expo Go does not include its
local modules. Use a separate source checkout for contributor builds. Do not reuse
generated `ios/` files from a maintainer or release checkout.

## Toolchain

The isolated setup check on 24 October 2026 used macOS, Node 26.12.1, pnpm
12.15.0, CocoaPods 1.17.0, Xcode 27.0 and XcodeBuildMCP 2.7.0. These are tested
versions, not minimum supported versions. The app uses Expo SDK 57, React Native
0.86.3 and React 19.2.3. Keep the lockfile, workspace configuration and dependency
patches together. No Apple signing identity or Expo account is needed for the
simulator path.

## Build the contributor app

From the source root, run

```sh
cd apps/mobile
pnpm install --frozen-lockfile
pnpm config:contributor
pnpm typecheck
pnpm test
pnpm prebuild:contributor
pnpm ios:contributor --device
```

In the device selector choose an iOS simulator, not a connected physical device.
For subsequent Metro sessions run `pnpm start:contributor` in the same checkout.
The app's local Expo modules require the native build step. A JavaScript bundle
or `expo start` alone does not install them.

For an ad-hoc signed, embedded Release simulator build, choose a simulator identifier
from `xcodebuildmcp simulator list --enabled` and run the following from
`apps/mobile`, replacing `SIMULATOR_UUID` with that identifier.

```sh
VIMICATE_BUILD_MODE=contributor xcodebuildmcp simulator build \
  --workspace-path ios/VimicateContributor.xcworkspace \
  --scheme VimicateContributor \
  --simulator-id SIMULATOR_UUID \
  --configuration Release \
  --derived-data-path build/contributor-simulator \
  --extra-args CODE_SIGNING_ALLOWED=YES \
  --extra-args CODE_SIGN_IDENTITY=- \
  --extra-args VIMICATE_BUILD_MODE=contributor
```

Do not disable code signing. Ad-hoc signing needs no Apple account or signing
certificate, but the simulator app needs a signature for application-private
Keychain access. An unsigned app can launch while failing to save pairing
credentials.

Contributor mode is explicitly selected with `VIMICATE_BUILD_MODE=contributor`.
The package commands above set it for each Expo invocation. It gives the app the
name `Vimicate Contributor`, bundle identifier `org.vimicate.contributor` and URL
scheme `vimicate-contributor`. It removes the maintainer's team, shared-Keychain
entitlements, EAS ownership/project and remote update configuration. OTA updates
are disabled, including manual update requests. Native Keychain queries use this
app's private default access group rather than the legacy shared group. App files
and SQLite data are isolated by the distinct application container. Pair this app
as a new device with your own Gateway.

The public snapshot's `app.json` already contains contributor defaults. It has no
maintainer account, team, update project or shared-Keychain entitlement. Legacy
service and storage identifiers are projected to a generic public namespace. The
example shared-group identifier is inactive under application-private Keychain
scope and is not a signing identity.

Unset mode and explicit `production` mode preserve the checkout's `app.json`
unchanged. They do not restore maintainer settings in the public snapshot.
Unknown mode values fail. Never run a production
prebuild over this contributor native directory. Create another checkout instead.
Do not use the maintainer's Fastlane, TestFlight or physical QA signing wrappers.

Physical device signing requires your own Apple development account and a unique
bundle identifier selected in your generated Xcode project. That path has not
been accepted as a credential-free simulator build, and does not grant access to
the maintainer's distribution, Keychain or Expo project.

## Prepare an independent stock host

The host integration admits exact audited OpenClaw runtime fingerprints. Use the
stock `openclaw@2026.10.6` package for this recipe. Newer or modified package
bytes may fail closed until separately reviewed. No private updater, copied
maintainer state, archived transcripts or import ledger is required for a fresh
host.

From the source root, choose a new sibling directory for host tooling and state.
Keep it outside the source tree and do not commit it.

```sh
export CONTRIBUTOR_SOURCE_ROOT="$(pwd -P)"
mkdir ../vimicate-contributor-host
export CONTRIBUTOR_HOST_ROOT="$(cd ../vimicate-contributor-host && pwd -P)"
npm install --prefix "$CONTRIBUTOR_HOST_ROOT/tools" \
  --ignore-scripts --no-audit --no-fund openclaw@2026.10.6
export CONTRIBUTOR_OPENCLAW_PACKAGE="$CONTRIBUTOR_HOST_ROOT/tools/node_modules/openclaw"
export CONTRIBUTOR_OPENCLAW_BIN="$CONTRIBUTOR_OPENCLAW_PACKAGE/openclaw.mjs"
node host/openclaw/prepare-contributor-host.mjs \
  "$CONTRIBUTOR_OPENCLAW_PACKAGE" \
  "$CONTRIBUTOR_HOST_ROOT/prepared" \
  "$CONTRIBUTOR_SOURCE_ROOT"
export OPENCLAW_STATE_DIR="$CONTRIBUTOR_HOST_ROOT/prepared/openclaw-state"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
export OPENCLAW_WORKSPACE_DIR="$OPENCLAW_STATE_DIR/workspace"
```

The preparation command verifies runtime fingerprints, creates a new private
plugin artifact and registry, and writes a config fragment. It creates a random
local history secret and an empty import manifest. Native SQLite authority still
has to prove every session generation. It never fabricates a historical family,
modifies the installed OpenClaw package, discovers another host's state, overwrites
an existing destination or starts a Gateway.

The host artifact carries the source root's finalized MIT license and retained
notices. Its integrity manifest hashes both along with every runtime payload.
A source archive does not need Git metadata. Its manifest records unknown Git
revision and dirty state explicitly, while retaining the exact payload hashes.

Set up your own provider and local Gateway in that isolated state directory.
Select your own provider credentials in the interactive wizard. Keep the host
local and skip daemon installation for this first check.

```sh
node "$CONTRIBUTOR_OPENCLAW_BIN" onboard --classic --skip-daemon
node "$CONTRIBUTOR_OPENCLAW_BIN" config patch \
  --file "$CONTRIBUTOR_HOST_ROOT/prepared/openclaw-config-fragment.json" --dry-run
node "$CONTRIBUTOR_OPENCLAW_BIN" config patch \
  --file "$CONTRIBUTOR_HOST_ROOT/prepared/openclaw-config-fragment.json"
node "$CONTRIBUTOR_OPENCLAW_BIN" gateway run --bind loopback --port 19091
```

Do not use `--force` or point these environment variables at an existing Gateway.
The last command runs a separate foreground process. Use a free port and stop
only that process after the check. For a simulator on the same Mac, loopback is
sufficient. A physical device requires a separately configured, authenticated
reachable endpoint. Shared iCloud Downloads features are optional and require a
host iCloud directory. Registered project files do not require iCloud.

## Pair and check a complete interaction

In a second terminal with the same host environment variables, run

```sh
node "$CONTRIBUTOR_OPENCLAW_BIN" qr --url ws://127.0.0.1:19091 --no-ascii
```

Paste the generated setup code into the contributor app's Gateway connection
field. Treat the code as a temporary credential. Do not include it in an issue,
log, screenshot or commit. Approve device pairing in your own host when requested.
Confirm the Example project appears. Send a harmless first prompt in the
project itself to initialize its Gateway session. Then create a synthetic
thread, send another prompt and check that the final answer remains after
reconnecting. A registered project alone does not create a native Gateway
session. The app explains this prerequisite if a thread is requested too soon.

Also request a structured question through the selected provider, answer it in
the app and confirm the same run resumes. Providers and CLI harnesses differ in
question-tool support. Record the selected provider, question transport and any
missing capability. A successful text response alone does not prove the question
answer/resume path.

## Reproducible checks and acceptance limits

Run host contracts from the source root. Target installed-package acceptance
explicitly rather than interpreting optional skipped tests as integration proof.

```sh
node --test host/openclaw/*.test.mjs
OPENCLAW_HISTORY_TEST_PACKAGE_ROOT="$CONTRIBUTOR_OPENCLAW_PACKAGE" \
  node --test host/openclaw/prepare-contributor-host.test.mjs \
  host/openclaw/sqlite-history-runtime-acceptance.test.mjs \
  host/openclaw/sqlite-plugin-runtime-acceptance.test.mjs
```

The 24 October check installed frozen mobile dependencies in a source copy with
no existing native project, generated the contributor workspace and pods, and
completed an unsigned Release simulator build and launched its unpaired app.
A 25 October live check found that unsigned launch was insufficient for
Keychain access. The corrected ad-hoc signed Release build saved credentials
and paired with the isolated stock Gateway in a 17.6-second XCTest. The same
check exposed and repaired base64 setup decoding without the browser
TextDecoder global. Subsequent XCTest checks passed deterministic prompt
transport, structured-question answer/resume and cold-relaunch persistence.
The provider was a local protocol fixture, not a real model account.
The generated and compiled native configuration has no development team or shared
Keychain entitlement and has updates disabled with no update URL. Configuration
regressions also verify the shipping configuration is unchanged. A separately
downloaded unmodified stock OpenClaw package passed preparation and private-file
isolation checks. Its native, captured-plugin and worker-captured history checks
passed with unchanged databases. The actual plugin API check passed RPC scope,
registry authority and narration checks. The stock CLI validated the config
fragment without applying it.

This is a separate source/state check on an existing development Mac, not a
fresh-machine claim. Live provider authentication, a real prompt/question/answer cycle and
physical keyboard acceptance must be recorded separately. Nothing in this recipe activates the maintainer's Gateway or publishes
an app or update.

Expo configuration semantics follow the
[SDK 57 app config reference](https://docs.expo.dev/versions/v57.0.0/config/app/)
and [SDK 57 Updates reference](https://docs.expo.dev/versions/v57.0.0/sdk/updates/).
