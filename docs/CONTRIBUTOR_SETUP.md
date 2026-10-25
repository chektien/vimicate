# Contributor setup

Build Vimicate in the iOS simulator, run a separate OpenClaw Gateway on the same
Mac, and pair the two. This path needs your own model access but no Apple signing
account or Expo account. It leaves an existing Gateway installation alone.

- [Toolchain](#toolchain)
- [Build the contributor app](#build-the-contributor-app)
- [Prepare an independent stock host](#prepare-an-independent-stock-host)
- [Pair and check a complete interaction](#pair-and-check-a-complete-interaction)
- [Run it again](#run-it-again)
- [Use a physical iPad or iPhone](#use-a-physical-ipad-or-iphone)
- [Update OpenClaw](#update-openclaw)
- [Troubleshooting](#troubleshooting)
- [Optional Release simulator build](#optional-release-simulator-build)

## Toolchain

Use a Mac with Xcode and an installed iOS simulator. These versions have been
used for this setup. They are not minimum-version requirements.

| Tool | Tested version |
| --- | --- |
| Node.js | 26.12.1 |
| pnpm | 12.15.0 |
| CocoaPods | 1.17.0 |
| Xcode | 27.0 |
| OpenClaw | **2026.10.6**, installed separately below |

The app uses Expo SDK 57, React Native 0.86.3 and React 19.2.3. Install mobile
dependencies with pnpm and keep the committed lockfile, workspace configuration
and patches. Expo Go cannot load Vimicate's local native modules.

The host integration checks exact OpenClaw package contents. Use the pinned
version below, not `latest`. Read [known limitations](KNOWN_LIMITATIONS.md)
before relying on this source alpha.

## Build the contributor app

Clone a new checkout, then install and build the app.

```sh
git clone https://github.com/chektien/vimicate.git
cd vimicate/apps/mobile
pnpm install --frozen-lockfile
pnpm config:contributor
pnpm prebuild:contributor
pnpm ios:contributor --device
```

Choose an **iOS simulator** in the device selector. The app should open as
**Vimicate Contributor** and show its connection screen. Leave Metro running
in this terminal. Use a second terminal for the host setup below.

Contributor commands select `VIMICATE_BUILD_MODE=contributor`. The app uses the
bundle identifier `org.vimicate.contributor`, its own container and private
Keychain access. It has no shared signing identity or remote update subscription.
OTA updates are disabled. Use these commands consistently and do not run a
production prebuild over the generated contributor project.

## Prepare an independent stock host

### Set the host environment

Open a terminal at the **repository root**, not `apps/mobile`. Run this block
in each terminal you use for host commands. It keeps host tools, configuration
and credentials in a sibling directory outside the source checkout.

```sh
export CONTRIBUTOR_SOURCE_ROOT="$(pwd -P)"
export CONTRIBUTOR_HOST_ROOT="$(cd .. && pwd -P)/vimicate-contributor-host"
export CONTRIBUTOR_OPENCLAW_PACKAGE="$CONTRIBUTOR_HOST_ROOT/tools/node_modules/openclaw"
export CONTRIBUTOR_OPENCLAW_BIN="$CONTRIBUTOR_OPENCLAW_PACKAGE/openclaw.mjs"
export OPENCLAW_STATE_DIR="$CONTRIBUTOR_HOST_ROOT/prepared/openclaw-state"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
export OPENCLAW_WORKSPACE_DIR="$OPENCLAW_STATE_DIR/workspace"
export OPENCLAW_GATEWAY_PORT=19091
```

For a new setup, choose an unused `CONTRIBUTOR_HOST_ROOT`. Do not point these
variables at an existing Gateway's state. Keep the directory private and out
of Git.

### Install OpenClaw and prepare the plugin

Run once, in the same terminal.

```sh
mkdir -m 700 "$CONTRIBUTOR_HOST_ROOT"
npm install --prefix "$CONTRIBUTOR_HOST_ROOT/tools" \
  --ignore-scripts --no-audit --no-fund openclaw@2026.10.6
node host/openclaw/prepare-contributor-host.mjs \
  "$CONTRIBUTOR_OPENCLAW_PACKAGE" \
  "$CONTRIBUTOR_HOST_ROOT/prepared" \
  "$CONTRIBUTOR_SOURCE_ROOT"
```

The preparation command prints the new state, plugin and configuration paths.
It builds the plugin included in this repository and registers the source
checkout as an **Example** project. It refuses to overwrite a prepared directory
and does not start a Gateway or modify the installed OpenClaw package.

### Configure your provider and start the Gateway

Use your own provider credentials in the onboarding wizard. Choose a local
Gateway and skip daemon installation.

```sh
node "$CONTRIBUTOR_OPENCLAW_BIN" onboard --classic --skip-daemon
node "$CONTRIBUTOR_OPENCLAW_BIN" config patch \
  --file "$CONTRIBUTOR_HOST_ROOT/prepared/openclaw-config-fragment.json" --dry-run
node "$CONTRIBUTOR_OPENCLAW_BIN" config patch \
  --file "$CONTRIBUTOR_HOST_ROOT/prepared/openclaw-config-fragment.json"
node "$CONTRIBUTOR_OPENCLAW_BIN" gateway run --bind loopback --port "$OPENCLAW_GATEWAY_PORT"
```

The first patch command previews the configuration change. Apply it only after
the preview succeeds. The last command starts the Gateway in the foreground.
Leave this terminal running. If port 19091 is occupied, set
`OPENCLAW_GATEWAY_PORT` to a free port in every host terminal. Do not use
`--force` to stop another process.

For provider onboarding details, see the
[OpenClaw getting-started guide](https://docs.openclaw.ai/start/getting-started).
Keep using the pinned package and isolated environment from this guide.

## Pair and check a complete interaction

Open another terminal at the repository root and repeat the
[host environment block](#set-the-host-environment). Then generate a setup code.

```sh
node "$CONTRIBUTOR_OPENCLAW_BIN" qr --url "ws://127.0.0.1:$OPENCLAW_GATEWAY_PORT" --no-ascii
```

1. Paste the setup code into the app's Gateway connection field.
2. Approve device pairing on your host when requested, using the commands below.
3. Confirm **Example** appears in the project list.
4. Send a short prompt in **Example** and wait for a reply. This initializes
   the project's Gateway session before you create a thread.
5. Create a thread, send another prompt, then reconnect and confirm the answer
   remains visible.
6. Ask the agent to use a structured question, answer it in the app, and confirm
   the run continues. Support depends on the selected provider and CLI harness.

If pairing is pending, use the same host terminal to list requests. Match the
request to your simulator, then replace `REQUEST_ID` with its request ID.

```sh
node "$CONTRIBUTOR_OPENCLAW_BIN" devices list
node "$CONTRIBUTOR_OPENCLAW_BIN" devices approve REQUEST_ID
```

Use harmless prompts for this check. Setup codes are temporary credentials.
Keep them out of screenshots, logs and issues. A text reply confirms basic
connectivity, but does not test interactive question support.

Open the question mark (`?`) at the top left of the app for keyboard bindings.

## Run it again

Keep the prepared host directory. Do not rerun preparation or onboarding for
ordinary restarts.

In a terminal at `apps/mobile`, start Metro and reopen the installed contributor
app in the simulator.

```sh
pnpm start:contributor
```

In a separate terminal at the repository root, repeat the
[host environment block](#set-the-host-environment), then start the Gateway.

```sh
node "$CONTRIBUTOR_OPENCLAW_BIN" gateway run --bind loopback --port "$OPENCLAW_GATEWAY_PORT"
```

The app should reuse its saved connection. Generate a fresh setup code if
pairing is needed again. Stop your foreground Metro and Gateway processes with
Ctrl-C when finished. Do not stop an unrelated Gateway service.

## Use a physical iPad or iPhone

A physical-device build needs your own Apple development signing and a unique
bundle identifier in the generated Xcode project. Open
`apps/mobile/ios/VimicateContributor.xcworkspace`, select your team and signing
settings, then build for your device. Do not reuse someone else's signing or
release configuration.

The device also needs an authenticated Gateway endpoint reachable from its
network. `127.0.0.1` refers to the device itself, not your Mac. Configure remote
access using OpenClaw's documentation and generate the setup code for that
endpoint. The loopback recipe above is for a simulator on the same Mac.

Contributor builds do not receive the maintainer's OTA updates. To use your
own OTA workflow, configure your own Expo update project and install a native
build compatible with it. Native module changes always require a new build.

## Update OpenClaw

Before changing the pinned host version, follow
[Updating OpenClaw](../host/openclaw/README.md#updating-openclaw) for the included
compatibility checker and isolated trial process. The repository does not ship
an automatic OpenClaw updater.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| A local native module is missing | Use the native contributor build, not Expo Go. Run `pnpm prebuild:contributor` and rebuild after native changes. |
| The simulator app launches but cannot save pairing | Keep ad-hoc code signing enabled. An unsigned build cannot reliably use the app's Keychain. |
| The host preparation command rejects OpenClaw | Check the pinned version and unmodified package contents. Do not bypass its fingerprint check. |
| The preparation destination already exists | Reuse it for ordinary restarts, or choose a new host directory for a fresh setup. Do not delete working state to retry. |
| The app cannot reach the Gateway | Check that it is running, the ports match, and the endpoint is reachable from the simulator or device. |
| A setup code fails or has already been used | Generate a fresh code for the same Gateway and complete device approval. |
| A new thread cannot be created | Send the first prompt in its parent project to initialize the Gateway session. |
| The agent replies in text instead of showing a question card | Check that the provider and harness support structured questions. |
| Shared iCloud Downloads is unavailable | This optional feature needs an iCloud directory on the host. Registered project files work without it. |

For bug reports and source checks, see [Contributing](../CONTRIBUTING.md).
For sensitive reports, use [Security reporting](../SECURITY.md).

## Optional Release simulator build

Use this when you need an embedded Release build instead of the development
build above. It requires XcodeBuildMCP 2.7.0 in addition to the toolchain and
an already generated contributor workspace.

From `apps/mobile`, choose a simulator identifier with
`xcodebuildmcp simulator list --enabled`, then replace `SIMULATOR_UUID` below.

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

This builds the app but does not install or launch it. Keep ad-hoc signing
enabled for Keychain access. It needs no Apple account or signing certificate.
