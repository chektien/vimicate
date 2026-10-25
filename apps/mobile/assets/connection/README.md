# Connection plug artwork

[ConnectionStatusControl](../../src/gateway/ConnectionStatusControl.tsx) uses
these transparent PNGs to show Gateway connection state.

| Asset | Shape |
| --- | --- |
| `plug-connected.png` | Joined, solid connector halves |
| `plug-disconnected.png` | Separated, outlined halves with visible prongs |

The component applies the current status color at runtime. Connected state uses
`colors.activeAccent`, so the image's original green does not determine the
on-screen color.

## Updating the artwork

Keep both images aligned to the same canvas, optical size and short cable stubs.
The connected silhouette and disconnected gap must remain distinguishable at
small toolbar sizes without relying on color alone. Use transparent backgrounds
and simple flat shapes without text, gradients, shadows or decorative frames.

## Provenance

These are original project assets generated with ImageGen. The disconnected
icon was created from the connected design as a reference. A later edit filled
the connected bodies while preserving their outline, placement and transparent
central seam. No third-party source artwork was used.

The original connected color is green and the disconnected strokes are cream.
Runtime tinting makes both follow the product palette. Exact hashes and origin
records are in the [asset manifest](../../../../docs/release/ASSET_PROVENANCE.json).
