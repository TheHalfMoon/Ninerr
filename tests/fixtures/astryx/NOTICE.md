# Astryx fixtures

These files come from Meta Astryx (https://github.com/meta/astryx) and are used only by tests.

- `astryx-tokens.css`: the `:root` rules of `.github/pages/assets/astryx.css` at commit `2309691dba9533635259113316a2cb14ec832933`, verbatim, with this license in its header.
- `theme-neutral.css`: `.github/pages/assets/theme.css` (the neutral theme) at that commit, verbatim after a header with this license.
- `login-card.html`: Astryx's own `login-card` page template, rendered by its static renderer, byte for byte as it wrote it: `npx astryx experimental render pages/login-card/page.tsx`, with `@astryxdesign/cli` and `@astryxdesign/core` 0.7.11 from npm (`@astryxdesign/cli@0.7.11` integrity `sha512-nCmG4bvA2d/RazTHwRRD7gckrTh1GEj1NBNZjfb2mPrLNgWpSPy2YVS/ICEj2O9fuGrac1vCdPfloeWkaRk+Lg==`), React 19.2.0, `@stylexjs/stylex` 0.19.0 and `@heroicons/react` 2.2.0 (MIT), installed with install scripts off, outside Ninerr, on 2026-11-10. 0.7.11 is the latest release; the commit the component records come from is unreleased. The page embeds its template source in a `<script type="application/x-astryx-source">` block, which Ninerr's import removes like any script.

MIT License

Copyright (c) 2026 Meta Platforms, Inc.

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
