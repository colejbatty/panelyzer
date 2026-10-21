# Methods

How every number in Spectral Panel Designer is computed. The same text, slightly shorter, is in the
app under **Methods & help**. Code references point to `src/engine.js` unless noted.

## Spectra

- **FPbase** (`data/fpbase_spectra.txt`, 271 spectra): excitation (or absorption, when FPbase has no
  excitation spectrum) and emission, linearly resampled to a 4 nm grid from 300 to 940 nm, normalized
  to their maximum, and stored square-root encoded at 64 levels with a per-line checksum. Regenerate
  with `node tools/fetch_fpbase.mjs`; the name → FPbase mapping is `tools/fpbase_sources.json`.
- **Approximations** (`DERIVED` in `src/data_lib.js`): for dyes FPbase lacks, the excitation of a
  related dye (donor or polymer backbone) is combined with the emission shape of a similar acceptor,
  shifted to the published emission maximum. PE and APC tandems keep a small donor residual. These
  are marked *approx.* in the app.
- **Measured libraries** (`data/honeychrome_library.json`): Honeychrome's reference spectra for the
  Aurora (93 fluors × 64 channels) and ID7000 (65 fluors × 182 channels), clipped at 0, normalized
  and square-root encoded. Regenerate with `python tools/extract_honeychrome_library.py`.

Priority when a signature is needed: your imported reference → measured library (if "Prefer measured"
is on) → simulation.

## Simulated signatures

For a fluor with excitation spectrum *ex(λ)* and emission spectrum *em(λ)*, detector *d* on laser
*L* with band [lo, hi] receives

```
s_d = P_L · k_L · g_d · ex(λ_L) · ∫_lo^hi em(λ) · R(λ) dλ
```

with laser power *P_L*, laser scale *k_L*, calibrated detector gain *g_d* (default 1) and an
approximate detector response *R(λ)*. The signature is normalized to a peak of 1 (`simulateSignature`).

### Detector-gain calibration

Given fluors with both a simulated signature *s_f* and a measured one *m_f*, the model
`log m_fd = log a_f + log g_d + log s_fd` is fitted by weighted alternating least squares in log
space (weights favour bright channels; `calibrateGains`). For the Aurora and ID7000 presets the
gains are fitted to the measured library by default; importing your own references refits them.

### Instrument presets

- **Cytek Aurora 5L**: 64 detectors from the published filter layout (UV 355 nm/20 mW, V 405/100,
  B 488/50, YG 561/50, R 640/80).
- **Sony ID7000**: published per-laser channel counts (320/355/405: 35; 488: 32; 561: 26; 637: 19;
  808: 2) on one shared 35-position grid (488 starts at channel 4, 561 at 10, 637 at 17). Sony
  does not publish channel boundaries, so the grid was fitted to the measured library by maximizing
  brightness-weighted cosine agreement (`tools/fit_id7000_grid.mjs`; half the dyes held out:
  0.906 train, 0.925 held-out).

## Similarity and complexity

```
similarity(i, j)  = s_i · s_j / (‖s_i‖ ‖s_j‖)
complexity index  = σ_max(S) / σ_min(S)
```

*S* is the detectors × fluors matrix of peak-normalized signatures. The complexity index is the
2-norm condition number, computed from the eigenvalues of SᵀS by Jacobi iteration
(`complexityIndex`). The optimizers use `fastCond`, which estimates it by power and inverse
iteration with Rayleigh quotients (error < 0.01 % in tests). The default similarity limits are 0.98
(problem) and 0.90 (caution).

## Unmixing and spread

```
W = (SᵀS)⁻¹ Sᵀ                      ordinary least squares
SS(j → k) = √( Σ_d W_kd² · s_jd )   spillover spreading, per √intensity
ν_k = √( Σ_d W_kd² )                noise amplification
```

A cell with abundance *a* of fluor *j* produces detector signals *a·s_j*. Their variance scales with
the signal (photon shot noise), so after unmixing fluor *k* gains variance *a·Σ_d W_kd² s_jd*. SS is
therefore the quantity a measured spillover-spreading matrix reports, up to an instrument constant.
Values are relative unless a Panel Check calibration has been imported (see HONEYCHROME.md).

Autofluorescence profiles are unmixed as extra components. They enter *W*, which changes ν and SS,
and they add a spread source present on every cell. The headline complexity index excludes them, as
instrument software reports it; the value with AF is shown alongside.

## Marker assignment

```
signal_n = E_n · B_f(n)
var_n    = (b · ν_f(n))² + Σ_m c(m,n) · SS(f(m) → f(n))² · signal_m
R_n      = signal_n / √var_n
cost     = Σ_n w_n / R_n
```

*E* is expression (1–4), *B* brightness (1–5), *b* the background-noise setting, *w* the priority
weight (critical 2, normal 1, low 0.5, autofluorescence 0) and *c(m,n)* = 1 when two markers share
a population tag, otherwise the non-co-expressed weight (default 0.15). The search
(`optimizeAssignment`) is simulated annealing over swaps and moves with restarts. It starts from the
current assignment, keeps it on ties, and honours locked markers and reserved fluors (viability and
other non-antibody dyes are never moved onto antibody markers).

## Best fluors to add

For each candidate fluor not in the panel, the panel is re-unmixed with the candidate (and any
enabled AF) while existing assignments stay fixed. The new marker is scored on the candidate with
the assignment model. The overall rank is *w_new / R_new + Δ(cost of existing markers)*. The table
also shows complexity after adding and the closest panel fluor. Candidates above the similarity limit
are hidden by default.

## Fluor-set suggestion

Greedy forward selection (add the candidate with the lowest objective that keeps all pairwise
similarities under the limit), then swap refinement until no single swap helps (`optimizeFluorSet`).
The objective is either the complexity index or trace((SᵀS)⁻¹), the total noise amplification. "Prefer
bright fluors" multiplies it by 1 + weight · mean(1/B). Thorough mode adds randomized restarts.

## Signatures from FCS

A broad FSC/SSC gate removes debris and extremes. The peak channel is the one with the largest
99.5th percentile − median. Positives are the top 2 % (adjustable) of that channel, excluding
saturation. Negatives come from an unstained file if given, else the dimmest 30 % of the same file.
The signature is median(positive) − median(negative) per channel (`signatureFromFCS`).
Autofluorescence from an unstained file is the median of scatter-gated events
(`autofluorescenceFromFCS`).

## File formats

- **Panel** (`.spd.json`): `{ app: "spectral-panel-designer", fileVersion, panelName, instrumentId,
  rows, references, autofluorescence, customFluors, customInstruments, settings, … }`. See
  `examples/example_24color_pbmc.spd.json`.
- **Reference CSV/TSV**: fluors in rows or detectors in rows. Detector names match case-insensitively
  with -A/-H suffixes ignored.
- **Panel CSV**: Cytek-style exports and free tables with marker and fluor columns. Fluor names
  resolve through aliases (vendor prefixes, "Brilliant Violet 605" → BV605, cFluor parentheticals,
  "-" vs "/" in NovaFluor names) and fuzzy suggestions.
- **Custom dye spectrum**: wavelength, excitation, emission columns.
- **Instrument JSON**: lasers with `wl`, `power`, `scale` and `detectors` (`name` plus
  `center`/`bw` or `lo`/`hi`).
- **Honeychrome `.kit`** and **Panel Check `.json`**: see HONEYCHROME.md.
