# Working with Honeychrome

[Honeychrome](https://github.com/Cytkit/honeychrome) (Cytkit, LGPL-3.0) is an open-source
application for spectral flow cytometry: it builds a spectral model from single-stain controls,
unmixes, and analyses samples. Spectral Panel Designer plans the panel; Honeychrome runs it. The
two tools exchange data in three ways.

```
Spectral Panel Designer                        Honeychrome
  measured library  ◄────────── bundled reference libraries (Aurora, ID7000)
  Import Honeychrome… ◄──────── experiment .kit (references, AF, labels)
  spread calibration ◄────────  Panel Check plugin export (.json)
  control checklist ───────────► file names Honeychrome's label detection reads
```

## 1. Measured reference library (built in)

The designer bundles Honeychrome's measured reference spectra for the Cytek Aurora (93 fluors) and
Sony ID7000 (65 fluors). For these instruments, a library spectrum is used ahead of simulation, and
the simulation of every other dye is calibrated against the library (per-detector gains). The
Library tab marks these fluors *measured · lib*.

## 2. Import an experiment (`.kit`)

**Library → Import Honeychrome…** reads an experiment file:

| Kit field | Used for |
|---|---|
| `process.profiles` | Reference spectra, in `settings.raw.fluorescence_channel_ids` order |
| `process.spectral_model` | Label ↔ antigen pairs, control type |
| `process.af_profiles` | AutoSpectral autofluorescence profiles (`spectra`, `channel_names`) |
| `settings.raw.cytometer`, `event_channels_pnn` | Matching channels to the instrument's detectors |

Each imported spectrum is compared with the library (or simulated) spectrum for its fluor.
Agreement below 0.80 usually means the control is contaminated, mis-gated or mislabelled. The
dialog lists every spectrum with its agreement before anything is imported.

## 3. Panel Check plugin

`plugin/panel_check_tab.py` adds a **Panel Check** tab to Honeychrome. For the open experiment it
shows:

- **Panel metrics on your real references**: complexity index (with and without AF), the similarity
  matrix, noise amplification and a predicted spreading matrix computed from the experiment's own
  unmixing matrix (including spillover compensation, when present).
- **Control QC**: agreement of every reference with the bundled library, profile warnings, and
  similarity to autofluorescence.
- **Measured spread** (button): each single-stain control is unmixed and compared with its negative
  (the unstained control, or the internal negative):
  - spread SS[j,k] = √max(0, rSD²pos,k − rSD²neg,k) / √ΔFj, with rSD = 84.13th percentile − median;
  - stain index = ΔF / (2·rSDneg);
  - unmixing residual = signal left in other channels / ΔF. A large residual means the reference
    doesn't match the control.
  - The scale *c* that maps the designer's relative units onto your instrument's (median log ratio),
    and how well predicted and measured spread correlate.
- **Export for Spectral Panel Designer**: writes `Panel Check/<experiment> panel check.json` inside
  the experiment folder. Importing it in the designer (same **Import Honeychrome…** button) loads the
  references, AF profiles, stain indices and the spread scale, which then multiplies the designer's
  spreading matrix for that instrument.

Nothing is sent anywhere. The plugin's numerical core needs only NumPy and is tested in
`plugin/tests` (see [VALIDATION.md](VALIDATION.md)).

### Install

Honeychrome loads plugins named `*_tab.py`.

- **Honeychrome run from Python** (`pip install honeychrome`, then `python -m honeychrome`):
  copy `panel_check_tab.py` to `<home>/Experiments/plugins/`, enable it under
  **Edit → App Configuration**, and restart Honeychrome. The packaged desktop builds do not load
  user plugins.
- **Bundled with Honeychrome**: the plugin has been proposed for inclusion in Honeychrome's
  `bundled_plugins`. Once it is included, enable "panel_check_tab" in App Configuration.

Compatibility: written and tested against Honeychrome `main` as of October 2026 (PySide6,
`PluginWidget(bus, controller)` interface).

## 4. Control checklist

**Export → Single-stain control checklist (CSV)** lists the controls a panel needs. Its file names
follow Honeychrome's label detection ("Marker Fluor (Cells).fcs"), so the controls import with the
right labels.

## Notes on similarity values

Honeychrome normalizes the profile matrix per detector before computing its similarity matrix, so
its similarity values are not the plain cosine of peak-normalized spectra. The designer and Panel
Check both report the plain cosine, which is what instrument software and most of the literature
use. Expect small differences between the two applications.
