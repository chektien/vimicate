# Third-party notices

This file preserves notices for third-party material shipped in this source
repository. Original Vimicate code uses the root [MIT license](LICENSE), with
copyright held by Chek Tien Tan.

Installed dependencies retain their own licenses. If you distribute a compiled
app or host bundle, include the notices required by its actual contents as well.

## Expo scaffolding and module template

The five retained Expo template artwork files are byte-identical to
`expo-template-blank@57.0.33`. They are the three Android icon variants, favicon
and splash icon. The package archive includes the MIT notice below, despite its
registry metadata declaring 0BSD. We retain the shipped notice. Exact hashes and
source locations are recorded in [asset provenance](docs/release/ASSET_PROVENANCE.json).

The existing license files in `apps/mobile/LICENSE` and
`apps/mobile/modules/vimicate-editor/LICENSE` remain unchanged. Their notice is
reproduced below. It is not a statement that Expo owns original Vimicate changes.

```text
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Shopify FlashList

The repository distributes a modification patch for FlashList 2.3.2 in
`apps/mobile/patches/@shopify__flash-list@2.3.2.patch`. The following notice is
copied from that installed package's `LICENSE.md`. The patch records changes
rather than representing an unmodified upstream distribution.

```text
Copyright 2022-present, Shopify Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
