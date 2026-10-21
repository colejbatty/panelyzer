#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/**
 * Regenerates data/fpbase_spectra.txt from the FPbase GraphQL API.
 *
 *   node tools/fetch_fpbase.mjs            # rewrite data/fpbase_spectra.txt
 *   node tools/fetch_fpbase.mjs --check    # report differences only
 *
 * The fluor list (display name -> FPbase owner name) lives in tools/fpbase_sources.json.
 * Each spectrum is linearly resampled to a 4 nm grid (300–940 nm), normalized to its maximum,
 * square-root encoded to 64 levels (one base64url character per point, leading/trailing zeros
 * trimmed). Line format:
 *
 *   name|D or P|EX or AB|exStart|exCodes|emStart|emCodes|checksum
 *
 * Excitation spectra are preferred; absorption is used when FPbase has no excitation spectrum.
 * FPbase data: CC BY-SA 4.0 — see DATA_LICENSES.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'fpbase_spectra.txt');
const sources = JSON.parse(readFileSync(join(root, 'tools', 'fpbase_sources.json'), 'utf8')).fluors;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const API = 'https://www.fpbase.org/graphql/';

async function gql(query) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!r.ok) throw new Error(`FPbase HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}

function encode(points) {
  const d = points.slice().sort((a, b) => a[0] - b[0]);
  const out = []; let mx = 0;
  for (let w = 300; w <= 940; w += 4) {
    let v = 0;
    if (w >= d[0][0] && w <= d[d.length - 1][0]) {
      let lo = 0, hi = d.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m][0] <= w) lo = m; else hi = m; }
      const [x0, y0] = d[lo], [x1, y1] = d[hi];
      v = x1 === x0 ? y0 : y0 + (y1 - y0) * (w - x0) / (x1 - x0);
    }
    v = Math.max(0, v); out.push(v); mx = Math.max(mx, v);
  }
  const q = out.map(v => Math.round(63 * Math.sqrt(v / mx)));
  let s = 0; while (s < q.length && q[s] === 0) s++;
  let e = q.length - 1; while (e > s && q[e] === 0) e--;
  return [s, q.slice(s, e + 1).map(x => B64[x]).join('')];
}

const all = (await gql('{ spectra { id category subtype owner { name } } }')).spectra;
const byOwner = new Map();
for (const s of all) { if (!byOwner.has(s.owner.name)) byOwner.set(s.owner.name, []); byOwner.get(s.owner.name).push(s); }

const plan = [];
for (const { name, fpbase_owner } of sources) {
  const L = byOwner.get(fpbase_owner);
  if (!L) throw new Error(`FPbase has no spectra for "${fpbase_owner}" (${name})`);
  const ex = L.find(s => s.subtype === 'EX') || L.find(s => s.subtype === 'AB');
  const em = L.find(s => s.subtype === 'EM');
  if (!ex || !em) throw new Error(`Missing excitation or emission for ${name}`);
  plan.push({ name, cat: L[0].category, exType: ex.subtype, exId: ex.id, emId: em.id });
}

const data = {};
const ids = [...new Set(plan.flatMap(p => [p.exId, p.emId]))];
for (let i = 0; i < ids.length; i += 40) {
  const chunk = ids.slice(i, i + 40);
  const res = await gql('{' + chunk.map(id => `s${id}: spectrum(id: ${id}) { id data }`).join(' ') + '}');
  for (const k in res) data[res[k].id] = res[k].data;
}

const lines = plan.map(p => {
  const [es, ec] = encode(data[p.exId]), [ms, mc] = encode(data[p.emId]);
  let chk = 0; for (const c of ec + mc) chk = (chk * 31 + B64.indexOf(c)) % 9973;
  return [p.name, p.cat, p.exType, es, ec, ms, mc, chk].join('|');
});

if (process.argv.includes('--check')) {
  const old = new Map(readFileSync(OUT, 'utf8').trim().split('\n').map(l => [l.split('|')[0], l]));
  let changed = 0;
  for (const l of lines) if (old.get(l.split('|')[0]) !== l) { changed++; console.log('changed:', l.split('|')[0]); }
  console.log(`${lines.length} spectra, ${changed} differ from data/fpbase_spectra.txt`);
} else {
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`wrote ${lines.length} spectra to data/fpbase_spectra.txt`);
}
