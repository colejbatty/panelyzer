# Contributing

Thanks for helping improve Spectral Panel Designer. Bug reports, dye and instrument requests,
measured reference spectra and code are all welcome.

## Reporting problems

- **Bugs:** open an issue with the browser and version, what you did, and what you expected. Attach
  the `.spd.json` panel if you can (Save writes one). Leave out anything you can't share.
- **A dye is missing or looks wrong:** use the *Dye or spectrum request* template. Link the FPbase
  page or the manufacturer's spectrum. A measured reference from your instrument (exported signature
  CSV) is the most useful thing you can send.
- **Questions about a prediction:** include the instrument and the fluors involved. Remember that
  spread values are relative unless calibrated (docs/METHODS.md).

## Development setup

Requirements: Node.js ≥ 20; Python ≥ 3.10 with NumPy for the plugin tests.

```sh
npm ci
npx playwright install chromium   # once, for end-to-end tests
npm run build                     # dist/SpectralPanelDesigner.html
npm test                          # unit tests
npm run test:e2e                  # end-to-end tests
pip install -r plugin/requirements-test.txt && npm run test:plugin
```

Open `dist/SpectralPanelDesigner.html` directly in a browser; there is no dev server. Rebuild after
each change.

## Code guidelines

- No runtime dependencies and no network access. The built file must work offline from `file://`,
  and the Content-Security-Policy in `src/index.html` must stay strict.
- Keep computation in `src/engine.js` (no DOM) so it can be unit-tested in Node. UI code goes in
  `src/app_views.js`; state and name resolution go in `src/app_core.js`.
- Add or update tests for behaviour changes: unit tests in `tests/unit`, UI flows in `tests/e2e`.
  Numerical changes should come with a reference check (NumPy fixtures in `tests/fixtures`).
- If you change the spectra, the instrument presets or the simulation, rerun `npm run validate` and
  update the tables in `README.md` and `docs/VALIDATION.md`.
- Keep `version` in `package.json` and `APP_VERSION` in `src/app_core.js` in sync (the build checks).
- Never commit real experiment data. The fixtures in `tests/fixtures` are synthetic; generate new
  ones with the scripts there.

## Adding things

- **An FPbase dye:** add `{ "name", "fpbase_owner" }` to `tools/fpbase_sources.json`, run
  `node tools/fetch_fpbase.mjs`, and add metadata (group, brightness, aliases) to `META` in
  `src/data_lib.js`. The library tests check that every spectrum has metadata.
- **A dye FPbase lacks:** add an entry to `DERIVED` in `src/data_lib.js` (base excitation, emission
  shape, published emission peak) and mark the source in the PR.
- **An instrument preset:** add it to `INSTRUMENTS` in `src/data_lib.js`, with detector bands from a
  published specification (cite it in the PR), and extend `tests/unit/instruments.test.cjs`.
- **Honeychrome plugin:** keep the numerical core free of Qt so `plugin/tests` runs with NumPy only.

## Pull requests

Keep PRs focused, describe how you tested them, and make sure CI passes. By contributing you agree
that your contribution is licensed under LGPL-3.0-or-later (data under the license of its source;
see `DATA_LICENSES.md`).
