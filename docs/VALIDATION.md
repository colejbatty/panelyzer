# Validation

What has been checked, how to reproduce it, and where the tool is known to be weak.

## 1. Linear algebra against NumPy

`tests/fixtures/panel27_signatures.json` holds the simulated signatures of a 27-fluor Aurora panel.
`tests/fixtures/make_math_reference.py` computes the reference values with NumPy
(`panel27_numpy_reference.json`), and `tests/unit/engine_math.test.cjs` compares them with the
engine:

| Quantity | Engine | NumPy reference | Agreement |
|---|---|---|---|
| Complexity index (cond₂ S) | `complexityIndex` | `np.linalg.cond` | ≤ 1e-9 relative |
| Optimizer estimate of cond₂ S | `fastCond` | `np.linalg.cond` / exact `complexityIndex` | ≤ 1e-6 on this panel; ≤ 1e-3 on 300 random library panels (typical worst 1e-4) |
| trace((SᵀS)⁻¹) | `traceInv` | `np.trace(np.linalg.inv(...))` | ≤ 1e-9 relative |
| Cosine similarity matrix | `cosineMatrix` | normalized dot products | ≤ 1e-9 |
| OLS unmixing matrix W | `unmixingMatrix` | `np.linalg.pinv` | ≤ 1e-8 |
| Spreading matrix SS, noise ν | `spreadMatrix` | direct formula | ≤ 1e-8 |

Singular panels (duplicate fluors) return an infinite complexity index rather than a large number.

## 2. Simulated vs measured spectra

`npm run validate` (`tools/validate_against_library.mjs`) compares the simulated signature of every
dye that has both an FPbase spectrum and a Honeychrome measured reference. For each dye, detector
gains are fitted on all the *other* dyes (leave-one-out), which is how the app calibrates.

| Instrument | Dyes | Cosine, raw: mean (median) | Cosine, calibrated: mean (median) | ≥ 0.95 calibrated |
|---|---|---|---|---|
| Cytek Aurora 5L | 48 | 0.935 (0.945) | 0.961 (0.977) | 35/48 |
| Sony ID7000 (7-laser) | 41 | 0.830 (0.879) | 0.920 (0.960) | 23/41 |

Lowest calibrated agreement:

| Instrument | Dye | Cosine |
|---|---|---|
| ID7000 | BUV805 | 0.62 |
| ID7000 | Zombie NIR | 0.66 |
| ID7000 | BUV496 | 0.71 |
| ID7000 | BUV563 | 0.78 |
| ID7000 | PerCP | 0.82 |
| Aurora | PerCP-eFluor 710 | 0.83 |

Most of the worst cases are far-red/near-IR emitters or dyes with strong cross-laser excitation,
where the simulation's detector response and laser-power assumptions matter most. The ID7000's
channel boundaries are not published and were fitted (`tools/fit_id7000_grid.mjs`): cross-validated
agreement is 0.906 on the training half and 0.925 on the held-out half.

**In practice:** the app shows the measured library spectrum for every dye it contains, so these
errors only affect dyes outside the library. For those, treat similarity values within ~0.03 of a
limit as uncertain, and import a single-stain control.

## 3. Spread model against simulated and measured controls

- `plugin/tests/test_panel_check.py` simulates photon-noise single-stain controls (variance ∝ signal),
  unmixes them with OLS and checks that the measured spreading matrix equals √Q × the predicted one
  (within 12 %). It also checks that unmixing residuals are below 1 % and that the stain index and
  ΔF are recovered.
- In an end-to-end check, a real Honeychrome `Controller` was loaded with an experiment and synthetic
  FCS controls generated with photon-noise factor Q = 50 (true scale √50 = 7.071). Panel Check
  recovered a scale of 7.070, log-space r = 0.96 over 89 fluor pairs, and flagged the one control
  deliberately given a mismatched reference spectrum.

The model predicts spread from shot noise only. Real instruments add electronic noise and
spectrum-dependent detector effects, so measured/predicted ratios scatter around the fitted scale.
Panel Check reports the correlation so you can judge how well the model fits your instrument.

## 4. Application tests

- `tests/unit/*.test.cjs` (node:test): spectral library integrity and checksums, peak positions,
  instrument layouts, name resolution (vendor names, cFluor parentheticals, NovaFluor "-" vs "/"),
  CSV/FCS/kit/Panel Check parsers (FCS round-trip with a synthetic writer), optimizer invariants
  (never worse than the start, locks and reserved fluors respected, ties keep the current assignment,
  zero-weight autofluorescence markers), gain calibration recovery.
- `tests/e2e/app.spec.js` (Playwright, Chromium): the built file loads with no errors and no network
  requests; example panel; all three optimizers; Cytek CSV import; Honeychrome `.kit` import;
  save/open round-trip; instrument switch; no horizontal scrolling at phone width.

Run everything:

```sh
npm ci && npm run build && npm test && npx playwright test && npm run validate
python -m pytest plugin/tests
```
