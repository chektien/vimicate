# Connection plug artwork

Generated with the built-in `image_gen` tool on 21 September 2026 at the user's
request. These original transparent PNGs are used directly by
`src/gateway/ConnectionStatusControl.tsx`, with runtime tinting from the existing
status palette, with the connected state using the shared active highlight. No generated asset is referenced outside the repository.

- `plug-connected.png`: solid green joined connector halves (on).
- `plug-disconnected.png`: separated halves and visible prongs (off).

## Final connected refinement prompt

Refine this icon into a MUCH more compact toolbar symbol. Shorten left/right
cables drastically to tiny stubs, making the whole icon about 1.6 times wider
than tall. Remove small hollow strain-relief rectangles at cable ends. Two
simple rounded connector halves touching, thin central seam, no hollow central
band. Thicker uniform monoline stroke to read at 21px. Strict FLAT single
off-white #ebdbb2 with no gradient, no texture, no speckles. Transparent
background and interior negative space. Icon occupies most of canvas, tightly
cropped. Joined/on electrical plug connector, restrained and elegant, no text
or border.

## Disconnected prompt (connected artwork as reference)

Create the matching OFF / disconnected state of this compact electrical plug
icon. Preserve same style, off-white strokes, thickness, cable stub lengths,
optical scale, position and transparent canvas. Pull the two connector halves
apart horizontally to reveal TWO short horizontal parallel metal prongs
projecting right from the left half, with a clearly visible air gap before the
right half. Slightly narrower bodies to keep the exact same total outer width
as the reference. Shape is two actual plug halves separated, not chain links.
FLAT uniform off-white only, transparent background/interiors, no glow, no
gradient or texture, no text or additional symbols. One centered disconnected
icon only.

## Filled connected refinement (21 September follow-up)

Edit only this connected plug icon. Fill BOTH hollow connector bodies completely
SOLID GREEN #8ec07c; the connected/on version should be a solid filled silhouette,
NOT an outline. Preserve its exact external shape, position, dimensions, short
cable stubs and narrow transparent center seam separating the touching halves.
Keep the outer background genuinely transparent. Strict flat single-color green,
no texture, no gradient, no shadow, no glow, no text, no extra symbols. This is a
small toolbar icon paired with an unchanged outlined disconnected version. Keep
canvas dimensions/composition identical to reference.

Generated with built-in image_gen using the previous connected PNG as the edit
reference. The filled image replaces that asset at the user's request. Runtime
connected tint uses `colors.activeAccent` (#b0bd2a), matching active pane highlights
and overriding the original generated green. Disconnected artwork is unchanged.
