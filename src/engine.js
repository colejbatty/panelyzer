// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/* Panelyzer — computation engine (no DOM).
 * Works in the browser (window.SPD) and in Node (module.exports) for testing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- grid */
  const GRID_START = 300, GRID_STEP = 4, GRID_N = 161; // 300..940 nm
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const gridWl = i => GRID_START + i * GRID_STEP;

  function decodeSpectrum(start, codes) {
    const out = new Float64Array(GRID_N);
    for (let i = 0; i < codes.length; i++) {
      const q = B64.indexOf(codes[i]);
      if (q < 0) throw new Error('Bad spectrum code: ' + codes[i]);
      const k = start + i;
      if (k < GRID_N) out[k] = (q / 63) * (q / 63);
    }
    return normMax(out);
  }

  function normMax(a) {
    let m = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    const out = new Float64Array(a.length);
    if (m > 0) for (let i = 0; i < a.length; i++) out[i] = a[i] / m;
    return out;
  }

  /** Linear interpolation of a grid spectrum at an arbitrary wavelength. */
  function at(spec, wl) {
    const x = (wl - GRID_START) / GRID_STEP;
    if (x <= 0) return x < -0.5 ? 0 : spec[0];
    if (x >= GRID_N - 1) return x > GRID_N - 0.5 ? 0 : spec[GRID_N - 1];
    const i = Math.floor(x), f = x - i;
    return spec[i] * (1 - f) + spec[i + 1] * f;
  }

  function peakWl(spec) {
    let m = -1, k = 0;
    for (let i = 0; i < spec.length; i++) if (spec[i] > m) { m = spec[i]; k = i; }
    return gridWl(k);
  }

  /** Shift a grid spectrum by delta nm (positive = red-shift). */
  function shift(spec, delta) {
    const out = new Float64Array(GRID_N);
    for (let i = 0; i < GRID_N; i++) out[i] = Math.max(0, at(spec, gridWl(i) - delta));
    return normMax(out);
  }

  /** Resample arbitrary [[wl, value], ...] points onto the grid (normalized). */
  function resamplePoints(points) {
    const p = points.filter(r => isFinite(r[0]) && isFinite(r[1])).sort((a, b) => a[0] - b[0]);
    if (p.length < 2) throw new Error('Need at least two spectrum points');
    const out = new Float64Array(GRID_N);
    for (let i = 0; i < GRID_N; i++) {
      const w = gridWl(i);
      if (w < p[0][0] || w > p[p.length - 1][0]) continue;
      let lo = 0, hi = p.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] <= w) lo = m; else hi = m; }
      const [x0, y0] = p[lo], [x1, y1] = p[hi];
      out[i] = Math.max(0, x1 === x0 ? y0 : y0 + (y1 - y0) * (w - x0) / (x1 - x0));
    }
    return normMax(out);
  }

  /* ------------------------------------------------------- library build */
  /**
   * Build the fluor library from compact FPbase lines + derived definitions + metadata.
   * Each entry: {id, name, kind, source, ex, em, exPeak, emPeak, brightness, group, note}
   */
  function buildLibrary(fpLines, derived, meta) {
    const lib = new Map();
    for (const line of fpLines.split('\n')) {
      if (!line.trim()) continue;
      const [name, cat, exType, es, ec, ms, mc] = line.split('|');
      const ex = decodeSpectrum(+es, ec), em = decodeSpectrum(+ms, mc);
      lib.set(name, { id: name, name, kind: cat === 'P' ? 'protein' : 'dye', source: 'FPbase',
        sourceNote: 'FPbase ' + (exType === 'AB' ? 'absorption' : 'excitation') + ' + emission spectra', ex, em });
    }
    for (const d of derived) {
      const exBase = lib.get(d.ex.from), emBase = lib.get(d.em.from);
      if (!exBase || !emBase) throw new Error('Derived dye ' + d.name + ' references missing template');
      let ex = exBase.ex;
      if (d.ex.peak != null) ex = shift(ex, d.ex.peak - peakWl(ex));
      else if (d.ex.shift) ex = shift(ex, d.ex.shift);
      if (d.ex.add) {
        const sum = new Float64Array(GRID_N);
        for (let i = 0; i < GRID_N; i++) sum[i] = ex[i];
        for (const a of d.ex.add) {
          const t = lib.get(a.from).ex;
          for (let i = 0; i < GRID_N; i++) sum[i] += a.weight * t[i];
        }
        ex = normMax(sum);
      }
      let em = emBase.em;
      const trimAt = d.em.trimRel != null ? peakWl(em) - d.em.trimRel : d.em.trim;
      if (trimAt != null && trimAt > GRID_START) { // drop donor residual of the template below trimAt nm
        const t = new Float64Array(GRID_N);
        for (let i = 0; i < GRID_N; i++) t[i] = gridWl(i) >= trimAt ? em[i] : 0;
        em = normMax(t);
      }
      if (d.em.peak != null) em = shift(em, d.em.peak - peakWl(em));
      if (d.em.add) { // add donor emission residual (unshifted)
        const sum = Float64Array.from(em);
        for (const a of d.em.add) { const t = lib.get(a.from).em; for (let i = 0; i < GRID_N; i++) sum[i] += a.weight * t[i]; }
        em = normMax(sum);
      }
      lib.set(d.name, { id: d.name, name: d.name, kind: 'dye', source: 'Derived',
        sourceNote: `Approximation: excitation from ${d.ex.from}, emission shape from ${d.em.from} shifted to ~${d.em.peak} nm`, ex, em });
    }
    for (const f of lib.values()) {
      const m = meta[f.name] || {};
      f.brightness = m.b != null ? m.b : 3;
      f.group = m.g || (f.kind === 'protein' ? 'Fluorescent protein' : 'Other');
      f.aliases = m.aka || [];
      f.exPeak = peakWl(f.ex); f.emPeak = peakWl(f.em);
    }
    return lib;
  }

  /* -------------------------------------------------- instrument model */
  /** Piecewise-linear interpolation over [[x,y],...]. */
  function pwl(pts, x) {
    if (!pts || !pts.length) return 1;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  }

  /** Flatten instrument config into an ordered detector list. */
  function detectors(inst) {
    const out = [];
    for (const L of inst.lasers) {
      for (const d of L.detectors) {
        out.push({ name: d.name, laser: L.wl, laserName: L.name, center: d.center, bw: d.bw,
          lo: d.lo != null ? d.lo : d.center - d.bw / 2, hi: d.hi != null ? d.hi : d.center + d.bw / 2,
          response: d.response || L.response || inst.response || null, gain: d.gain != null ? d.gain : 1 });
      }
    }
    return out;
  }

  /**
   * Simulate a fluor's raw (un-normalized) signal on every detector.
   * signal_d = power_L * scale_L * ex(λ_L) * ∫_band em(λ) R(λ) dλ
   */
  function simulateRaw(fluor, inst, dets) {
    dets = dets || detectors(inst);
    const lasers = new Map(inst.lasers.map(L => [L.wl, L]));
    const raw = new Float64Array(dets.length);
    for (let k = 0; k < dets.length; k++) {
      const d = dets[k], L = lasers.get(d.laser);
      const exEff = at(fluor.ex, d.laser);
      if (exEff <= 0) continue;
      let s = 0;
      for (let w = d.lo; w < d.hi; w += 1) {
        const mid = Math.min(w + 0.5, d.hi);
        const step = Math.min(1, d.hi - w);
        s += at(fluor.em, mid) * (d.response ? pwl(d.response, mid) : 1) * step;
      }
      raw[k] = (L.power || 1) * (L.scale != null ? L.scale : 1) * (d.gain != null ? d.gain : 1) * exEff * s;
    }
    return raw;
  }

  /** Normalized (peak = 1) signature + diagnostics. */
  function simulateSignature(fluor, inst, dets) {
    dets = dets || detectors(inst);
    const raw = simulateRaw(fluor, inst, dets);
    let m = 0, k = 0;
    for (let i = 0; i < raw.length; i++) if (raw[i] > m) { m = raw[i]; k = i; }
    const sig = new Float64Array(raw.length);
    if (m > 0) for (let i = 0; i < raw.length; i++) sig[i] = raw[i] / m;
    // Best laser excitation efficiency, for "poorly excited" warnings.
    let bestEx = 0;
    for (const L of inst.lasers) bestEx = Math.max(bestEx, at(fluor.ex, L.wl));
    return { sig, peakIdx: k, peakDet: dets[k] ? dets[k].name : null, rawPeak: m, bestEx };
  }

  /**
   * Fit per-detector gain corrections so simulated signatures match measured references.
   * pairs: [{base: Float64Array (simulated raw, current gains), meas: Float64Array (peak-normalized)}]
   * Model (log space): log m_fd = log a_f + log g_d + log b_fd, solved by weighted alternating means.
   * Returns {gains: Float64Array (multiplicative correction), fitted: count, rmsBefore, rmsAfter}.
   */
  function calibrateGains(pairs, dets) {
    const D = dets.length, F = pairs.length;
    const obs = [];
    pairs.forEach((p, f) => {
      const bm = Math.max(...p.base);
      for (let d = 0; d < D; d++) {
        const b = p.base[d] / (bm || 1), m = p.meas[d];
        if (b > 0.02 && m > 0.02) obs.push({ f, d, y: Math.log(m) - Math.log(b), w: Math.sqrt(m * b) });
      }
    });
    const la = new Float64Array(F), lg = new Float64Array(D), has = new Uint8Array(D);
    for (let it = 0; it < 60; it++) {
      const sa = new Float64Array(F), wa = new Float64Array(F);
      for (const o of obs) { sa[o.f] += o.w * (o.y - lg[o.d]); wa[o.f] += o.w; }
      for (let f = 0; f < F; f++) la[f] = wa[f] ? sa[f] / wa[f] : 0;
      const sg = new Float64Array(D), wg = new Float64Array(D);
      for (const o of obs) { sg[o.d] += o.w * (o.y - la[o.f]); wg[o.d] += o.w; }
      for (let d = 0; d < D; d++) { if (wg[d]) { lg[d] = sg[d] / wg[d]; has[d] = 1; } }
      // anchor: weighted mean log-gain = 0
      let m = 0, c = 0; for (let d = 0; d < D; d++) if (has[d]) { m += lg[d]; c++; }
      m = c ? m / c : 0; for (let d = 0; d < D; d++) if (has[d]) lg[d] -= m;
    }
    // fill unfitted detectors by nearest fitted neighbour on the same laser
    const gains = new Float64Array(D).fill(1);
    for (let d = 0; d < D; d++) {
      if (has[d]) { gains[d] = Math.exp(lg[d]); continue; }
      let best = -1, dist = Infinity;
      for (let e = 0; e < D; e++) if (has[e] && dets[e].laser === dets[d].laser && Math.abs(dets[e].center - dets[d].center) < dist) { dist = Math.abs(dets[e].center - dets[d].center); best = e; }
      gains[d] = best >= 0 ? Math.exp(lg[best]) : 1;
    }
    const rms = (useG) => {
      let s = 0, n = 0;
      pairs.forEach(p => {
        const adj = p.base.map((b, d) => b * (useG ? gains[d] : 1)); const mx = Math.max(...adj) || 1;
        for (let d = 0; d < D; d++) { const e = adj[d] / mx - p.meas[d]; s += e * e; n++; }
      });
      return Math.sqrt(s / Math.max(1, n));
    };
    return { gains, fitted: has.reduce((a, b) => a + b, 0), observations: obs.length, rmsBefore: rms(false), rmsAfter: rms(true) };
  }

  /* --------------------------------------------------------- linear algebra */
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  /** Gram matrix G = SᵀS from an array of column vectors. Returns Float64Array n*n. */
  function gram(cols) {
    const n = cols.length, G = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { const v = dot(cols[i], cols[j]); G[i * n + j] = v; G[j * n + i] = v; }
    return G;
  }

  /** In-place Cholesky (lower). Returns L as Float64Array or null if not PD. */
  function cholesky(G, n) {
    const L = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      let s = G[j * n + j];
      for (let k = 0; k < j; k++) s -= L[j * n + k] * L[j * n + k];
      if (!(s > 1e-14)) return null;
      const d = Math.sqrt(s);
      L[j * n + j] = d;
      for (let i = j + 1; i < n; i++) {
        let t = G[i * n + j];
        for (let k = 0; k < j; k++) t -= L[i * n + k] * L[j * n + k];
        L[i * n + j] = t / d;
      }
    }
    return L;
  }

  /** Solve (L Lᵀ) x = b. */
  function cholSolve(L, n, b) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
    return x;
  }

  /** Cyclic Jacobi eigenvalues of symmetric n×n matrix. */
  function symEigenvalues(Gin, n) {
    const A = Float64Array.from(Gin);
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          const apq = A[p * n + q];
          if (Math.abs(apq) < 1e-300) continue;
          const app = A[p * n + p], aqq = A[q * n + q];
          const theta = (aqq - app) / (2 * apq);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (let k = 0; k < n; k++) {
            const akp = A[k * n + p], akq = A[k * n + q];
            A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = A[p * n + k], aqk = A[q * n + k];
            A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk;
          }
        }
      }
    }
    const ev = [];
    for (let i = 0; i < n; i++) ev.push(A[i * n + i]);
    return ev.sort((a, b) => a - b);
  }

  /** Exact complexity index: condition number of the signature matrix (peak-normalized). */
  function complexityIndex(cols) {
    const n = cols.length;
    if (n === 0) return null;
    if (n === 1) return 1;
    const ev = symEigenvalues(gram(cols), n);
    if (ev[0] <= 1e-12 * ev[n - 1]) return Infinity;
    return Math.sqrt(ev[n - 1] / ev[0]);
  }

  /** Fast condition-number estimate from a Gram submatrix (for optimizers).
   *  Power / inverse iteration with Rayleigh-quotient estimates (error ∝ ε², typically < 0.5 % of cond). */
  function fastCond(G, n) {
    if (n <= 1) return 1;
    const L = cholesky(G, n);
    if (!L) return Infinity;
    const mul = x => { const w = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += G[i * n + j] * x[j]; w[i] = s; } return w; };
    const unit = x => { const nr = Math.sqrt(dot(x, x)); for (let i = 0; i < n; i++) x[i] /= nr; return x; };
    // λmax: power iteration
    let v = unit(new Float64Array(n).fill(1)), lmax = 0;
    for (let it = 0; it < 200; it++) {
      const w = mul(v), r = dot(v, w);
      v = unit(w);
      if (Math.abs(r - lmax) < 1e-12 * r) { lmax = r; break; }
      lmax = r;
    }
    lmax = dot(v, mul(v));
    // λmin: inverse iteration via the Cholesky factor
    let u = new Float64Array(n);
    for (let i = 0; i < n; i++) u[i] = 1 + 0.01 * ((i * 7919) % 13);
    unit(u);
    let lmin = Infinity;
    for (let it = 0; it < 300; it++) {
      u = unit(cholSolve(L, n, u));
      const r = dot(u, mul(u));
      if (Math.abs(r - lmin) < 1e-12 * r) { lmin = r; break; }
      lmin = r;
    }
    if (!(lmin > 0)) return Infinity;
    return Math.sqrt(lmax / lmin);
  }

  /** trace(G⁻¹): total unmixing noise amplification (A-optimal criterion). */
  function traceInv(G, n) {
    const L = cholesky(G, n);
    if (!L) return Infinity;
    // trace(G^-1) = ||L^-1||_F^2 ; compute columns of L^-1 by forward substitution
    let t = 0;
    for (let c = 0; c < n; c++) {
      const y = new Float64Array(n);
      for (let i = c; i < n; i++) {
        let s = i === c ? 1 : 0;
        for (let k = c; k < i; k++) s -= L[i * n + k] * y[k];
        y[i] = s / L[i * n + i];
        t += y[i] * y[i];
      }
    }
    return t;
  }

  function cosineMatrix(cols) {
    const n = cols.length, M = new Float64Array(n * n);
    const nr = cols.map(c => Math.sqrt(dot(c, c)) || 1);
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
      const v = i === j ? 1 : dot(cols[i], cols[j]) / (nr[i] * nr[j]);
      M[i * n + j] = v; M[j * n + i] = v;
    }
    return M;
  }

  /**
   * Ordinary-least-squares unmixing matrix W (n × D) = (SᵀS)⁻¹ Sᵀ.
   * Returns {W: Array<Float64Array>(n rows of length D)} or null if singular.
   */
  function unmixingMatrix(cols) {
    const n = cols.length, D = n ? cols[0].length : 0;
    const L = cholesky(gram(cols), n);
    if (!L) return null;
    const W = [];
    for (let i = 0; i < n; i++) W.push(new Float64Array(D));
    for (let d = 0; d < D; d++) {
      const b = new Float64Array(n);
      for (let i = 0; i < n; i++) b[i] = cols[i][d];
      const x = cholSolve(L, n, b);
      for (let i = 0; i < n; i++) W[i][d] = x[i];
    }
    return W;
  }

  /**
   * Spillover spreading matrix from a shot-noise model.
   * A cell carrying abundance a of fluor j produces detector signals a·s_j with
   * variance ∝ a·s_jd (photon statistics). After OLS unmixing, the extra variance
   * in fluor k is a·Σ_d W_kd² s_jd, so the spreading coefficient (SD per √intensity) is
   *   SS[j][k] = scale · sqrt(Σ_d W_kd² · s_jd).
   * Also returns the background-noise amplification ν_k = sqrt(Σ_d W_kd²).
   */
  function spreadMatrix(cols, W, scale) {
    scale = scale == null ? 1 : scale;
    const n = cols.length, D = n ? cols[0].length : 0;
    const SS = new Float64Array(n * n), nu = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let s2 = 0;
      for (let d = 0; d < D; d++) s2 += W[k][d] * W[k][d];
      nu[k] = Math.sqrt(s2);
    }
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      let v = 0;
      for (let d = 0; d < D; d++) v += W[k][d] * W[k][d] * cols[j][d];
      SS[j * n + k] = scale * Math.sqrt(Math.max(0, v));
    }
    return { SS, nu };
  }

  /** Full panel analysis. cols = signatures (peak-normalized). */
  function analyzePanel(cols, opts) {
    opts = opts || {};
    const n = cols.length;
    const res = { n, ci: null, cos: null, W: null, SS: null, nu: null, maxCos: null, warnings: [] };
    if (!n) return res;
    res.cos = cosineMatrix(cols);
    let mc = { v: -1, i: -1, j: -1 };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (res.cos[i * n + j] > mc.v) mc = { v: res.cos[i * n + j], i, j };
    res.maxCos = mc.i >= 0 ? mc : null;
    const D = cols[0].length;
    if (n > D) { res.ci = Infinity; res.warnings.push('More fluors than detectors: the system cannot be unmixed.'); return res; }
    res.ci = complexityIndex(cols);
    const W = unmixingMatrix(cols);
    if (!W || !isFinite(res.ci)) { res.ci = Infinity; res.warnings.push('Signature matrix is singular (two or more signatures are linearly dependent).'); return res; }
    res.W = W;
    const sp = spreadMatrix(cols, W, opts.spreadScale);
    res.SS = sp.SS; res.nu = sp.nu;
    return res;
  }

  /* ----------------------------------------------------- async helpers */
  const tick = () => new Promise(r => setTimeout(r, 0));
  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  /* --------------------------------------------- fluor-set optimization */
  /**
   * Choose `target` fluors from a candidate pool minimizing complexity index (or trace(G⁻¹)).
   * pool: [{id, sig, brightness}], required: [id], opts: {target, maxCos, objective:'ci'|'noise',
   *  brightnessWeight, restarts, timeLimitMs, onProgress, shouldStop, seed}
   */
  async function optimizeFluorSet(pool, required, opts) {
    const P = pool.length, idx = new Map(pool.map((p, i) => [p.id, i]));
    const req = required.map(id => idx.get(id)).filter(i => i != null);
    const target = Math.min(opts.target, P, pool[0] ? pool[0].sig.length : 0);
    const maxCos = opts.maxCos == null ? 0.98 : opts.maxCos;
    const bw = opts.brightnessWeight || 0;
    const G = gram(pool.map(p => p.sig)), C = cosineMatrix(pool.map(p => p.sig));
    const t0 = Date.now(), limit = opts.timeLimitMs || 20000;
    const rng = makeRng(opts.seed || 12345);
    let evals = 0;

    function objective(set) {
      const n = set.length;
      if (n <= 1) return 1 + bw * (n ? 1 / pool[set[0]].brightness : 0);
      const g = new Float64Array(n * n);
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) g[a * n + b] = G[set[a] * P + set[b]];
      evals++;
      let v = opts.objective === 'noise' ? traceInv(g, n) : fastCond(g, n);
      if (bw) { let s = 0; for (const i of set) s += 1 / Math.max(0.5, pool[i].brightness); v *= 1 + bw * s / n; }
      return v;
    }
    const compatible = (set, c) => set.every(s => C[s * P + c] <= maxCos);

    for (let a = 0; a < req.length; a++) for (let b = a + 1; b < req.length; b++)
      if (C[req[a] * P + req[b]] > maxCos) { /* required pair violates — allowed but reported */ }

    async function greedy(randomness) {
      const set = req.slice();
      while (set.length < target) {
        const scored = [];
        for (let c = 0; c < P; c++) {
          if (set.includes(c) || !compatible(set, c)) continue;
          set.push(c); scored.push([objective(set), c]); set.pop();
        }
        if (!scored.length) break;
        scored.sort((x, y) => x[0] - y[0] || pool[y[1]].brightness - pool[x[1]].brightness);
        const k = randomness ? Math.min(scored.length, 3) : 1;
        set.push(scored[Math.floor(rng() * k)][1]);
        if (opts.onProgress) opts.onProgress({ phase: 'build', n: set.length, target });
        await tick();
        if (opts.shouldStop && opts.shouldStop()) break;
      }
      return set;
    }

    async function localSearch(set) {
      let best = objective(set), improved = true;
      while (improved && Date.now() - t0 < limit) {
        improved = false;
        for (let pos = 0; pos < set.length; pos++) {
          if (req.includes(set[pos])) continue;
          const old = set[pos];
          for (let c = 0; c < P; c++) {
            if (set.includes(c)) continue;
            set[pos] = c;
            const others = set.filter((_, i) => i !== pos);
            if (compatible(others, c)) {
              const v = objective(set);
              if (v < best * (1 - 1e-9)) { best = v; improved = true; break; }
            }
            set[pos] = old;
          }
          if (pos % 4 === 0) {
            if (opts.onProgress) opts.onProgress({ phase: 'refine', best, evals });
            await tick();
            if (opts.shouldStop && opts.shouldStop()) return { set, best };
          }
          if (Date.now() - t0 > limit) break;
        }
      }
      return { set, best };
    }

    let bestSet = null, bestVal = Infinity;
    const restarts = Math.max(1, opts.restarts || 1);
    for (let r = 0; r < restarts; r++) {
      const s = await greedy(r > 0);
      const out = await localSearch(s);
      if (out.best < bestVal) { bestVal = out.best; bestSet = out.set.slice(); }
      if (Date.now() - t0 > limit || (opts.shouldStop && opts.shouldStop())) break;
    }
    const ids = (bestSet || []).map(i => pool[i].id);
    return { ids, objective: bestVal, evals, reachedTarget: ids.length >= target, elapsedMs: Date.now() - t0 };
  }

  /* ------------------------------------------ marker → fluor assignment */
  /**
   * Predicted resolution model for marker n on fluor f(n):
   *   signal_n = E_n · B_f(n)
   *   var_n    = (bg · ν_f(n))² + Σ_{m≠n} c(m,n) · SS[f(m)→f(n)]² · signal_m
   *   R_n      = signal_n / sqrt(var_n)
   * Cost = Σ_n w_n / R_n  (penalizes the worst-resolved markers most).
   * c(m,n)=1 when the markers share a population tag, else `unrelatedWeight`.
   */
  function coexpressionMatrix(markers, unrelatedWeight) {
    const n = markers.length, c = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const ta = markers[a].tags || [], tb = markers[b].tags || [];
      const any = t => t === 'all' || t === '*';
      const share = ta.length && tb.length && (ta.some(any) || tb.some(any) || ta.some(t => tb.includes(t)));
      c[a * n + b] = share ? 1 : unrelatedWeight;
    }
    return c;
  }

  /**
   * Evaluate an assignment. fluorIdx[m] = index into the analysis' fluor list.
   * an = {SS (k×k), nu (k)}; brightness[k].
   */
  function evaluateAssignment(markers, fluorIdx, an, brightness, k, opts) {
    const n = markers.length, bg = opts.background == null ? 3 : opts.background;
    const c = opts.coexp || coexpressionMatrix(markers, opts.unrelatedWeight == null ? 0.15 : opts.unrelatedWeight);
    const sig = markers.map((m, i) => m.expression * brightness[fluorIdx[i]]);
    const per = [];
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const fi = fluorIdx[i];
      const bgv = Math.pow(bg * an.nu[fi], 2);
      let sv = 0; const contrib = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const ss = an.SS[fluorIdx[j] * k + fi];
        const v = c[j * n + i] * ss * ss * sig[j];
        sv += v; if (v > 0) contrib.push({ marker: j, variance: v });
      }
      const R = sig[i] / Math.sqrt(bgv + sv + 1e-12);
      contrib.sort((a, b) => b.variance - a.variance);
      per.push({ marker: i, fluor: fi, signal: sig[i], bgVar: bgv, spreadVar: sv, R, top: contrib.slice(0, 3) });
      const wi = markers[i].weight == null ? 1 : markers[i].weight;
      if (wi > 0) cost += wi / R;
    }
    return { cost, per };
  }

  /**
   * Simulated-annealing assignment of markers to a fixed fluor set.
   * markers: [{name, expression, weight, tags, lockedFluor (index or -1)}]
   * an: analysis of the fluor set; brightness: per-fluor; k: number of fluors.
   */
  async function optimizeAssignment(markers, an, brightness, k, opts) {
    opts = opts || {};
    const n = markers.length;
    if (n > k) throw new Error('More markers than fluors.');
    const bg = opts.background == null ? 3 : opts.background;
    const coexp = coexpressionMatrix(markers, opts.unrelatedWeight == null ? 0.15 : opts.unrelatedWeight);
    const w = markers.map(m => m.weight == null ? 1 : m.weight), E = markers.map(m => m.expression);
    const rng = makeRng(opts.seed || 777);
    const locked = markers.map(m => (m.lockedFluor != null && m.lockedFluor >= 0) ? m.lockedFluor : -1);
    const lockedSet = new Set(locked.filter(x => x >= 0));
    for (const f of (opts.reserved || [])) lockedSet.add(f); // fluors only allowed for their locked marker (e.g. viability dyes)
    const free = []; for (let i = 0; i < n; i++) if (locked[i] < 0) free.push(i);

    // slot[f] = marker index using fluor f, or -1
    function initial() {
      const asg = locked.slice();
      const avail = []; for (let f = 0; f < k; f++) if (!lockedSet.has(f)) avail.push(f);
      // brightest fluors to dimmest markers as a sensible start
      avail.sort((a, b) => brightness[b] - brightness[a]);
      const order = free.slice().sort((a, b) => E[a] - E[b]);
      order.forEach((m, i) => { asg[m] = avail[i]; });
      return asg;
    }
    function fullState(asg) {
      const sig = new Float64Array(n), vr = new Float64Array(n);
      for (let i = 0; i < n; i++) sig[i] = E[i] * brightness[asg[i]];
      for (let i = 0; i < n; i++) {
        let v = Math.pow(bg * an.nu[asg[i]], 2);
        for (let j = 0; j < n; j++) if (j !== i) { const ss = an.SS[asg[j] * k + asg[i]]; v += coexp[j * n + i] * ss * ss * sig[j]; }
        vr[i] = v;
      }
      let cost = 0;
      for (let i = 0; i < n; i++) if (w[i] > 0) cost += w[i] * Math.sqrt(vr[i] + 1e-12) / sig[i];
      return { sig, vr, cost };
    }
    if (!free.length) {
      const asg = locked.slice();
      return { assignment: asg, cost: fullState(asg).cost };
    }

    let best = null, bestCost = Infinity;
    const restarts = opts.restarts || 4, iters = opts.iterations || Math.max(20000, 60 * n * n);
    const validInit = opts.initial && opts.initial.length === n && new Set(opts.initial).size === n && opts.initial.every((f, i) => f >= 0 && f < k && (locked[i] < 0 || locked[i] === f));
    if (validInit) { best = opts.initial.slice(); bestCost = fullState(best).cost; } // never return something worse than (or merely tied with) the current assignment
    for (let r = 0; r < restarts; r++) {
      let asg = r === 0 && validInit ? opts.initial.slice() : initial();
      if (r > 0) { // shuffle free markers' fluors
        const fl = free.map(m => asg[m]);
        for (let i = fl.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [fl[i], fl[j]] = [fl[j], fl[i]]; }
        free.forEach((m, i) => { asg[m] = fl[i]; });
      }
      let st = fullState(asg);
      const unused = []; for (let f = 0; f < k; f++) if (!asg.includes(f) && !lockedSet.has(f)) unused.push(f);
      // temperature from typical deltas
      let T = Math.max(1e-6, st.cost * 0.05);
      const Tend = T * 1e-4, alpha = Math.pow(Tend / T, 1 / iters);
      let cur = st.cost;
      for (let it = 0; it < iters; it++) {
        const a = free[Math.floor(rng() * free.length)];
        let b = -1, newF = -1;
        if (unused.length && rng() < 0.3) newF = Math.floor(rng() * unused.length);
        else { if (free.length < 2) { if (!unused.length) break; newF = Math.floor(rng() * unused.length); } else { do { b = free[Math.floor(rng() * free.length)]; } while (b === a); } }
        const fa = asg[a];
        if (newF >= 0) { asg[a] = unused[newF]; unused[newF] = fa; }
        else { asg[a] = asg[b]; asg[b] = fa; }
        const ns = fullStateCheap(asg);
        const d = ns - cur;
        if (d <= 0 || rng() < Math.exp(-d / T)) { cur = ns; }
        else { // revert
          if (newF >= 0) { unused[newF] = asg[a]; asg[a] = fa; }
          else { asg[b] = asg[a]; asg[a] = fa; }
        }
        if (cur < bestCost * (1 - 1e-9)) { bestCost = cur; best = asg.slice(); }
        T *= alpha;
        if (it % 4000 === 0) {
          if (opts.onProgress) opts.onProgress({ restart: r + 1, restarts, frac: it / iters, best: bestCost });
          await tick();
          if (opts.shouldStop && opts.shouldStop()) { r = restarts; break; }
        }
      }
    }
    function fullStateCheap(asg) { return fullState(asg).cost; }
    return { assignment: best, cost: bestCost };
  }

  /* ---------------------------------------------- reference import (CSV) */
  function normDetName(s) {
    return String(s).trim().toUpperCase()
      .replace(/^["']|["']$/g, '')
      .replace(/\s*-\s*(A|H|W)$/, '')
      .replace(/\s+/g, '').replace(/_/g, '-').replace(/NM/g, '')
      .replace(/^(\d{3})-?(?:CH)-?(\d+)$/, '$1-$2');
  }

  function parseDelimited(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim().length);
    if (!lines.length) return [];
    const sample = lines.slice(0, 40);
    const delim = [',', '\t', ';'].map(d => [d, Math.max(...sample.map(l => l.split(d).length))]).sort((a, b) => b[1] - a[1])[0][0];
    return lines.map(l => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
        else if (ch === '"') q = true;
        else if (ch === delim) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out.map(s => s.trim());
    });
  }

  /**
   * Parse reference signatures from CSV/TSV in either orientation:
   *  (a) rows = fluors, header = detector names    (b) rows = detectors, header = fluor names
   * Returns {signatures: [{name, sig}], matched, unmatched, orientation}
   */
  function parseReferenceTable(text, dets) {
    const rows = parseDelimited(text);
    if (rows.length < 2) throw new Error('File has fewer than two rows.');
    const detIndex = new Map(dets.map((d, i) => [normDetName(d.name), i]));
    const matchCount = arr => arr.filter(x => detIndex.has(normDetName(x))).length;
    // locate header row (first 10 rows) with the most detector names
    let hdr = -1, hdrHits = 0;
    for (let r = 0; r < Math.min(10, rows.length); r++) { const h = matchCount(rows[r]); if (h > hdrHits) { hdrHits = h; hdr = r; } }
    const colHits = matchCount(rows.map(r => r[0]));
    const signatures = [];
    let orientation, unmatched = [];
    if (hdrHits >= colHits && hdrHits > 0) {
      orientation = 'fluors-in-rows';
      const header = rows[hdr];
      const map = header.map(h => detIndex.has(normDetName(h)) ? detIndex.get(normDetName(h)) : -1);
      unmatched = header.filter((h, i) => i > 0 && h && map[i] < 0 && isNaN(parseFloat(h)));
      const nameCol = map.findIndex(x => x < 0) >= 0 ? map.findIndex(x => x < 0) : 0;
      for (let r = hdr + 1; r < rows.length; r++) {
        const row = rows[r];
        const sig = new Float64Array(dets.length); let any = false;
        for (let c = 0; c < row.length; c++) if (map[c] >= 0) { const v = parseFloat(row[c]); if (isFinite(v)) { sig[map[c]] = Math.max(0, v); any = true; } }
        if (any) signatures.push({ name: row[nameCol] || ('Row ' + r), sig: normMax(sig) });
      }
    } else if (colHits > 0) {
      orientation = 'detectors-in-rows';
      const header = rows.find(r => !detIndex.has(normDetName(r[0]))) || rows[0];
      const names = header.slice(1);
      const sigs = names.map(() => new Float64Array(dets.length));
      for (const row of rows) {
        const k = detIndex.get(normDetName(row[0]));
        if (k == null) { if (row !== header && row[0]) unmatched.push(row[0]); continue; }
        for (let c = 1; c < row.length; c++) { const v = parseFloat(row[c]); if (isFinite(v) && sigs[c - 1]) sigs[c - 1][k] = Math.max(0, v); }
      }
      names.forEach((nm, i) => { if (nm && sigs[i].some(v => v > 0)) signatures.push({ name: nm, sig: normMax(sigs[i]) }); });
    } else {
      throw new Error('No column or row names matched this instrument\'s detector names (e.g. ' + dets.slice(0, 3).map(d => d.name).join(', ') + ').');
    }
    const matched = Math.max(hdrHits, colHits);
    return { signatures, matched, unmatched, orientation };
  }

  /** Parse a custom dye spectrum CSV: wavelength, excitation, emission columns. */
  function parseSpectrumTable(text) {
    const rows = parseDelimited(text);
    const num = rows.filter(r => r.length >= 3 && isFinite(parseFloat(r[0])));
    if (num.length < 5) throw new Error('Expected columns: wavelength, excitation, emission (≥5 numeric rows).');
    const exPts = [], emPts = [];
    for (const r of num) {
      const w = parseFloat(r[0]), a = parseFloat(r[1]), b = parseFloat(r[2]);
      if (isFinite(a)) exPts.push([w, a]);
      if (isFinite(b)) emPts.push([w, b]);
    }
    return { ex: resamplePoints(exPts), em: resamplePoints(emPts) };
  }

  /* ------------------------------------------------------------ FCS */
  function parseFCS(buf) {
    const u8 = new Uint8Array(buf);
    const ascii = (a, b) => { let s = ''; for (let i = a; i < b; i++) s += String.fromCharCode(u8[i]); return s; };
    const version = ascii(0, 6);
    if (!/^FCS[23]\./.test(version)) throw new Error('Not an FCS file');
    const num = (a, b) => parseInt(ascii(a, b).trim() || '0', 10);
    const tBeg = num(10, 18), tEnd = num(18, 26);
    let dBeg = num(26, 34), dEnd = num(34, 42);
    const text = new TextDecoder('latin1').decode(u8.subarray(tBeg, tEnd + 1));
    const delim = text[0];
    const kw = {};
    // split honoring doubled delimiters as escapes
    const parts = []; let cur = '';
    for (let i = 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === delim) { if (text[i + 1] === delim) { cur += delim; i++; } else { parts.push(cur); cur = ''; } }
      else cur += ch;
    }
    if (cur) parts.push(cur);
    for (let i = 0; i + 1 < parts.length; i += 2) kw[parts[i].toUpperCase().trim()] = parts[i + 1];
    if (!dBeg && kw['$BEGINDATA']) { dBeg = parseInt(kw['$BEGINDATA'], 10); dEnd = parseInt(kw['$ENDDATA'], 10); }
    const P = parseInt(kw['$PAR'], 10), N = parseInt(kw['$TOT'], 10);
    const type = (kw['$DATATYPE'] || 'F').toUpperCase();
    const little = !(kw['$BYTEORD'] || '1,2,3,4').trim().startsWith('4');
    if ((kw['$MODE'] || 'L').toUpperCase() !== 'L') throw new Error('Only list-mode FCS is supported');
    const names = [], labels = [], bits = [], ranges = [];
    for (let p = 1; p <= P; p++) {
      names.push((kw['$P' + p + 'N'] || ('P' + p)).trim());
      labels.push((kw['$P' + p + 'S'] || '').trim());
      bits.push(parseInt(kw['$P' + p + 'B'] || '32', 10));
      ranges.push(parseFloat(kw['$P' + p + 'R'] || '0'));
    }
    const dv = new DataView(buf, dBeg, dEnd - dBeg + 1);
    const data = new Float32Array(N * P);
    let off = 0;
    for (let e = 0; e < N; e++) for (let p = 0; p < P; p++) {
      let v;
      if (type === 'F') { v = dv.getFloat32(off, little); off += 4; }
      else if (type === 'D') { v = dv.getFloat64(off, little); off += 8; }
      else { // integer
        const b = bits[p];
        if (b === 16) { v = dv.getUint16(off, little); off += 2; }
        else if (b === 32) { v = dv.getUint32(off, little); off += 4; }
        else if (b === 8) { v = dv.getUint8(off); off += 1; }
        else throw new Error('Unsupported integer width ' + b);
        if (ranges[p] > 0 && (ranges[p] & (ranges[p] - 1)) === 0) v = v % ranges[p];
      }
      data[e * P + p] = v;
    }
    return { version, keywords: kw, names, labels, ranges, N, P, data };
  }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const x = (sorted.length - 1) * q, i = Math.floor(x), f = x - i;
    return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
  }
  function median(arr) { const s = Float64Array.from(arr).sort(); return quantile(s, 0.5); }

  /**
   * Extract a reference signature from a single-stain FCS.
   * fcs: parsed; dets: instrument detectors; negFcs: optional unstained control.
   * Strategy: scatter core gate → peak channel = largest (p99.5 − median) →
   * positives = top `posFrac` events in peak channel (excluding near-saturated) →
   * negatives = unstained events (or bottom 30% in peak channel) → median(pos) − median(neg).
   */
  function signatureFromFCS(fcs, dets, opts) {
    opts = opts || {};
    const posFrac = opts.posFrac || 0.02;
    const detIdx = dets.map(d => {
      const target = normDetName(d.name);
      let k = fcs.names.findIndex(nm => normDetName(nm) === target && /-A$/i.test(nm.trim()));
      if (k < 0) k = fcs.names.findIndex(nm => normDetName(nm) === target);
      return k;
    });
    const found = detIdx.filter(k => k >= 0).length;
    if (found < Math.max(3, dets.length * 0.5)) throw new Error(`Only ${found}/${dets.length} detector channels found in FCS (channels look like: ${fcs.names.slice(0, 6).join(', ')}).`);
    const P = fcs.P, N = fcs.N, data = fcs.data;
    const col = (src, k) => { const out = new Float64Array(src.N); for (let e = 0; e < src.N; e++) out[e] = src.data[e * src.P + k]; return out; };
    function gate(src) {
      const fsc = src.names.findIndex(n => /^FSC.*-A$/i.test(n)), ssc = src.names.findIndex(n => /^SSC.*-A$/i.test(n));
      const keep = new Uint8Array(src.N).fill(1);
      for (const k of [fsc, ssc]) {
        if (k < 0) continue;
        const v = Float64Array.from(col(src, k)).sort();
        const lo = quantile(v, 0.05), hi = quantile(v, 0.98);
        for (let e = 0; e < src.N; e++) { const x = src.data[e * src.P + k]; if (x < lo || x > hi) keep[e] = 0; }
      }
      return keep;
    }
    const keep = gate(fcs);
    const ev = []; for (let e = 0; e < N; e++) if (keep[e]) ev.push(e);
    if (ev.length < 200) throw new Error('Too few events after scatter gating.');
    // peak channel
    let peak = -1, best = -Infinity;
    detIdx.forEach((k, i) => {
      if (k < 0) return;
      const v = Float64Array.from(ev.map(e => data[e * P + k])).sort();
      const s = quantile(v, 0.995) - quantile(v, 0.5);
      if (s > best) { best = s; peak = i; }
    });
    const pk = detIdx[peak];
    const sat = fcs.ranges[pk] > 0 ? fcs.ranges[pk] * 0.98 : Infinity;
    const vals = ev.map(e => data[e * P + pk]).filter(x => x < sat).sort((a, b) => a - b);
    const thrPos = quantile(vals, 1 - posFrac);
    const pos = ev.filter(e => { const x = data[e * P + pk]; return x >= thrPos && x < sat; });
    let negMed;
    if (opts.negative) {
      const nf = opts.negative, nk = gate(nf);
      const nIdx = dets.map(d => { const t = normDetName(d.name); let k = nf.names.findIndex(nm => normDetName(nm) === t && /-A$/i.test(nm.trim())); if (k < 0) k = nf.names.findIndex(nm => normDetName(nm) === t); return k; });
      const nev = []; for (let e = 0; e < nf.N; e++) if (nk[e]) nev.push(e);
      negMed = nIdx.map(k => k < 0 ? 0 : median(nev.map(e => nf.data[e * nf.P + k])));
    } else {
      const thrNeg = quantile(vals, 0.3);
      const neg = ev.filter(e => data[e * P + pk] <= thrNeg);
      negMed = detIdx.map(k => k < 0 ? 0 : median(neg.map(e => data[e * P + k])));
    }
    const sig = new Float64Array(dets.length);
    detIdx.forEach((k, i) => { if (k >= 0) sig[i] = Math.max(0, median(pos.map(e => data[e * P + k])) - negMed[i]); });
    const name = (fcs.labels[pk] && fcs.labels[pk] !== fcs.names[pk]) ? fcs.labels[pk] : (fcs.keywords['TUBE NAME'] || fcs.keywords['$FIL'] || 'FCS reference').replace(/\.fcs$/i, '');
    return { name, sig: normMax(sig), peakDet: dets[peak].name, nPos: pos.length, nEvents: ev.length, missing: dets.length - found };
  }

  /** Autofluorescence signature from an unstained (cells) FCS: median of scatter-gated events per channel. */
  function autofluorescenceFromFCS(fcs, dets) {
    const detIdx = dets.map(d => {
      const t = normDetName(d.name);
      let k = fcs.names.findIndex(nm => normDetName(nm) === t && /-A$/i.test(nm.trim()));
      if (k < 0) k = fcs.names.findIndex(nm => normDetName(nm) === t);
      return k;
    });
    const found = detIdx.filter(k => k >= 0).length;
    if (found < Math.max(3, dets.length * 0.5)) throw new Error(`Only ${found}/${dets.length} detector channels found in FCS.`);
    const P = fcs.P, N = fcs.N, data = fcs.data;
    const keep = new Uint8Array(N).fill(1);
    for (const re of [/^FSC.*-A$/i, /^SSC.*-A$/i]) {
      const k = fcs.names.findIndex(n => re.test(n)); if (k < 0) continue;
      const v = new Float64Array(N); for (let e = 0; e < N; e++) v[e] = data[e * P + k];
      const s = Float64Array.from(v).sort(), lo = quantile(s, 0.1), hi = quantile(s, 0.95);
      for (let e = 0; e < N; e++) if (v[e] < lo || v[e] > hi) keep[e] = 0;
    }
    const ev = []; for (let e = 0; e < N; e++) if (keep[e]) ev.push(e);
    if (ev.length < 200) throw new Error('Too few events after scatter gating.');
    const sig = new Float64Array(dets.length);
    detIdx.forEach((k, i) => { if (k >= 0) sig[i] = Math.max(0, median(ev.map(e => data[e * P + k]))); });
    return { sig: normMax(sig), nEvents: ev.length };
  }

  /**
   * Read a Honeychrome experiment (.kit, JSON). Profiles are stored in the order of
   * settings.raw.fluorescence_channel_ids (indices into event_channels_pnn).
   */
  function parseHoneychromeKit(obj, dets) {
    if (!obj || !obj.settings || !obj.process) throw new Error('Not a Honeychrome experiment (.kit) file.');
    const raw = obj.settings.raw || {}, proc = obj.process || {};
    const pnn = raw.event_channels_pnn || [], ids = raw.fluorescence_channel_ids || [];
    const chNames = ids.map(i => pnn[i]);
    if (!chNames.length) throw new Error('The experiment has no fluorescence channel list.');
    const detIndex = new Map(dets.map((d, i) => [normDetName(d.name), i]));
    const map = chNames.map(c => detIndex.has(normDetName(c)) ? detIndex.get(normDetName(c)) : -1);
    const matched = map.filter(x => x >= 0).length;
    const toSig = v => { const s = new Float64Array(dets.length); v.forEach((x, j) => { if (map[j] >= 0 && isFinite(x)) s[map[j]] = Math.max(0, x); }); return normMax(s); };
    const model = proc.spectral_model || [];
    const refs = [];
    for (const [label, v] of Object.entries(proc.profiles || {})) {
      if (!Array.isArray(v) || v.length !== chNames.length) continue;
      const m = model.find(e => e.label === label) || {};
      refs.push({ label, antigen: m.antigen || '', particleType: m.particle_type || '', sampleName: m.sample_name || '', warning: m.profile_warning || null, sig: toSig(v) });
    }
    const af = [];
    for (const [name, entry] of Object.entries(proc.af_profiles || {})) {
      let sp = entry && (entry.spectra || entry.spectrum || entry);
      if (!Array.isArray(sp) || !sp.length) continue;
      let rows = Array.isArray(sp[0]) ? sp : [sp];
      const names = entry && entry.channel_names;
      if (Array.isArray(names) && names.length === rows[0].length && names.length !== chNames.length) {
        const pos = new Map(names.map((c, k) => [normDetName(c), k]));
        rows = rows.map(r => chNames.map(c => pos.has(normDetName(c)) ? r[pos.get(normDetName(c))] : 0));
      }
      const good = rows.filter(r => Array.isArray(r) && r.length === chNames.length);
      if (!good.length) continue;
      const mean = new Array(chNames.length).fill(0);
      good.forEach(r => { const mx = Math.max(...r.map(Math.abs)) || 1; r.forEach((x, j) => { mean[j] += x / mx / good.length; }); });
      af.push({ name, sig: toSig(mean), components: good.length });
    }
    return { cytometer: raw.cytometer || '', nChannels: chNames.length, matched, refs, af, unmixingMethod: proc.unmixing_method || '' };
  }

  /** Read a Panel Check export (honeychrome-panel-check JSON) into the same shape as parseHoneychromeKit. */
  function parsePanelCheck(obj, dets) {
    if (!obj || obj.app !== 'honeychrome-panel-check') throw new Error('Not a Panel Check export.');
    const detIndex = new Map(dets.map((d, i) => [normDetName(d.name), i]));
    const map = (obj.channels || []).map(c => detIndex.has(normDetName(c)) ? detIndex.get(normDetName(c)) : -1);
    const toSig = v => { const s = new Float64Array(dets.length); (v || []).forEach((x, j) => { if (map[j] >= 0 && isFinite(x)) s[map[j]] = Math.max(0, x); }); return normMax(s); };
    const refs = (obj.controls || []).filter(c => Array.isArray(c.spectrum) && c.spectrum.length === map.length).map(c => ({
      label: c.label, antigen: c.antigen || '', particleType: c.particle_type || '', warning: c.profile_warning || null, sig: toSig(c.spectrum),
      stainIndex: c.stain_index, status: c.status, maxResidual: c.max_residual, residualInto: c.worst_residual_into, libraryAgreement: c.library_agreement }));
    const af = (obj.af_profiles || []).map(a => ({ name: a.name, sig: toSig(a.spectrum), components: a.components || 1 }));
    return { cytometer: obj.cytometer || '', nChannels: map.length, matched: map.filter(x => x >= 0).length, refs, af, unmixingMethod: obj.unmixing_method || '',
      spread: obj.spread || null, experiment: obj.experiment || '', panelCheck: true };
  }

  /* ---------------------------------------------------------- color */
  /** Approximate visible color of a wavelength (for spectrum swatches). */
  function wavelengthColor(wl) {
    let r = 0, g = 0, b = 0;
    if (wl < 380) { r = 0.38; g = 0.0; b = 0.55; }
    else if (wl < 440) { r = -(wl - 440) / 60; b = 1; }
    else if (wl < 490) { g = (wl - 440) / 50; b = 1; }
    else if (wl < 510) { g = 1; b = -(wl - 510) / 20; }
    else if (wl < 580) { r = (wl - 510) / 70; g = 1; }
    else if (wl < 645) { r = 1; g = -(wl - 645) / 65; }
    else if (wl <= 700) { r = 1; }
    else { r = Math.max(0.35, 1 - (wl - 700) / 250); g = 0; b = 0.05; }
    const f = wl < 420 ? 0.45 + 0.55 * Math.max(0, (wl - 360) / 60) : wl > 700 ? 1 : 1;
    const c = v => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v * f)), 0.8));
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }

  return {
    GRID_START, GRID_STEP, GRID_N, gridWl, decodeSpectrum, normMax, at, peakWl, shift, resamplePoints,
    buildLibrary, detectors, simulateRaw, simulateSignature, pwl, calibrateGains,
    dot, gram, cholesky, cholSolve, symEigenvalues, complexityIndex, fastCond, traceInv, cosineMatrix,
    unmixingMatrix, spreadMatrix, analyzePanel,
    optimizeFluorSet, optimizeAssignment, evaluateAssignment, coexpressionMatrix,
    normDetName, parseDelimited, parseReferenceTable, parseSpectrumTable, parseFCS, signatureFromFCS, autofluorescenceFromFCS, parseHoneychromeKit, parsePanelCheck, median, quantile,
    wavelengthColor, makeRng
  };
});
