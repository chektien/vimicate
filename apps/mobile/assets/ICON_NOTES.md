# App icon

[`icon.png`](icon.png) is the canonical app icon, shared by the production and
contributor configurations and the README header. It is an opaque 1024 by 1024
RGB PNG with green `hjkl` lettering on charcoal.

## Updating the icon

Use this file as the single source for generated native icon catalogs. Keep it
opaque and square, without a rounded-corner mask, subtitle or frame. Regenerate
the iOS catalog from this asset rather than copying an old catalog.

App-icon changes require rebuilding and reinstalling the native app. An Expo
OTA update cannot replace the installed Home Screen icon. Use the
[contributor build instructions](../../../docs/CONTRIBUTOR_SETUP.md#build-the-contributor-app).
The Android, favicon and splash template assets are not referenced by the
current iOS app configuration.

## Provenance

The artwork was generated with ImageGen from the original project `hjkl` icon,
using the owner's Artifactured wordmark as a lettering reference. The requested
lettering is an Avenir Next Demi Bold-inspired monospace interpretation, not
an official font or a metric-verified typeface. No font software is distributed.
The preceding icon was original project artwork without third-party source
artwork.

The color edit requested the product's charcoal canvas and olive-green
highlight. The raster retains slight tonal variation rather than exact flat
color values. Expo's icon pipeline sized the recovered artwork to an opaque
1024 by 1024 production asset without redrawing the lettering. Ancillary
metadata was removed while retaining the generated image data.

The file's hash and origin are recorded in the
[asset manifest](../../../docs/release/ASSET_PROVENANCE.json).
