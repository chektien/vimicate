# Vimicate

Vimicate is a keyboard-first iPad and iPhone client for your own OpenClaw
Gateway. It brings prompts, transcripts, project files and interactive agent
questions into one workspace. Native Vim-style editing and pane navigation are
designed for a hardware keyboard, with touch controls alongside them.

Vimicate is a client, not an agent harness or hosted AI service. Your Gateway
owns sessions, model access and tool execution. Pairing establishes device trust.
The app communicates with the Gateway over WebSocket RPC and streamed events.

## Source alpha

This is an experimental source-only alpha for contributors. It is not a signed
app download, an App Store release or a supported production deployment.
Build, host-integration and device checks cover different boundaries. Read the
[known limitations](docs/KNOWN_LIMITATIONS.md) before using it.

The source includes the React Native application, narrow native Expo modules,
host integration, synthetic tests and required assets. It does not include model
subscriptions, signing credentials, private conversations or the maintainer's
original development history.

## Build and contribute

Start with [contributor setup](docs/CONTRIBUTOR_SETUP.md), then read
[contribution guidance](CONTRIBUTING.md). Native iOS development requires macOS
and Xcode. Expo Go cannot load the local native modules.

The application uses Expo SDK 57, React Native 0.86 and React 19.2.3. Install
dependencies with the committed pnpm lockfile and patches.

```sh
cd apps/mobile
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:public
```

Run portable host tests from the repository root.

```sh
node --test host/openclaw/*.test.mjs
```

Installed-runtime acceptance tests identify their required OpenClaw package
explicitly. A skipped runtime test is not evidence that a host installation works.

## Source layout

- `apps/mobile/src` contains application owners, presentation and tests.
- `apps/mobile/modules` contains narrow native platform bridges.
- `host/openclaw` contains the separately installed Gateway integration.
- `docs` contains setup and architecture documentation.

## License and notices

Original project code is available under the [MIT license](LICENSE), copyright
2026 Chek Tien Tan. Existing upstream notices remain in place.
[Third-party notices](THIRD_PARTY_NOTICES.md) and
[asset provenance](docs/release/ASSET_PROVENANCE.json) identify retained material.
Dependency licenses still apply when building or distributing compiled artifacts.
