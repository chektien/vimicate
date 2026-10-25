# Source-alpha limitations

This describes the candidate source release, not a claim that every historical
device report is resolved. The alpha is for technically experienced users who
can build an iOS app and operate their own OpenClaw Gateway.

## Supported boundary

- iPad and iPhone are the supported client targets. Android and web are not
  accepted release targets, even where framework configuration contains defaults.
- Native modules require a development or Release build. Expo Go is insufficient.
- The host integration is version and content fingerprinted. An unreviewed
  OpenClaw package fails closed rather than importing incompatible internals.
- This source release does not distribute an Apple-signed app, an OpenClaw
  installation, provider accounts or model subscriptions.

## Acceptance still in progress

The current candidate has automated source and simulator coverage plus selected
physical iPad checks. An isolated stock-host check passed new-device pairing,
a deterministic prompt/question/answer cycle and cold-relaunch persistence.
Fresh-machine installation and a complete real-provider interaction remain
separate acceptance gates. Neither is established by that deterministic fixture.

Recent local repairs address PDF preview keyboard ownership, transcript
auto-follow, retired async answers and overlapping project-switch requests.
The PDF correction changes native code and requires a newly built app. An OTA
cannot add that correction to an older native binary.

Broader intermittent transcript blanking, native run identity attribution and
real provider answer/resume still require bounded live acceptance. Do not treat
the source alpha as suitable for irreplaceable transcript archives or unattended
workflows until those paths have been verified on your installation.

## Recovery and reports

Keep the Gateway's own history and backups as the authority. Do not delete a
conversation, reset a session or reinstall the app merely to hide a rendering
problem. Preserve a synthetic reproduction when possible, including the exact
app revision, host version, device model and the event sequence.

Do not put pairing codes, tokens, private transcripts, device databases or signed
download URLs in public issues. Use the private reporting route in [SECURITY.md](../SECURITY.md). No response-time
guarantee is offered.
