# OpenClaw integration

This directory contains Vimicate's host-side OpenClaw plugin, its build tools
and tests. It connects the Vimicate agent surface to the Gateway, providing
project discovery, session history, progress updates and project-file access. OpenClaw remains responsible
for running the agent and storing its transcripts.

OpenClaw itself is installed separately. Cloning this repository or starting
the app does not install or activate the plugin.

## Install and connect

Follow the [contributor setup guide](../../docs/CONTRIBUTOR_SETUP.md#prepare-an-independent-stock-host)
to install OpenClaw, prepare the plugin in a new state directory, start a
Gateway and pair the app. The recipe targets stock `openclaw@2026.10.6` and does
not need existing history or another installation's configuration.

`prepare-contributor-host.mjs` takes three absolute paths.

```sh
node host/openclaw/prepare-contributor-host.mjs \
  /absolute/path/to/openclaw-package \
  /absolute/path/to/new-prepared-directory \
  /absolute/path/to/project
```

Run from the repository root. The package and project directories must exist,
as must the destination's parent directory. The destination itself must be new.
Use the setup guide's environment variables for a complete copyable example.

The command builds the plugin, registers an Example project, creates fresh
private history metadata and writes a configuration fragment. It prints the
resulting paths. It does not modify the installed package, merge a live
configuration or start a Gateway. Keep generated state and credentials outside
the source checkout.

## Find the implementation

| File | Responsibility |
| --- | --- |
| `sqlite-gateway-plugin.mjs` | Composes the project, history, progress and file APIs |
| `prepare-contributor-host.mjs` | Prepares a new standalone host configuration |
| `build-sqlite-plugin.mjs` | Builds the installable plugin artifact |
| `sqlite-history-runtime.mjs` | Loads a compatible OpenClaw history runtime |
| `session-run-truth.mjs` | Validates session and run identity |
| `project-files.mjs` | Handles authorized project-file access |

OpenClaw owns session generations, SQLite transcripts, resets and the run
lifecycle. The plugin does not keep a second transcript or use a JSONL fallback.
Its registry, import proof, history secret and bounded progress sidecar stay
in the selected private state directory.

## Compatibility

Runtime adapters verify exact package fingerprints before importing OpenClaw
internals. A version number alone is not enough. A newer or modified package
may be rejected until its compatibility is reviewed.

Session-scoped calls must identify a concrete session generation and pass the relevant
authority checks. Missing or changed identity must not fall back to the selected
project or another session. When extending compatibility, add a regression test
and check the actual package rather than weakening the fingerprint or identity
checks. Keep the plugin's integrity manifest aligned with its source.

## Test changes

From the repository root, run

```sh
node --test host/openclaw/*.test.mjs
```

These tests use synthetic files and sessions. Some installed-runtime checks
skip without a selected OpenClaw package. See
[package-dependent checks](../../CONTRIBUTING.md#run-checks) for those commands,
then use the [pairing checklist](../../docs/CONTRIBUTOR_SETUP.md#pair-and-check-a-complete-interaction)
to check your provider's behavior. See [known limitations](../../docs/KNOWN_LIMITATIONS.md)
for what still needs broader testing.

## Updating OpenClaw

Keep OpenClaw pinned to the version in the setup guide. Do not replace it with
`latest` or update a working installation in place just to try another version.
The repository includes a compatibility checker, not an automatic updater.

From the repository root, with the [host environment](../../docs/CONTRIBUTOR_SETUP.md#set-the-host-environment)
loaded, check the selected plugin against an exact target version.

```sh
node host/openclaw/check-update-compatibility.mjs \
  "$OPENCLAW_CONFIG_PATH" --tag 2026.10.6
```

This reads the enabled Vimicate plugin's compatibility metadata and verifies
its artifact integrity. It does not install anything, change configuration,
restart the Gateway or prove that the target package will work. If the
Vimicate plugin is not enabled in that configuration, the check is skipped.

When Vimicate documents support for another release, evaluate it in a new host
directory using that exact version. Keep your working installation and its
state intact. Run the [package-dependent tests](../../CONTRIBUTING.md#run-checks)
and the [interaction checklist](../../docs/CONTRIBUTOR_SETUP.md#pair-and-check-a-complete-interaction)
with your provider before switching. Back up your working configuration and
history before changing an installation that contains real conversations.

If compatibility or runtime fingerprint checks fail, stop and use the supported
version. Do not edit compatibility metadata or bypass the checks to force an
upgrade. The contributor setup creates fresh state and is not a history-migration
tool.

## Remote project folders

The optional registry-owned `file-roots` section exposes read-only SSH folders
through the existing Files RPCs. Without it, a project uses its Gateway-local
`repo`. An explicit set replaces that fallback entirely.

```markdown
## Example
- id: example
- repo: ~/repos/example/
- file-roots:
  - repo@work-mac: ~/repos/example/
  - research@gateway: ~/repos/example-research/
```

`gateway` means the Gateway machine. Other host names must already be registered
SSH aliases with batch authentication and verified host keys. Clients cannot
supply arbitrary hosts or filesystem roots. Each project accepts one to sixteen
uniquely named roots. The first root is primary for repository-relative links.
Qualified links use paths such as `repo@work-mac/docs/guide.md`.

Files initially lists host-labelled folders without contacting their hosts.
Opening one sends the packaged read-only helper over SSH stdin. No remote agent,
mount or persistent helper is installed. Symlink confinement, type and byte
limits, unchanged-file checks and versioned transfers apply on the owning host.
An invalid mapping or offline host fails without a stale local fallback.

Build the plugin from this source and complete the documented compatibility
checks before selecting it. Preserve the prior plugin and registry together for
rollback. Verify list, read, link resolution and original-file transfer using
synthetic data before using real project content. An older plugin may ignore
`file-roots`, so restoring only the plugin does not restore its access policy.
