// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
// Shared loader for Node scripts and tests: the engine, instrument/dye data and spectra.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
globalThis.self = globalThis;
const SPD = require(path.join(root, 'src', 'engine.js'));
require(path.join(root, 'src', 'data_lib.js'));
const DATA = globalThis.SPD_DATA;
const spectraText = fs.readFileSync(path.join(root, 'data', 'fpbase_spectra.txt'), 'utf8');
const HC = JSON.parse(fs.readFileSync(path.join(root, 'data', 'honeychrome_library.json'), 'utf8'));
const lib = SPD.buildLibrary(spectraText, DATA.DERIVED, DATA.META);
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const normKey = s => String(s || '').toLowerCase().replace(/[\s\-\/_.,()®™]+/g, '');
const keys = new Map();
for (const f of lib.values()) keys.set(normKey(f.name), f);
for (const f of lib.values()) for (const a of f.aliases || []) if (!keys.has(normKey(a))) keys.set(normKey(a), f);
const HC_EXTRA = { kiraviablue520: 'Kiravia Blue 520', v450: 'BD Horizon V450', v500: 'BD Horizon V500', mfluorvio610: 'mFluor Violet 610', rb670: 'RealBlue 670', bv786: 'BV785', gfp: 'EGFP' };
/** Library fluor for a Honeychrome library name (null if not in the FPbase-based library). */
function resolveHC(name) { const k = normKey(name); return keys.get(k) || (HC_EXTRA[k] && lib.get(HC_EXTRA[k])) || null; }
/** Measured library spectra for an instrument, mapped onto its detectors. */
function measuredLibrary(key, dets) {
  const L = HC[key];
  const di = dets.map(d => L.channels.findIndex(c => SPD.normDetName(c) === SPD.normDetName(d.name)));
  const out = [];
  for (const [name, code] of Object.entries(L.spectra)) {
    const v = Float64Array.from(di.map(i => (i < 0 ? 0 : (B64.indexOf(code[i]) / 63) ** 2)));
    out.push({ name, meas: SPD.normMax(v) });
  }
  return { matched: di.filter(i => i >= 0).length, spectra: out };
}
const cos = (a, b) => SPD.dot(a, b) / Math.sqrt(SPD.dot(a, a) * SPD.dot(b, b));
module.exports = { SPD, DATA, lib, HC, root, spectraText, resolveHC, measuredLibrary, cos, B64 };
