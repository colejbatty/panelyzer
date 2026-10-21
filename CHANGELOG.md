# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.9.0] - 2026-10-20

First public release (beta). The project was developed as "Spectral Panel Designer" and renamed
Panelyzer before release; panel files saved under the old name still open.

### Added
- Single-file offline app: panel editor, analysis (signatures, similarity, complexity index, noise
  amplification, estimated spillover spreading), optimizers (suggest fluors, optimize assignment,
  best fluors to add), library and instrument editors, save/open (`.panelyzer.json`), CSV exports and a
  printable report.
- Instrument presets: Cytek Aurora 5L; Sony ID7000 5- and 7-laser, with a channel grid fitted to
  measured spectra. Custom instruments via JSON.
- 271 FPbase spectra, approximations for dyes FPbase lacks, and Honeychrome's measured reference
  libraries (Aurora, ID7000), with detector-gain calibration of simulated dyes.
- Imports: Cytek-style panel CSVs (vendor and alias name resolution), pasted lists, reference CSVs,
  single-stain and unstained FCS, custom dye spectra, Honeychrome `.kit` experiments, Panel Check exports.
- Autofluorescence profiles as unmixing components.
- Zenodo metadata (`.zenodo.json`) and an AI-use statement (README, Methods & help).
- Honeychrome **Panel Check** plugin (`plugin/panel_check_tab.py`, v1.0.0): model metrics, control
  QC against the library, measured spread, stain index and residuals, spread calibration export.
- Unit tests (math checked against NumPy), Playwright end-to-end tests, plugin tests, simulated vs
  measured validation script; CI, GitHub Pages and release workflows.

[0.9.0]: https://github.com/colejbatty/panelyzer/releases/tag/v0.9.0
