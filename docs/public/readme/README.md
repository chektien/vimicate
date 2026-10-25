# README visuals

This directory contains documentation assets. The README header reuses the
canonical app icon from `apps/mobile/assets/icon.png`. Screenshots
show the real contributor app with synthetic projects, conversations, files and
model labels. They do not show private user data or demonstrate live provider
execution. Illustrations are generated artwork, not screenshots.

## Current assets

| Asset | Purpose |
| --- | --- |
| `motivation-vim-v4.png` | Conceptual Neovim editing scene |
| `motivation-touch-v4.png` | Conceptual iPad touch workflow connected to a home Mac |
| `motivation-keyboard-v4.png` | Conceptual keyboard-first iPad workflow at a café |
| `vim-navigation-v8.gif` | Project search, pane navigation, Markdown yank/paste and prompt editing |
| `workspace-ten-projects-v8.png` | Full workspace still linked from the README |
| `codex-astra-question-v8.png` | Structured question in a synthetic Codex session |
| `claude-opus-workspace-v8.png` | Synthetic conversation with a different backend |
| `model-command-completion-v8.png` | Native `:model` completion menu |
| `project-files-linked-v9.png` | A transcript link to the file open in the preview pane |
| `iphone-workspace-triptych-v9.png` | Project drawer, question and file preview on iPhone |
| `keyboard-shortcuts-ten-projects-v8.png` | Built-in keyboard reference |
| `vimicate-self-development-v2.png` | Starred Vimicate thread with an unsubmitted development prompt |

## Update an image

- Capture the actual app with synthetic content. Do not paint interface changes
  onto a screenshot or imply that a fixture response came from a live provider.
- Use the product's existing type, colors and layout. The larger-text captures
  use the app's text-size settings, not a redesigned interface.
- Keep screenshots caption-free in the root README. Use descriptive alt text
  and record provenance here and in the [asset manifest](../../release/ASSET_PROVENANCE.json).
- Keep the iPhone montage at 90% width and other screenshots and illustrations
  at 60%. The header icon uses a compact 96-pixel square. The three phones share
  one image so they cannot wrap onto separate lines.
- Check image loading, readability and horizontal overflow at narrow, tablet
  and desktop widths. Readers should be able to open the original for detail.
- Remove unnecessary embedded metadata without changing screenshot pixels.
  Update the manifest's hashes when replacing assets.

## Header icon

The README uses the same green-on-charcoal `hjkl` asset as the app. Its source,
lettering reference and production sizing are documented in the
[icon notes](../../../apps/mobile/assets/ICON_NOTES.md).

## Screenshot provenance

The screenshots come from isolated iPad and iPhone simulator sessions running
the contributor Release app. A local protocol fixture supplied ten synthetic
projects, messages, files, activity and backend metadata. No production session
or model was used. Backend names, model names and reasoning labels demonstrate
how the app renders session metadata, not provider availability or execution.

The larger-text iPad captures use 200% project text and 150% transcript, prompt
and file text. The iPhone captures use 150% text. Native command and help controls
keep their normal sizes. Content outside the viewport remains offscreen.

The self-development image stars the synthetic Vimicate project and shows an
unsubmitted draft. The linked-file image shows `field-guide.md` in both the
transcript link and the file preview.

The 3690 by 2622 iPhone montage combines the three `iphone-*-v8.png` captures
at their original resolution with 36-pixel transparent gaps. Its source-screen
pixels are unchanged. It is a composition of existing captures, not a newly
captured interaction.

## Animation provenance

The navigation GIF is an edited sequence of native capture states, not
continuous real-time footage. It shows project search, pane navigation,
yanking Markdown into the prompt and editing it with Vim commands. The paste
uses the app's register, not injected clipboard content. No prompt is submitted.

A translucent keystroke annotation is added above the captured workspace using
the product's Menlo, charcoal, cream and olive styling. The output is scaled
and palette-encoded with a repeating loop. Original captures are unaltered.
Simulator interaction does not establish physical-keyboard behavior.

## Illustration provenance

The three current narrative scenes were created with ImageGen from original
project illustrations. They share a faceless figure, transparent background,
and the product's charcoal, cream, olive and muted-teal palette. The figure
represents the author's workflow, not a portrait likeness. The terminal code
and tablet interfaces are conceptual artwork.

The earlier `motivation-evolution-v2.png` composite established the shared
character and style. Official hardware references informed proportions and
keyboard geometry. Manufacturer photographs are not redistributed.

- [HHKB Professional HYBRID specifications](https://www.hhkeyboard.com/uk/products/hybrid)
- [Official HHKB photograph](https://www.hhkeyboard.com/_assets/images/products-pages/hhkb-hybrid-white-printed.webp)
- [Apple iPad Air dimensions](https://www.apple.com/ipad-air/specs/)
- [Apple Mac Studio reference](https://support.apple.com/en-sg/111900)

The three current illustrations are 1536 by 1024 RGBA images. Ancillary metadata
was removed while retaining their image data. Earlier versioned assets remain
in this directory as source and provenance material. Exact shipped asset hashes
and origins are recorded in the [asset manifest](../../release/ASSET_PROVENANCE.json).
