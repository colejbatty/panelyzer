const test = require('node:test');
const assert = require('node:assert/strict');
const { SPD, fixture } = require('./helpers.cjs');

const sig = JSON.parse(fixture('panel27_signatures.json'));
const ref = JSON.parse(fixture('panel27_numpy_reference.json'));
const cols = sig.cols.map(c => Float64Array.from(c));
const n = cols.length, D = cols[0].length;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

test('complexity index matches numpy cond()', () => {
  close(SPD.complexityIndex(cols), ref.ci, 1e-9, 'CI');
  close(SPD.fastCond(SPD.gram(cols), n), ref.ci, 1e-6, 'fastCond');
});

test('fastCond tracks the exact condition number on random library panels', () => {
  const { DATA, lib } = require('./helpers.cjs');
  const inst = DATA.INSTRUMENTS.find(i => i.id === 'aurora-5l'), dets = SPD.detectors(inst);
  const sigs = [...lib.values()].filter(f => f.kind === 'dye').map(f => SPD.simulateSignature(f, inst, dets)).filter(s => s.bestEx > 0.15).map(s => s.sig);
  const rng = SPD.makeRng(11);
  let worst = 0;
  for (let k = 0; k < 300; k++) {
    const m = 4 + Math.floor(rng() * 30), pick = new Set();
    while (pick.size < m) pick.add(Math.floor(rng() * sigs.length));
    const c = [...pick].map(i => sigs[i]), exact = SPD.complexityIndex(c);
    if (!Number.isFinite(exact) || exact > 1e4) continue;
    worst = Math.max(worst, Math.abs(SPD.fastCond(SPD.gram(c), m) - exact) / exact);
  }
  assert.ok(worst < 1e-3, `worst relative error ${worst}`);
});

test('trace((SᵀS)⁻¹) matches numpy', () => close(SPD.traceInv(SPD.gram(cols), n), ref.trace_inv, 1e-9, 'traceInv'));

test('cosine similarity matrix matches numpy', () => {
  const C = SPD.cosineMatrix(cols);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) close(C[i * n + j], ref.cos[i][j], 1e-9, `cos[${i},${j}]`);
});

test('OLS unmixing matrix equals the pseudo-inverse', () => {
  const W = SPD.unmixingMatrix(cols);
  for (let i = 0; i < n; i++) for (let d = 0; d < D; d++) close(W[i][d], ref.W[i][d], 1e-8, `W[${i},${d}]`);
});

test('spillover spreading matrix and noise amplification match numpy', () => {
  const { SS, nu } = SPD.spreadMatrix(cols, SPD.unmixingMatrix(cols), 1);
  for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) close(SS[j * n + k], ref.SS[j][k], 1e-8, `SS[${j},${k}]`);
  for (let k = 0; k < n; k++) close(nu[k], ref.nu[k], 1e-8, `nu[${k}]`);
});

test('analyzePanel flags singular and over-determined panels', () => {
  const a = Float64Array.from({ length: 10 }, (_, i) => i === 2 ? 1 : 0.1);
  assert.equal(SPD.analyzePanel([a, Float64Array.from(a)]).ci, Infinity);
  const many = Array.from({ length: 5 }, (_, i) => Float64Array.from({ length: 3 }, (_, d) => (d === i % 3 ? 1 : 0.2 * i)));
  assert.equal(SPD.analyzePanel(many).ci, Infinity);
});

test('symmetric eigenvalues of a known matrix', () => {
  const ev = SPD.symEigenvalues(Float64Array.from([2, 1, 0, 1, 2, 0, 0, 0, 5]), 3);
  [1, 3, 5].forEach((v, i) => close(ev[i], v, 1e-10, 'eig'));
});
