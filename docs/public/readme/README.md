# README visuals

These are documentation assets, not application icons or bundled product UI.

## Narrative illustration

The current README uses three separate transparent illustrations, generated
with built-in ImageGen on 25 October 2026. The earlier composite remains below
as provenance for their shared faceless character and print-illustration style.
The figures are conceptual representations, not portrait likenesses.

- `motivation-vim-v4.png` shows large Neovim-style terminal code. Its gutter
  reads 3, 2, 1, 42, 1, 2, 3 around the highlighted cursor row. The former large
  hjkl lettering is gone.
- `motivation-touch-v4.png` shows the iPad on the author's lap, a finger touching
  a visualization, and a dotted connection to a Mac Studio inside a home outline.
- `motivation-keyboard-v4.png` retains the approved right-hand scene's style,
  with the keyboard now on the author's lap at a café. The tablet sits on the
  table. Both iPad illustrations include an Apple Pencil along the top edge.

### Separate-scene prompt summary

Preserve the prior narrative's charcoal silhouette, tousled hair, cream contour
highlights, olive green and muted teal. Use transparent negative space instead
of a room or rectangular backdrop. Keep foreground furniture and devices opaque.
Use large, readable syntax-highlighted terminal text and hybrid relative line
numbers for the first scene. For the second, show touch interaction on a lap-held
iPad with a simple remote-home connection. For the third, keep the approved
keyboard-first scene recognizable while moving the keyboard onto the lap and
adding a café table, coffee and Pencil. Do not paint product screenshot pixels.

The palette follows the product's charcoal, cream, olive and muted-blue tokens.
Café furniture, coffee and hardware are narrative objects, not decorative UI
containers. Official HHKB and Apple iPad references below informed scale and
geometry. Apple's [Mac Studio reference](https://support.apple.com/en-sg/111900)
informed the compact silver computer and its front ports. Manufacturer reference
files are not bundled. Hands and perspective still obscure some keyboard keys.

All three images are 1536 by 1024 RGBA PNGs with true alpha transparency. About
36 to 39 percent of their pixels are fully transparent. Main-agent review checked
browser composites against light and product-charcoal backgrounds. The retained
RGBA pixels match the generated originals after ancillary-metadata removal.
The terminal is a generated illustration, not evidence of executable code.
The revised local README was rendered at 390, 1024 and 1440 pixel widths.
All images loaded without horizontal overflow. Full iPad captures need zooming
to read fine UI text at phone width. This was local Markdown layout review,
not verification of GitHub's final rendering.

### Earlier composite

`motivation-evolution-v2.png` is a conceptual ImageGen illustration created
and revised on 25 October 2026. The faceless figure represents the author's
workflow, not a portrait. The tablet interface is illustrative, not an app
capture. The cream, charcoal, olive and muted teal palette follows Vimicate.

The revision reduces the tablet size and uses the HHKB Professional HYBRID
US layout as its hardware reference. The manufacturer specifies a 294 mm
keyboard width. Apple's 13-inch iPad Air is 280.6 mm wide in landscape, so
the tablet is drawn slightly narrower than the foreground keyboard.

The official keyboard photograph informed the five-row layout, lower corner
blockers and five-key bottom row. It was first translated into an illustrated
hardware study and then supplied as a reference for the narrative revision.
Hands and perspective obscure some keys. This is not a technical layout diagram.
The manufacturer photograph is not distributed with the source snapshot.

References are the [official HHKB specifications](https://www.hhkeyboard.com/uk/products/hybrid),
the [official keyboard photograph](https://www.hhkeyboard.com/_assets/images/products-pages/hhkb-hybrid-white-printed.webp)
and [Apple's iPad Air dimensions](https://www.apple.com/ipad-air/specs/).

### Prompt summary

Preserve the three-scene Vim, Agents, Vimicate silhouette narrative, palette
and captions. Reduce the landscape tablet to realistic scale relative to a
294 mm HHKB. Follow the official US keyboard layout with four staggered
upper rows, five bottom keys, large lower corner blockers, Control beside A,
and short right Shift beside Fn. Omit a function row, arrow cluster and numpad.
Use the illustrated keyboard study as the geometry reference. Keep both hands
on the keyboard and retain the conceptual Vimicate screen.

## Simulator captures

The three `ten-projects-v2` screenshots were captured on 25 October 2026 from
the unchanged contributor Release app in a landscape iPad Air simulator at
2732 by 2048 pixels. An isolated loopback protocol fixture supplied synthetic
projects, messages, files, activity times and lifecycle events. It never
forwarded requests to production. No real project, transcript or user account
was used. The fictional work labels do not represent institutional records.

The native latest-activity setting is enabled. All ten projects fit in the
sidebar, with five home and five work labels. The workspace shows running,
failed and unread dots. The files capture also shows waiting diamonds after
the fixture's wait-timeout response. These are the actual app's indicators,
not painted overlays. The shortcuts capture shows the native help reference.

The demo worker captured and visually reviewed all three images. The main
agent independently inspected them. Native UI checks passed for the ten-project
list, files and shortcuts. The isolated app and fixture were stopped after
capture. These captures do not establish physical keyboard or device acceptance.

### Backend and question examples

The two `v3` conversation captures extend the same isolated demo with distinct
synthetic sessions. `codex-astra-question-v3.png` shows Codex, Astra and high
reasoning effort. `claude-opus-workspace-v3.png` shows claude-cli and Opus 5.5.
The backend, model and reasoning labels are fixture-supplied session metadata
rendered by the unchanged app. They do not establish a live model connection.

The conversations include substantive progress commentary and native
interactive question cards. These are synthetic demo messages, not actual
agent work or model-generated outcomes. The ten-project latest-activity list,
home and work labels, and lifecycle indicators remain part of the demo.

The demo worker captured and visually reviewed both images at 2732 by 2048
pixels. The main agent independently inspected them. Three focused native
capture checks passed for model headers, question controls and layout. Choice
submission was not exercised in this capture pass. The isolated app and fixture
were stopped after capture. No product source or screenshot pixels were changed.

### Colon command completion

`model-command-completion-v4.png` is a real 2732 by 2048 capture from the same
isolated contributor app and fictional ten-project fixture. The native colon
command input contains `model ` after its separate colon prefix. The completion
menu lists `openai/gpt-6-astra` and `anthropic/claude-opus-5-5` supplied by the
synthetic model catalogue. No model command was submitted.

A focused native XCTest passed in 17.8 seconds, checking both completion
options, the input value, latest-activity sort and the tenth project. The worker
and main agent inspected the final PNG. The transcript shows commentary and
question options, with question submission controls below its viewport.
Model selection, provider execution and physical keyboard acceptance were not
tested by this capture. The isolated app and owned fixture were stopped.

### Vim navigation loop

`vim-navigation-v5.gif` presents 16 native iPad capture states as a 24-second
edited loop. Each state is held for 1.5 seconds. It is not continuous real-time
footage. The app UI comes from the unchanged contributor Release build and the
isolated ten-project fixture. All 956 contributor source inputs matched the
published source snapshot.

Native XCTest key events moved through the project list with j, k, G and gg,
focused the transcript with Ctrl-K, moved by word and selected text, then focused
the prompt with Ctrl-J. The prompt sequence enters Insert mode, types a short
instruction, returns to Normal mode, moves with gg, w and b, and selects text in
Visual mode. Exits use Ctrl-[. No prompt or question answer was submitted.
The final capture test passed in 47.5 seconds.

The main agent composed a translucent top annotation from the exact keys sent.
It uses the app's charcoal background, olive highlight and cream text in Menlo.
Chromium applies the original PNG orientation, scales the landscape capture to
1366 by 1024, and composites the annotation. FFmpeg encodes the sequence at eight
frames per second with a shared palette and infinite loop. Original captures
remain unchanged. The output contains no comment or custom application metadata.
The standard NETSCAPE loop extension is retained.

The capture worker reviewed the native states. The main agent independently
reviewed the composited states and encoded playback. This demonstrates the
captured software interactions, not physical keyboard acceptance.

### Markdown yank and prompt editing

`vim-navigation-v6.gif` extends the navigation demo with 23 native capture states
held for approximately 32 seconds. The unchanged contributor build matched all
956 published source inputs. An isolated loopback fixture supplied the short
Markdown checklist. The sequence is edited capture states, not real-time footage.

After project and transcript motions, V and 2j select the checklist heading and
two list items. The native y register preserves the original `##` heading and
hyphen-prefixed Markdown lines. Ctrl-J focuses the empty prompt and p pastes the
section. Native XCTest asserts that the pasted text exactly equals its source.
No clipboard or prompt-content injection was used for the demonstrated paste.

The prompt sequence uses gg and O to add `# Field guide` above the pasted section.
Ctrl-[ returns to Normal mode, then G, $, b and cw change the final word from
`later` to `after camp`. A final gg, V and j selects both Markdown headings.
Literal text was entered through native hardware-key events. The captures show
the completed strings rather than every typed character. No prompt was submitted.
The final native test passed in 67.5 seconds, including exact pasted and edited
text assertions. The capture worker stopped the owned app and loopback fixture.

The main agent used the same translucent annotation and palette encoding as v5.
Original capture hashes were unchanged. The worker reviewed native states, and
the main agent independently inspected the composed states and encoded playback.
Local README review covered 390, 1024 and 1440 pixel widths. These checks do not
establish physical keyboard acceptance or GitHub-hosted playback. The previous
v5 animation and iPhone captures are retained unchanged.

### iPhone layouts

The three `iphone-*-v5.png` images were captured at 1206 by 2622 pixels from the
unchanged contributor app in an isolated iPhone simulator. The project drawer
shows ten projects in latest-activity order with home and work labels and native
activity indicators. The conversation shows a question card with Quick note
selected. The files pane shows a Markdown preview and the native Share control.

The final native capture test passed in 15.7 seconds. It checked project order
and visibility, question selection and accessible controls, and file preview
headings. Question submission, sharing and provider execution were not tested.
The footer remains horizontally scrollable at phone width. Both the worker and
main agent inspected all three final PNGs. Owned fixtures and apps were stopped.

## Metadata and provenance

Ancillary PNG metadata was removed without re-encoding. Chunk lengths and CRCs
were validated, IEND was checked, and the retained IHDR and IDAT chunks were
verified byte-for-byte. The asset provenance manifest records final hashes.
The standalone PNG screenshots' pixels are unchanged. The GIF is a scaled,
palette-encoded sequence with an added keystroke overlay. The narrative remains generated artwork.

### Content-sized keystroke annotation

`vim-navigation-v7.gif` retains the v6 source captures, interactions and timing.
The main agent revised and reviewed only the presentation layer. The annotation
fits its longest text line with 12 pixels of padding on either side, replacing
the fixed 650-pixel box. Key text increases from 26 to 36 pixels and captions
from 14 to 20 pixels for readability when the README scales the animation.
The charcoal background is 60 percent opaque, down from 88 percent.
These requested size and opacity adjustments are presentation-specific
exceptions. Menlo, charcoal, olive and cream remain from the product palette.
The border groups the key with its action caption, without decorative effects.

Original capture hashes remain unchanged. Review covers every encoded state,
the loop boundary and README layouts at 390, 1024 and 1440 pixels. The earlier
versions remain available. Local playback review does not establish hosted or
chat-client playback.

## Larger-text refresh

The nine v8 screenshots use the same contributor Release app and synthetic
loopback content. The iPad captures use 200% project text in a wider sidebar
and 150% transcript, prompt and file text. The iPhone captures use 150% text
so all ten project names fit in its compact drawer. Native command and help
chrome retain their existing sizes. Scrollable content beyond each viewport
remains offscreen.

The capture workers completed native checks for the six iPad and three iPhone
scenes. The main agent recovered their saved captures and evidence, independently
inspected all nine final images, and completed documentation integration.
No provider execution, answer submission or physical-device acceptance is implied.

`vim-navigation-v8.gif` uses 27 verified native capture states. It shows project
navigation, `/` search for Field Notes, Return to highlight the match, and `l`
to open it. The remaining sequence yanks original Markdown, pastes it into an
empty prompt, adds a heading, edits a word and selects the headings. The native
capture test passed with exact draft assertions. The 39.4-second GIF is an edited
sequence with retimed holds and separate keystroke annotations, not a continuous
real-time recording. The main agent rendered the recovered frames and inspected
encoded playback, including its return to the first state.

## Developing Vimicate from Vimicate

`vimicate-self-development-v1.png` is a real iPad simulator capture with a
synthetic Vimicate development thread. Its unsubmitted draft asks for a colon
command and tap button to start a Ralph loop for the current feature. This is
an example feature request, not evidence that those controls are implemented.
The conversation and backend labels are synthetic, not a live provider result.
The main agent captured and reviewed it. Native XCTest checked the selected
project and exact draft text. The fixture was isolated from production.

All current README images use 60% width. Readers can open the full-size files
to inspect fine interface text, especially on narrow screens.
