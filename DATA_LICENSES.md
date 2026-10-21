# Data sources and licenses

The code in this repository is licensed under the GNU Lesser General Public License v3.0 or later
(see `COPYING.LESSER` and `COPYING`). The data files below come from other projects and keep their
own licenses. The built HTML file contains all of them; each part remains under its own license.

## FPbase spectra — CC BY-SA 4.0

- **File:** `data/fpbase_spectra.txt` (271 excitation/absorption + emission spectrum pairs)
- **Source:** [FPbase](https://www.fpbase.org), via its GraphQL API, retrieved 2026-10-20. The
  name → FPbase record mapping is in `tools/fpbase_sources.json`, and `tools/fetch_fpbase.mjs`
  regenerates the file.
- **License:** [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  FPbase compiles spectra from manufacturers and the literature; the original source of each
  spectrum is listed on its FPbase page.
- **Changes:** resampled to a 4 nm grid (300–940 nm), normalized to peak, square-root quantized to
  64 levels and base64url-encoded. This derived file is shared under the same license.
- **Citation:** Lambert TJ. FPbase: a community-editable fluorescent protein database.
  *Nat Methods* 16, 277–278 (2019). doi:10.1038/s41592-019-0352-8

## Approximate spectra — LGPL-3.0-or-later (this project)

`DERIVED` in `src/data_lib.js` builds spectra for dyes FPbase does not list by combining and
shifting FPbase spectra (see docs/METHODS.md). These are planning approximations, not measured data.
Peak positions come from manufacturers' published specifications.

## Honeychrome measured reference libraries — LGPL-3.0

- **File:** `data/honeychrome_library.json` (Cytek Aurora: 93 fluors × 64 channels; Sony ID7000:
  65 fluors × 182 channels)
- **Source:** the `Aurora_spectral_reference_library.csv` and `ID7000_spectral_reference_library.csv`
  files shipped with [Honeychrome](https://github.com/Cytkit/honeychrome) © Cytkit contributors.
  Regenerate with `tools/extract_honeychrome_library.py`.
- **License:** GNU Lesser General Public License v3.0.
- **Changes:** negative values clipped to 0, normalized to peak, square-root quantized to 64 levels
  and encoded one character per channel; "-A" suffixes dropped from channel names.

## Trademarks

Dye, reagent and instrument names (for example Brilliant Violet™, BD Horizon™, Alexa Fluor®,
NovaFluor™, cFluor®, Spark™, StarBright™, Cytek® Aurora, Sony ID7000™) are trademarks of their
owners and are used only to identify products. This project is not affiliated with or endorsed by
any of them.
