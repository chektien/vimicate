# Known limitations

Vimicate is an experimental agent surface for iPad and iPhone, released as a
source alpha. It is for people comfortable building an iOS app and operating
their own OpenClaw Gateway. It is not a ready-to-install app
or a supported production deployment.

## Platform and setup

- iPad and iPhone are the client targets. Android and web are not supported
  release targets, even if framework configuration contains defaults for them.
- Expo Go cannot load the local native modules. Use a native development or
  Release build.
- The [setup guide](CONTRIBUTOR_SETUP.md) targets stock OpenClaw 2026.10.6.
  The integration checks exact package contents, so newer or modified packages
  may be rejected even if their version looks compatible.
- You supply your own model access and Gateway. Physical-device builds also
  need your own Apple development signing and a reachable, authenticated host.
- Contributor builds have OTA updates disabled. Native changes require a new
  app build even when using your own OTA configuration.

## Behavior to check on your installation

Automated tests and simulator checks cover synthetic interactions. They do not
establish fresh-machine installation or a complete interaction with every real
provider. Physical iPad testing is partial, not an exhaustive device matrix.

In particular, check transcript visibility after reconnecting or changing
projects, attribution of updates to the correct session, and structured-question
answer/resume behavior with your chosen provider. Intermittent transcript
blanking and these live integration paths still need broader verification.
Do not use this alpha as the only archive of irreplaceable conversations or
rely on it for unattended work without checking those paths yourself.

PDF preview keyboard fixes require a newly built native app. An OTA cannot add
them to an older binary. Keyboard, focus, paste and layout behavior should be
checked on the physical device and keyboard you use.

## If something goes wrong

Keep the Gateway's history and backups. A display problem is not a reason to
delete a conversation, reset a session or reinstall the app.

Use the [setup troubleshooting table](CONTRIBUTOR_SETUP.md#troubleshooting) for
connection and build problems. For reproducible bugs, follow
[the bug-report guide](../CONTRIBUTING.md#report-a-bug). Share a synthetic example
and the relevant versions, not private transcripts or credentials.

Send security-sensitive reports through [Security reporting](../SECURITY.md).
