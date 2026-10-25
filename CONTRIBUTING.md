# Contributing to Vimicate

Vimicate is a keyboard-first agent surface for iPad and iPhone.

Start with [contributor setup](docs/CONTRIBUTOR_SETUP.md) to build the app and
connect your own Gateway. Read [known limitations](docs/KNOWN_LIMITATIONS.md)
before choosing a change. Report vulnerabilities through
[Security reporting](SECURITY.md), not a public issue.

## Find the code

| Area | Location |
| --- | --- |
| App state, UI and portable tests | `apps/mobile/src` |
| Native keyboard and file integrations | `apps/mobile/modules` |
| OpenClaw plugin, host tools and tests | `host/openclaw` |
| Setup and current limitations | `docs` |

The mobile project uses Expo SDK 57, React Native 0.86.3 and React 19.2.3.
Use the committed pnpm lockfile, workspace configuration and patches. Do not
regenerate the lockfile just to install dependencies. Toolchain versions and
native build commands live in the [setup guide](docs/CONTRIBUTOR_SETUP.md#toolchain).

## Run checks

From `apps/mobile`, run the mobile source checks.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:public
pnpm run doctor
```

Report Expo Doctor findings rather than updating dependencies as an unrelated
fix. For native changes, regenerate and rebuild the contributor app as well.

From the repository root, run the host tests.

```sh
node --test host/openclaw/*.test.mjs
```

Some host tests skip unless you supply an installed OpenClaw package. After
[setting up the host environment](docs/CONTRIBUTOR_SETUP.md#set-the-host-environment),
run the package-dependent checks explicitly.

```sh
OPENCLAW_HISTORY_TEST_PACKAGE_ROOT="$CONTRIBUTOR_OPENCLAW_PACKAGE" \
  node --test host/openclaw/prepare-contributor-host.test.mjs \
  host/openclaw/sqlite-history-runtime-acceptance.test.mjs \
  host/openclaw/sqlite-plugin-runtime-acceptance.test.mjs
```

Include skipped checks in your test results. Synthetic tests do not establish
real-provider, device-networking or physical-keyboard behavior. Use the
[interaction checklist](docs/CONTRIBUTOR_SETUP.md#pair-and-check-a-complete-interaction)
when changing the app's Gateway integration.

## Make a focused change

- Keep domain rules in the owning connection, workspace, run, transcript,
  viewport, editor, media or persistence module.
- Components render state and dispatch typed intents. Native modules are narrow
  platform bridges, not a second application-state implementation.
- For a behavior change, describe the failing event sequence and add a focused
  regression test at the owner of that behavior.
- Run relevant tests and TypeScript. Include a native build when changing native
  modules, dependencies or configuration.
- Check keyboard, focus, paste, layout and networking changes on the relevant
  device. Say which device you used and what you did not test.

Use synthetic conversations and credentials in fixtures. Keep commits focused.
Preserve upstream notices and include provenance for new code or artwork that
requires attribution. Original project code uses the root [MIT license](LICENSE).

## Report a bug

Open a [GitHub issue](https://github.com/chektien/vimicate/issues) with the app
commit, OpenClaw version, device and OS, steps to reproduce, expected behavior
and actual behavior. A short synthetic conversation or redacted screenshot is
more useful than a full private transcript.

Do not attach pairing codes, provider tokens, device databases, signed download
URLs or personal project registries. Do not reset sessions, run maintenance
scripts or reinstall the app just to hide a rendering problem. Keep the Gateway's
history and backups intact.

## Submit a pull request

Describe the problem, the change and how you checked it. For UI changes, include
a screenshot or short recording using synthetic content. Mention any checks you
could not run and any remaining limitations. Avoid combining a feature with
unrelated dependency upgrades or formatting changes.
