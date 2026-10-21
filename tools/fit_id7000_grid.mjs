#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/**
 * Fits the Sony ID7000 channel grid used by the presets in src/data_lib.js (SONY_GRID).
 *
 * Sony publishes channel counts per laser (35 for 320/355/405 nm, 32 for 488 starting at ch4,
 * 26 for 561 starting at ch10, 19 for 637 starting at ch17) but not channel boundaries. Every
 * laser uses the same 35-position grid. Boundaries are modelled as a piecewise-linear map from
 * channel index to wavelength (K knots) and fitted by coordinate search to maximize the
 * brightness-weighted cosine between simulated (FPbase) and measured (Honeychrome library)
 * per-laser signatures. Half the dyes are held out to check generalization.
 *
 *   node tools/fit_id7000_grid.mjs     # prints CV scores and the SONY_GRID array
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SPD, HC, resolveHC, B64 } = require('./lib_node.cjs');

const H = HC.ID7000;
const resp = [[350, 0.7], [400, 0.85], [500, 1.0], [600, 0.95], [700, 0.8], [800, 0.55], [850, 0.45]];
const firsts = { 320: 1, 355: 1, 405: 1, 488: 4, 561: 10, 637: 17 };
const dyes = [];
for (const [name, code] of Object.entries(H.spectra)) { const f = resolveHC(name); if (f && f.source === 'FPbase') dyes.push({ name, f, code }); }
const cosv = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; };
function edges(knots) {
  const K = knots.length, n = 35;
  const pos = i => { const t = i / n * (K - 1); const a = Math.min(K - 2, Math.floor(t)), fr = t - a; return knots[a] * (1 - fr) + knots[a + 1] * fr; };
  return [...Array(n)].map((_, i) => [pos(i), pos(i + 1)]);
}
function sig(f, wl, E) {
  const ex = SPD.at(f.ex, wl);
  return E.map(([lo, hi]) => { let s = 0; for (let w = lo; w < hi; w += 1) { const m = Math.min(w + 0.5, hi); s += SPD.at(f.em, m) * SPD.pwl(resp, m) * Math.min(1, hi - w); } return ex * s; });
}
function prep(ds) {
  const items = [];
  for (const wl of Object.keys(firsts).map(Number)) {
    const first = firsts[wl], cols = [];
    for (let c = first; c <= 35; c++) cols.push(H.channels.indexOf(`${wl}CH${c}`));
    for (const d of ds) { const m = cols.map(c => (B64.indexOf(d.code[c]) / 63) ** 2); const w = Math.max(...m); if (w >= 0.05) items.push({ d, wl, first, m, w }); }
  }
  return items;
}
function cost(knots, items) {
  for (let i = 1; i < knots.length; i++) if (knots[i] <= knots[i - 1] + 3) return -1;
  const E = edges(knots); let s = 0, w = 0;
  for (const it of items) { s += it.w * cosv(sig(it.d.f, it.wl, E.slice(it.first - 1)), it.m); w += it.w; }
  return s / w;
}
function fit(items, K) {
  let knots = [...Array(K)].map((_, i) => 420 + (860 - 420) * i / (K - 1)), best = cost(knots, items);
  for (const step of [40, 20, 10, 5, 2, 1]) {
    let imp = true, guard = 0;
    while (imp && guard++ < 40) {
      imp = false;
      for (let k = 0; k < K; k++) for (const s of [step, -step]) {
        const t = knots.slice(); t[k] += s; if (t[0] < 325) continue;
        const c = cost(t, items); if (c > best + 1e-7) { best = c; knots = t; imp = true; }
      }
    }
  }
  return { knots, best };
}
const rng = SPD.makeRng(3);
const shuffled = dyes.slice().sort(() => rng() - 0.5);
const A = shuffled.filter((_, i) => i % 2 === 0), B = shuffled.filter((_, i) => i % 2 === 1);
const half = fit(prep(A), 12);
console.log(`cross-validation (K=12): train ${half.best.toFixed(3)}, held-out ${cost(half.knots, prep(B)).toFixed(3)}`);
const all = fit(prep(dyes), 12);
console.log(`all ${dyes.length} dyes: ${all.best.toFixed(3)}`);
console.log('const SONY_GRID = ' + JSON.stringify(edges(all.knots).map(([a, b]) => [+a.toFixed(1), +b.toFixed(1)])) + ';');
