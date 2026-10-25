# Contributing to Vimicate

Vimicate is a keyboard-first iPad and iPhone client for OpenClaw. This is an
experimental source alpha. Report vulnerabilities through the private route
described in [SECURITY.md](SECURITY.md).
See [known limitations](docs/KNOWN_LIMITATIONS.md) for current limits and
[contributor setup](docs/CONTRIBUTOR_SETUP.md) for the isolated build recipe.

## Development environment

The application lives in `apps/mobile`. Its manifests currently select Expo SDK
57, React Native 0.86.3 and React 19.2.3. Use the committed pnpm lockfile, workspace
configuration and patches together. Do not substitute npm or regenerate the
lockfile merely to install dependencies.

The maintainer environment observed on 24 October 2026 uses Node 26.12.1, pnpm
12.15.0 and Xcode 27.0. These are observed versions, not a tested minimum-version
support matrix. Native iOS development needs macOS, Xcode and a development build
containing the local Expo modules. Expo Go does not contain those modules.

From the repository root, the dependency and source-check commands are

```sh
cd apps/mobile
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:public
pnpm run doctor
```

From the repository root, host checks are

```sh
node --test host/openclaw/*.test.mjs
```

The public suite uses portable source and synthetic fixtures. The private
maintainer acceptance suite is kept separately and is not part of the source
snapshot. In the private checkout, `pnpm test` runs both suites and
`pnpm test:private` selects the private evidence and release-identity checks.
Separating those checks does not claim that physical acceptance has passed.

Some host acceptance checks require an explicit installed OpenClaw fixture.
Report skipped checks and the selected fixture rather than interpreting an
untargeted pass as live integration acceptance. Read the
[host setup](docs/CONTRIBUTOR_SETUP.md) before changing that integration.

## Local app and host setup

Use the explicit contributor configuration described in the setup guide.
`pnpm prebuild:contributor` generates its native project and
`pnpm ios:contributor` builds the isolated app. Contributor mode removes
maintainer signing, shared-Keychain and remote-update settings. Use a separate
checkout so native generation cannot overwrite a shipping build's configuration.
Do not use the production release lanes for a fork.

Vimicate connects to a separately configured OpenClaw Gateway. It is not an
agent backend, does not include model subscriptions and does not need a
contributor's provider credentials committed to this repository. Host compatibility
is fingerprinted. Stock OpenClaw 2026.10.6 has an isolated preparation recipe. Runtime compatibility,
Gateway activation, pairing and complete provider interaction are separate checks.

## Architecture and changes

- Keep domain rules in the owning connection, workspace, run, transcript,
  viewport, editor, media or persistence module.
- Components render state and dispatch typed intents. Native modules are narrow
  platform bridges, not a second application state owner.
- For a behavioral change, describe the failing event sequence and add the
  smallest regression at the owning boundary.
- Run focused tests, adjacent tests, TypeScript and the full suite as appropriate.
  Report Expo Doctor findings rather than silently upgrading dependencies.
- Physical keyboard, focus, paste, geometry and networking outcomes need device
  evidence. Unit tests alone do not establish them.

Keep commits focused and describe validation and remaining limits in your change.

## Safe reproduction and contributions

Use synthetic conversations and credentials in test fixtures. Do not attach
private chats, device databases, pairing codes, provider tokens, signed download
URLs or personal project registries. Inspect screenshots and logs before sharing.
Do not run live maintenance or migration scripts merely to reproduce a unit test.

Original project code is covered by the root MIT license. Preserve existing
upstream notices. Do not add code or assets without redistribution rights and
provenance. Keep contributions synthetic and independently reproducible.
