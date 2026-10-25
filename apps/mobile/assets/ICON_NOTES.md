# Vimicate icon — 30 August 2026

`icon.png` is the canonical app icon referenced by `app.json`. It uses a
console-style monospace wordmark without the former RN subtitle. The
replacement retains lowercase `hjkl`, warm cream and dark charcoal, with heavier
equal-cell lettering and no subtitle. Visually checked after final packaging.

- Final asset: `apps/mobile/assets/icon.png` from the repository root.
- Format: 1024 × 1024 RGB PNG; no alpha channel.
- SHA-256: `e0e825402c0e1213e45c9f7e5806b45ff2b05217c8ef1aec8fde40c271e3bf46`.
- Created using the built-in image-generation edit tool, with the preceding
  `icon.png` as its only input. The tool returned a 1254 × 1254 RGB image;
  `sips` resized it to the iOS catalog's required 1024 × 1024 size.
- Metadata-only sanitization on 25 October removed embedded provenance metadata.
  Image data and decoded pixels are unchanged. Regenerate the ignored iOS
  catalog from the canonical `app.json` asset before archiving. Do not restore
  an older generated catalog. On 25 October 2026 the copyright holder confirmed
  that the preceding icon was original project artwork, created or generated
  for the project without third-party source artwork.
- No app build or update was distributed for this asset change. Home Screen
  name/icon changes require the next TestFlight binary, not an Expo OTA.

## Final generation prompt

Use case: text-localization / logo-brand.
Asset type: finished iOS app icon bitmap for Vimicate.
Input image 1 is the edit target, the current Vimicate icon.
Primary request: remove the small "RN" subtitle completely and replace the thin main lettering with a clear, medium-bold console-style monospace wordmark. Preserve the app's restrained existing visual identity.
Text (verbatim): "hjkl" — exactly four lowercase letters h, j, k, l. No other text anywhere.
Typography: authentic terminal/editor monospace, equal character cells, clean upright strokes, recognisable lowercase j descender and lowercase l with a foot. A crisp, slightly squared modern console face, medium-bold weight, not ornamental, not handwriting, no ligatures. Main lettering should be clearly stronger and more readable at small app-icon size than the reference.
Composition: optically center the single four-letter wordmark both horizontally and vertically; generous balanced empty space; wordmark approximately 62% of the full canvas width. No subtitle or extra symbol.
Invariants: retain the full-bleed flat warm cream background and dark charcoal foreground of the reference. Keep the minimal two-colour appearance. No gradients, texture, bevels, glow, outlines, drop shadows, terminal window frame, cursor, arrows, rounded-corner mask, border, extra letters or watermark.
Output: square 1024×1024 app-icon artwork, fully opaque edge to edge, sharp clean glyph contours.
