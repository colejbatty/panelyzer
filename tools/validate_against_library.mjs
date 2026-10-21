#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/**
 * How well do simulated signatures match measured ones?
 *
 * For each instrument with a Honeychrome measured library, every library dye that also has an
 * FPbase spectrum is simulated and compared (cosine similarity) with its measured spectrum,
 * (a) raw and (b) after leave-one-out detector-gain calibration fitted on all the other dyes —
 * the same calibration the app applies by default. Prints a Markdown table (used in docs/VALIDATION.md).
 *
 *   node tools/validate_against_library.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SPD, DATA, resolveHC, measuredLibrary, cos } = require('./lib_node.cjs');

const cases = [['Aurora', 'aurora-5l'], ['ID7000', 'id7000-7l']];
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log('| Instrument | Dyes compared | Simulated, raw: mean (median) | Simulated + calibration (leave-one-out): mean (median) | ≥ 0.95 after calibration |');
console.log('|---|---|---|---|---|');
const worstAll = [];
for (const [key, id] of cases) {
  const inst = JSON.parse(JSON.stringify(DATA.INSTRUMENTS.find(i => i.id === id)));
  const dets = SPD.detectors(inst);
  const { spectra } = measuredLibrary(key, dets);
  const pairs = [];
  for (const { name, meas } of spectra) {
    const f = resolveHC(name);
    if (!f || f.source !== 'FPbase' || f.kind !== 'dye') continue;
    pairs.push({ name, f, meas, base: SPD.simulateRaw(f, inst, dets) });
  }
  const before = [], after = [];
  pairs.forEach((p, k) => {
    const g = SPD.calibrateGains(pairs.filter((_, i) => i !== k), dets).gains;
    before.push(cos(p.base, p.meas));
    after.push(cos(p.base.map((v, i) => v * g[i]), p.meas));
  });
  const good = after.filter(x => x >= 0.95).length;
  console.log(`| ${key} (${inst.name}) | ${pairs.length} | ${mean(before).toFixed(3)} (${q(before, 0.5).toFixed(3)}) | ${mean(after).toFixed(3)} (${q(after, 0.5).toFixed(3)}) | ${good}/${pairs.length} |`);
  pairs.forEach((p, i) => worstAll.push([key, p.name, after[i]]));
}
console.log('\nLowest agreement after calibration:');
worstAll.sort((a, b) => a[2] - b[2]).slice(0, 10).forEach(([k, n, v]) => console.log(`- ${k} ${n}: ${v.toFixed(2)}`));
