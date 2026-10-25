# File previews and sharing

This local Expo module provides document previews, interactive HTML previews
and native file sharing. Native capability checks let callers show an
update-required message when an installed app is too old.

## API overview

| Export | Use |
| --- | --- |
| `VimicateFilePreviewView` | PDF, Office, RTF and other eligible document previews |
| `isVimicateFilePreviewAvailable()` | Check document-preview support |
| `VimicateHTMLPreviewView` | Isolated HTML preview |
| `isVimicateHTMLPreviewAvailable()` | Check HTML-preview support |
| `shareVimicateFile(...)` | Share the original bytes through the native sheet |
| `isVimicateFileShareAvailable()` | Check native sharing support |
| `maximumVimicateFileShareBytes()` | Read the installed binary's sharing limit |

Import these named exports from this module's `index.ts`. Gate the view or
operation on its capability check before using it. Native additions require a
new app build, not just a JavaScript update.

## Document preview

The module retains its existing `openLocalPath` and `materializeLocalImage`
functions. Host transcript links must not use those functions as a fallback.

`VimicateFilePreviewView` is a nullable React component. `isVimicateFilePreviewAvailable()` also returns
its availability. An old native binary without `supportsInlinePreview === true`
returns `null` without attempting to load a native view. Render the app's native
update-required notice in that case. A native rebuild is required for this view.

The component accepts normal React Native `ViewProps` plus required
`dataBase64`, `filename`, and `mimeType` strings. The optional
`onPreviewStatus` callback receives `{ nativeEvent: { status, message? } }`.
`status` is `ready`, `unsupported`, or `error`. Keep the selected Files item when
unsupported or errored, and display the message. For RTF, `ready` means the
passive rich-text view is mounted. For other documents it means Quick Look
accepted the staged item, not that a corrupt document is guaranteed to render.
The native module/view lookup name is `VimicateFileLinks`.

Preview candidates are PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, RTF, Pages, Numbers,
Keynote (`.key`), MP3/M4A/AAC/WAV/AIF/AIFF/CAF, MP4/M4V/MOV, and ZIP. This is
an eligibility list, not a support guarantee. Apple's per-item
`QLPreviewController.canPreview` check is authoritative for non-RTF items. HTML, SVG, script,
link, macro-enabled Office, executable and unknown extensions are rejected.
No WebView, external Files picker, editing, or external-link fallback is used.

### Storage and lifecycle

Cache files contain at most 8 MiB decoded bytes, in unique private temporary
directories. The native view detaches Quick Look before removing its file on
replacement, removal or backgrounding. Foregrounding restages the selected
file. At 30 minutes, it removes the active preview and emits a helpful expiry
error. The Files UI should offer a retry/remount of the component, retaining
selection. Reap expired interrupted-process directories on the next staging
attempt. No app-state snapshot or provider bookmark is stored by this owner.

### RTF

RTF uses a passive native text view instead of Quick Look so it does not take
keyboard focus from Vimicate. One staging worker imports RTF off the main thread.
The view renders fonts and underlining and scrolls without becoming first
responder. It is noneditable and nonselectable. No HTML conversion is used.
RTF preview is bounded to 256 KiB input, 32 Ki UTF-16 output, 64 nesting levels
and 4,096 groups. Malformed groups, binary/embedded objects and excessive font
or numeric parameters are rejected before import. Sharing retains exact original
bytes and its independent 32 MiB limit. A five-second preparation deadline prevents
an indefinite notice. Cancelled work drains without publishing a stale result.
This renderer change needs a native build, not an OTA or Gateway change.

Changed props invalidate previous work. One background staging job drains at a
time, with only one replaceable latest request retained. Disposed, cancelled,
or superseded work cannot publish a preview and its staged file is released.

## Interactive HTML and native sharing

`VimicateHTMLPreviewView` is a separate optional native view, registered as
`VimicateFileLinks` / `HTMLPreview`. It accepts the same props and status event
as the document view. `isVimicateHTMLPreviewAvailable()` gates older binaries
without asking them to resolve an unavailable native view. Complete canonical
base64 UTF-8 `.html`/`.htm` input is limited to 1 MiB. Quick Look still rejects
HTML. There is no active-content fallback through its file path.

WebKit renders the original document after an enforced restrictive CSP.
Inline scripts/styles and embedded data/blob assets support standalone mockups.
External resources, sibling files, forms leaving the document, popups and
outbound navigation are blocked. Same-document anchors remain supported. The
native web data store is nonpersistent and has no JS-to-app bridge, file grants,
automatic media permission, cookie sharing or external opener. Pinch zoom is
available even when the author's viewport disables it. `ready` events may carry
a notice about blocked links. Keep the rendered document visible for notices.
Backgrounding or disposal destroys the view. Foregrounding rebuilds the selected
file. Source/Preview switches should hide, not remount, a ready view to retain
interactive state. Error UI can remount explicitly for Retry preview.

`shareVimicateFile(dataBase64, filename, mimeType, anchor?)` shares exact original
file bytes, never the CSP-transformed preview or a source-text excerpt.
`isVimicateFileShareAvailable()` gates native support. Anchor is the share
button's measured window rectangle, used for the iPad popover. It returns
`{ status: 'shared' | 'cancelled' }`, or rejects on staging/presentation failure.
Sharing preserves safe basenames, including dotfiles, accepts empty files and
is bounded to 32 MiB. `maximumVimicateFileShareBytes()` uses the native
`maximumFileShareBytes` capability, treating older sharing binaries as 8 MiB
and binaries without sharing as unavailable. One share operation owns its unique private temporary file
until completion/cancellation, module destruction or the 30-minute expiry.
Only an active foreground presenter may show the sheet. UIKit provides the
compatible app and Save to Files choices. HTML preview limitations do not alter
the file handed to those apps.

Both capabilities require a newly built native app. An OTA alone cannot add
WebKit or share-sheet bridge registrations to an older binary.

### Originals when preview is unavailable

`ProjectFileShareFallback` offers Share / Open in after a failed or unsupported
Files preview. Nothing is fetched until the user taps. The existing
`operator.read` authority and registered project, iCloud Downloads or assistant
artifact root are reused by `vimicate.files.exportChunk`. No download URL,
new root or provider grant is introduced. Preview reads retain their 1 MiB text
and 8 MiB image/document bounds.

An original transfer is capped at 32 MiB and uses sequential 192 KiB raw chunks
(at most 256 KiB of base64 per RPC). Every chunk validates scope, relative path,
selected size/timestamp, byte count, canonical encoding and stable descriptor
version. Changing files fail closed. Cancellation, selection changes, pane
disposal and backgrounding prevent a pending transfer from opening a chooser.
Each RPC is bounded to 20 seconds and the transfer to five minutes. Cancelled
in-flight RPCs drain without fetching another chunk or publishing contents.
Once explicitly presented, UIKit and the native sharing owner hold the tapped
snapshot until completion, cancellation or the existing 30-minute expiry.

Sharing above 8 MiB requires a new native build declaring the larger bound and
the updated Gateway plugin. Old binaries explain the required update before
downloading. An older Gateway fails without trying another root or transport.

## Build and test

From `apps/mobile`, run the shipped Foundation tests.

```sh
swift test --package-path modules/vimicate-file-links
```

These cover the Foundation policies and mapping owners, not UIKit, Quick Look
or WebKit integration. For native view changes, regenerate the contributor
project and build the app using the [setup guide](../../../../docs/CONTRIBUTOR_SETUP.md#build-the-contributor-app).
Check document rendering, keyboard focus, background/foreground behavior and
sharing in the built app. Include iPad share-popover placement when changing
the sharing API.

## API references

- [Expo module API](https://docs.expo.dev/modules/module-api/)
- [Apple Quick Look](https://developer.apple.com/documentation/quicklook/qlpreviewcontroller)
- [Apple preview support check](https://developer.apple.com/documentation/quicklook/qlpreviewcontroller/canpreview(_:))
- [Apple containment lifecycle](https://developer.apple.com/documentation/uikit/creating-a-custom-container-view-controller)
