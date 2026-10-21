// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/* App core: state, fluor registry, signatures, analysis cache, persistence, helpers. */
(function (root) {
  'use strict';
  const E = root.SPD, DATA = root.SPD_DATA, C = root.SPDCharts;
  const APP_VERSION = '0.9.0', FILE_VERSION = 1;
  // File identifier. Panels saved before the rename to Panelyzer use the legacy id and still open.
  const APP_ID = 'panelyzer', LEGACY_APP_IDS = ['spectral-panel-designer'];

  /* ------------------------------------------------------------ DOM helpers */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
  function toast(msg, isErr) {
    const host = $('#toasts'); const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), role: 'status' }, msg);
    host.appendChild(t); while (host.children.length > 3) host.firstChild.remove();
    setTimeout(() => t.remove(), isErr ? 7000 : 3800);
  }
  function statusEl(kind, text) {
    const icon = { good: '✓', warn: '!', bad: '×', info: 'i' }[kind] || 'i';
    return h('span', { class: 'status ' + kind }, h('span', { class: 'ico', 'aria-hidden': 'true' }, icon), text);
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
  const safeName = s => (s || 'panel').replace(/[^\w\- .]+/g, '_').trim() || 'panel';
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fmt = (v, d) => v == null || !isFinite(v) ? '—' : (+v).toFixed(d == null ? 2 : d);
  const normKey = s => String(s || '').toLowerCase().replace(/[\s\-\/_.,()®™]+/g, '');
  function readFile(file, as) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); if (as === 'buffer') r.readAsArrayBuffer(file); else r.readAsText(file); });
  }
  function pickFiles(accept, multiple) {
    return new Promise(res => {
      const i = h('input', { type: 'file', accept, multiple: multiple || null, style: 'display:none' });
      i.addEventListener('change', () => { res([...i.files]); i.remove(); });
      document.body.appendChild(i); i.click();
    });
  }

  /* ---------------------------------------------------------------- library */
  const LIB = E.buildLibrary(root.SPD_FPBASE_LINES, DATA.DERIVED, DATA.META);
  // automatic aliases
  for (const f of LIB.values()) {
    const a = new Set(f.aliases);
    let m;
    if ((m = f.name.match(/^BV(\d+)$/))) a.add('Brilliant Violet ' + m[1]);
    if ((m = f.name.match(/^BUV(\d+)$/))) { a.add('BD Horizon BUV' + m[1]); a.add('Brilliant Ultraviolet ' + m[1]); }
    if ((m = f.name.match(/^BB(\d+)$/))) a.add('BD Horizon BB' + m[1]);
    if ((m = f.name.match(/^RB(\d+)$/))) a.add('RealBlue ' + m[1]);
    if ((m = f.name.match(/^RY(\d+)$/))) a.add('RealYellow ' + m[1]);
    if (f.name.startsWith('Alexa Fluor ')) a.add('AF' + f.name.slice(12));
    if (f.name.includes('-')) a.add(f.name.replace(/-/g, '/'));
    if (f.name.startsWith('PE-')) a.add('PE ' + f.name.slice(3));
    if (f.name.startsWith('APC-')) a.add('APC ' + f.name.slice(4));
    if (f.name.startsWith('NovaFluor ')) a.add('Nova' + f.name.slice(10));
    if (f.name.startsWith('Ghost Dye ')) a.add('Ghost ' + f.name.slice(10));
    if ((m = f.name.match(/^StarBright UV (\d+)$/))) a.add('SBUV' + m[1]);
    f.aliases = [...a];
  }

  /* ---------------------------------------- Honeychrome measured reference library */
  // Measured reference spectra bundled with Honeychrome (Cytkit, LGPL-3.0): data/<cytometer>_spectral_reference_library.csv
  const HCLIB = root.SPD_HC_LIBRARY || {};
  const HC_KEY = { 'aurora-5l': 'Aurora', 'id7000-5l': 'ID7000', 'id7000-7l': 'ID7000' };
  const HC_EXTRA = { kiraviablue520: 'Kiravia Blue 520', v450: 'BD Horizon V450', v500: 'BD Horizon V500', mfluorvio610: 'mFluor Violet 610', rb670: 'RealBlue 670', bv786: 'BV785', gfp: 'EGFP' };
  const LIB_KEYS = new Map();
  for (const f of LIB.values()) { LIB_KEYS.set(normKey(f.name), f); }
  for (const f of LIB.values()) for (const a of f.aliases || []) if (!LIB_KEYS.has(normKey(a))) LIB_KEYS.set(normKey(a), f);
  function libFluorForHC(name) { const k = normKey(name); return LIB_KEYS.get(k) || (HC_EXTRA[k] && LIB.get(HC_EXTRA[k])) || null; }
  function hcGroup(name) {
    if (/^(SB|BUV|BV|BB|RB|RY|RR|BYG|Super Bright|StarBright)/i.test(name)) return 'Polymer dye';
    if (/^(PE|APC|PerCP)[- ]/i.test(name)) return 'Tandem';
    if (/ViaKrome|Zombie|LIVE|Viab/i.test(name)) return 'Viability';
    if (/GFP|RFP|Cherry/i.test(name)) return 'Fluorescent protein';
    return 'Small molecule';
  }
  function hcAliases(name) {
    const a = [];
    let m;
    if ((m = name.match(/^SBUV(\d+)$/))) a.push('StarBright UV ' + m[1], 'StarBright UltraViolet ' + m[1]);
    if ((m = name.match(/^SBV(\d+)$/))) a.push('StarBright Violet ' + m[1]);
    if ((m = name.match(/^SBB(\d+)$/))) a.push('StarBright Blue ' + m[1]);
    if ((m = name.match(/^SBY(\d+)$/))) a.push('StarBright Yellow ' + m[1]);
    if ((m = name.match(/^RY(\d+)$/))) a.push('RealYellow ' + m[1]);
    if ((m = name.match(/^RR(\d+)$/))) a.push('RealRed ' + m[1]);
    if ((m = name.match(/^PerCP[- ]Fire (\d+)$/))) a.push('PerCP-Fire ' + m[1], 'PerCP Fire ' + m[1]);
    return a;
  }
  function hcKeyFor(inst) { return (inst && (inst.hcLibrary || HC_KEY[inst.id] || HC_KEY[inst.basedOn])) || null; }
  /** Library spectra mapped onto an instrument's detectors: Map(libraryName → Float64Array). */
  function hcSpectraFor(inst, D) {
    const key = hcKeyFor(inst), L = key && HCLIB[key];
    if (!L) return null;
    const di = D.map(d => L.channels.findIndex(c => E.normDetName(c) === E.normDetName(d.name)));
    if (di.filter(i => i >= 0).length < D.length * 0.8) return null;
    const out = new Map();
    for (const [name, code] of Object.entries(L.spectra)) {
      const s = new Float64Array(D.length);
      di.forEach((i, k) => { if (i >= 0) { const q = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(code[i]); s[k] = (q / 63) * (q / 63); } });
      out.set(name, E.normMax(s));
    }
    return { key, spectra: out };
  }
  const _autoGainCache = new Map();
  /** Per-detector gains fitted from the bundled measured library (FPbase-backed dyes only). */
  function autoGains(inst) {
    const ov = state.instOverrides[inst.id] || {};
    const ck = inst.id + '|' + JSON.stringify(ov.laserScale || {});
    if (_autoGainCache.has(ck)) return _autoGainCache.get(ck);
    let res = null;
    const D = E.detectors(inst), hc = hcSpectraFor(inst, D);
    if (hc) {
      const pairs = [];
      for (const [name, meas] of hc.spectra) { const f = libFluorForHC(name); if (f && f.source === 'FPbase' && f.kind === 'dye') pairs.push({ name: f.name, base: E.simulateRaw(f, inst, D), meas }); }
      if (pairs.length >= 8) {
        const cal = E.calibrateGains(pairs, D);
        const gains = {}; D.forEach((d, i) => { gains[d.name] = cal.gains[i]; });
        res = { gains, n: pairs.length, rmsBefore: cal.rmsBefore, rmsAfter: cal.rmsAfter, key: hc.key };
      }
    }
    _autoGainCache.set(ck, res);
    return res;
  }

  /* ------------------------------------------------------------------ state */
  function defaultState() {
    return {
      fileVersion: FILE_VERSION, app: APP_ID, panelName: 'Untitled panel',
      instrumentId: 'aurora-5l', customInstruments: [], instOverrides: {}, fluorOverrides: {},
      customFluors: [], references: {}, useReferences: true, autofluorescence: {},
      rows: [],
      settings: { simWarn: 0.98, simCaution: 0.9, spreadScale: 1, background: 3, unrelatedWeight: 0.15, theme: 'auto', afLevel: 2, useHCLibrary: true, autoCalibrate: true },
      ui: { tab: 'panel', highlight: [], libFilter: { q: '', group: '', laser: '', source: '', inventory: false } },
    };
  }
  let state = defaultState();
  let dirty = false;
  const undoStack = [], redoStack = [];
  function snapshot() { return JSON.stringify(state); }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
  function undo() { if (!undoStack.length) return toast('Nothing to undo'); redoStack.push(snapshot()); state = JSON.parse(undoStack.pop()); afterLoad(); toast('Undone'); }
  function redo() { if (!redoStack.length) return toast('Nothing to redo'); undoStack.push(snapshot()); state = JSON.parse(redoStack.pop()); afterLoad(); toast('Redone'); }

  /* ------------------------------------------------------------ instruments */
  function allInstruments() { return DATA.INSTRUMENTS.concat(state.customInstruments); }
  function baseInstrument(id) { return allInstruments().find(i => i.id === (id || state.instrumentId)) || DATA.INSTRUMENTS[0]; }
  /** Instrument with user overrides (laser scales, detector gain corrections) applied. */
  function instrument(opts) {
    const inst = JSON.parse(JSON.stringify(baseInstrument()));
    const ov = state.instOverrides[inst.id] || {};
    for (const L of inst.lasers) if (ov.laserScale && ov.laserScale[L.wl] != null) L.scale = ov.laserScale[L.wl];
    if (!(opts && opts.noGains)) {
      const g = ov.gains || (state.settings.autoCalibrate !== false ? (autoGains(inst) || {}).gains : null);
      if (g) for (const L of inst.lasers) for (const d of L.detectors) if (g[d.name] != null) d.gain = g[d.name];
    }
    return inst;
  }
  let _detCache = null;
  function dets() { if (!_detCache) _detCache = E.detectors(instrument()); return _detCache; }

  /* ---------------------------------------------------------- fluor registry */
  let _registry = null;
  function registry() {
    if (_registry) return _registry;
    const list = [];
    for (const f of LIB.values()) list.push(Object.assign({}, f));
    for (const c of state.customFluors) {
      const ex = Float64Array.from(c.ex), em = Float64Array.from(c.em);
      list.push({ id: c.name, name: c.name, kind: 'dye', source: 'Custom', sourceNote: c.note || 'User-imported spectrum', ex, em, brightness: c.brightness || 3, group: c.group || 'Custom', aliases: [], exPeak: E.peakWl(ex), emPeak: E.peakWl(em) });
    }
    const known = new Set(list.map(f => f.name));
    // measured library for this instrument: attach to matching fluors, add the rest as library-only fluors
    const hc = hcSpectraFor(baseInstrument(), E.detectors(baseInstrument()));
    if (hc) {
      const byNm = new Map(list.map(f => [f.name, f]));
      for (const name of hc.spectra.keys()) {
        const lf = libFluorForHC(name), f = lf && byNm.get(lf.name);
        if (f) { if (!f.hcName) f.hcName = name; continue; }
        if (known.has(name)) continue;
        known.add(name);
        const m = DATA.META[name] || {};
        list.push({ id: name, name, kind: 'dye', source: 'Honeychrome', sourceNote: `Measured on ${hc.key} (Honeychrome reference library)`, ex: null, em: null, brightness: m.b || 3, group: m.g || hcGroup(name), aliases: hcAliases(name), exPeak: null, emPeak: null, hcName: name, hcOnly: true });
      }
    }
    const refs = refsForInstrument();
    for (const r of refs) {
      if (r.linkedFluor && known.has(r.linkedFluor)) continue;
      if (known.has(r.name)) continue;
      known.add(r.name);
      list.push({ id: r.name, name: r.name, kind: 'dye', source: 'Reference', sourceNote: 'Measured reference only (' + r.origin + ')', ex: null, em: null, brightness: 3, group: 'Reference only', aliases: [], exPeak: null, emPeak: null, refOnly: true });
    }
    for (const f of list) {
      const o = state.fluorOverrides[f.name];
      if (o && o.brightness != null) f.brightness = o.brightness;
      f.inventory = !!(o && o.inventory);
    }
    const byKey = new Map();
    for (const f of list) { byKey.set(normKey(f.name), f); }
    for (const f of list) for (const a of f.aliases || []) if (!byKey.has(normKey(a))) byKey.set(normKey(a), f);
    _registry = { list, byKey, byName: new Map(list.map(f => [f.name, f])) };
    return _registry;
  }
  /**
   * Resolve a typed or imported fluor name. Handles aliases, punctuation differences and
   * "Name (equivalent)" forms such as "FITC (cFluor B520)" — the outer name is tried first,
   * then the parenthesized one.
   */
  function resolveFluor(input) {
    if (!input) return null;
    const r = registry(), direct = r.byKey.get(normKey(input));
    if (direct) return direct;
    const m = String(input).match(/^(.*?)\s*[(\[](.*?)[)\]]\s*$/);
    if (m) return r.byKey.get(normKey(m[1])) || r.byKey.get(normKey(m[2])) || null;
    return null;
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  /** Closest library names for an unknown fluor (for "did you mean" hints). */
  function suggestFluors(input, n) {
    const k = normKey(String(input).replace(/[(\[].*?[)\]]/g, '')); if (!k) return [];
    const best = new Map();
    for (const [key, f] of registry().byKey) {
      let d = levenshtein(k, key);
      if (key.includes(k) || k.includes(key)) d = Math.min(d, Math.abs(key.length - k.length) * 0.5);
      if (!best.has(f.name) || d < best.get(f.name)) best.set(f.name, d);
    }
    const lim = Math.max(2, Math.ceil(k.length * 0.35));
    return [...best].filter(([, d]) => d <= lim).sort((a, b) => a[1] - b[1]).slice(0, n || 3).map(x => x[0]);
  }
  /** Spread calibration from a Honeychrome Panel Check export (per instrument), else the generic setting. */
  function spreadCalibration() {
    const ov = state.instOverrides[baseInstrument().id] || {};
    if (ov.spreadCal && ov.spreadCal.scale > 0) return Object.assign({ calibrated: true }, ov.spreadCal);
    return { scale: state.settings.spreadScale || 1, calibrated: false };
  }
  function refsForInstrument() { return state.references[baseInstrument().id] || []; }
  const AF_PREFIX = 'AF · ';
  const isAF = name => String(name).startsWith(AF_PREFIX);
  function afForInstrument() { return (state.autofluorescence || {})[baseInstrument().id] || []; }
  function afNames() { const D = dets().length; return afForInstrument().filter(a => a.enabled !== false && a.sig.length === D).map(a => AF_PREFIX + a.name); }

  /* -------------------------------------------------------------- signatures */
  const _sigCache = new Map();
  function invalidate(what) {
    _sigCache.clear(); _analysisCache = null; _registry = null; _hcCache = null;
    if (what === 'instrument' || what === 'all') _detCache = null;
  }
  /** Signature for a fluor on the current instrument: measured reference preferred, else simulated. */
  function signature(name) {
    if (_sigCache.has(name)) return _sigCache.get(name);
    if (isAF(name)) {
      const a = afForInstrument().find(x => AF_PREFIX + x.name === name);
      const out = a ? { sig: Float64Array.from(a.sig), source: 'autofluorescence', peakDet: dets()[argmax(a.sig)].name, bestEx: 1 } : null;
      _sigCache.set(name, out); return out;
    }
    const f = registry().byName.get(name);
    if (!f) return null;
    const D = dets();
    let out = null;
    if (state.useReferences || f.refOnly) {
      const ref = refsForInstrument().find(r => r.enabled !== false && (r.linkedFluor === name || (!r.linkedFluor && r.name === name)));
      if (ref && ref.sig.length === D.length) out = { sig: Float64Array.from(ref.sig), source: 'measured', peakDet: D[argmax(ref.sig)].name, bestEx: 1, refName: ref.name };
    }
    if (!out && f.hcName && (state.settings.useHCLibrary !== false || f.hcOnly)) {
      const hc = hcLibraryCache();
      const s = hc && hc.spectra.get(f.hcName);
      if (s) out = { sig: Float64Array.from(s), source: 'library', peakDet: D[argmax(s)].name, bestEx: 1, libKey: hc.key };
    }
    if (!out && f.ex) {
      const s = E.simulateSignature(f, instrument(), D);
      out = { sig: s.sig, source: 'simulated', peakDet: s.peakDet, bestEx: s.bestEx, rawPeak: s.rawPeak };
    }
    _sigCache.set(name, out);
    return out;
  }
  let _hcCache = null;
  function hcLibraryCache() { if (!_hcCache) _hcCache = hcSpectraFor(baseInstrument(), dets()) || false; return _hcCache || null; }
  /** Measured-library spectrum for a fluor on a given instrument (or null). */
  function librarySignature(name, inst) {
    const hc = hcSpectraFor(inst, E.detectors(inst)); if (!hc) return null;
    const target = libFluorForHC(name) || LIB.get(name);
    for (const [k, sp] of hc.spectra) if (k === name || (target && libFluorForHC(k) === target)) return sp;
    return null;
  }
  function argmax(a) { let k = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[k]) k = i; return k; }

  /* ---------------------------------------------------------------- analysis */
  let _analysisCache = null;
  function panelFluors() {
    const seen = new Set(), out = [];
    for (const r of state.rows) {
      const f = resolveFluor(r.fluor);
      if (f && !seen.has(f.name) && signature(f.name)) { seen.add(f.name); out.push(f.name); }
    }
    return out;
  }
  function analysis() {
    if (_analysisCache) return _analysisCache;
    const fl = panelFluors(), af = fl.length ? afNames() : [];
    const names = fl.concat(af);
    const cols = names.map(n => signature(n).sig);
    const an = E.analyzePanel(cols, { spreadScale: spreadCalibration().scale });
    // complexity index is reported for the fluors alone (as instruments do); with autofluorescence separately
    const ciAll = an.ci;
    if (af.length && fl.length) an.ci = E.complexityIndex(cols.slice(0, fl.length));
    an.ciWithAF = af.length ? ciAll : null;
    if (af.length && an.cos) { // highest similarity among fluors only
      const n = names.length; let mc = null;
      for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) if (!mc || an.cos[i * n + j] > mc.v) mc = { v: an.cos[i * n + j], i, j };
      an.maxCos = mc;
    }
    _analysisCache = { names, cols, an, nFluor: fl.length, afNames: af, idx: new Map(names.map((n, i) => [n, i])) };
    return _analysisCache;
  }

  /** Panel warnings, each {kind:'bad'|'warn'|'info', text, rows?}. */
  function panelWarnings() {
    const out = [], { names, an } = analysis(), n = names.length, S = state.settings;
    const D = dets();
    const counts = new Map();
    state.rows.forEach((r, i) => {
      if (!r.fluor) return;
      const f = resolveFluor(r.fluor);
      if (!f) {
        const sg = suggestFluors(r.fluor, 3);
        out.push({ kind: 'bad', text: `Row ${i + 1}${r.marker ? ' (' + r.marker + ')' : ''}: “${r.fluor}” is not in the library.${sg.length ? ' Closest matches: ' + sg.join(', ') + '.' : ''} Pick a fluor from the list, or add it on the Library tab (dye spectrum CSV or a reference control).`, row: r.id, suggestions: sg });
        return;
      }
      if (!signature(f.name)) { out.push({ kind: 'bad', text: `Row ${i + 1}: ${f.name} has no signature for this instrument.` }); return; }
      counts.set(f.name, (counts.get(f.name) || 0) + 1);
    });
    for (const [k, v] of counts) if (v > 1) out.push({ kind: 'bad', text: `${k} is assigned to ${v} markers. Each fluor can carry only one marker.` });
    if (n > D.length) out.push({ kind: 'bad', text: `${n} fluors but only ${D.length} detectors — the panel cannot be unmixed.` });
    an.warnings.forEach(w => out.push({ kind: 'bad', text: w }));
    if (an.cos) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const v = an.cos[i * n + j];
      if (isAF(names[i]) || isAF(names[j])) {
        const [f, a] = isAF(names[i]) ? [names[j], names[i]] : [names[i], names[j]];
        if (!isAF(f) && v >= S.simCaution) out.push({ kind: 'warn', text: `${f} overlaps autofluorescence (${a.slice(AF_PREFIX.length)}) at ${v.toFixed(3)} similarity. Avoid putting dim markers on it.` });
        continue;
      }
      if (v >= S.simWarn) out.push({ kind: 'bad', text: `${names[i]} and ${names[j]} are ${v.toFixed(3)} similar (≥ ${S.simWarn}). They are very hard to unmix from each other.` });
      else if (v >= S.simCaution) out.push({ kind: 'warn', text: `${names[i]} and ${names[j]} are ${v.toFixed(3)} similar. Keep them on markers that are not co-expressed.` });
    }
    for (const nm of names) {
      if (isAF(nm)) continue;
      const s = signature(nm);
      if (s.source === 'simulated' && s.bestEx < 0.1) out.push({ kind: 'warn', text: `${nm} is poorly excited by this instrument's lasers (best laser excites it at ${(s.bestEx * 100).toFixed(0)}% of maximum).` });
      const f = registry().byName.get(nm);
      if (f && f.source === 'Derived' && s.source === 'simulated') out.push({ kind: 'info', text: `${nm} uses an approximated spectrum (no FPbase record). Import a reference control for accurate results.` });
    }
    return out;
  }

  /* ------------------------------------------------------------- persistence */
  function serialize() {
    const s = JSON.parse(JSON.stringify(state));
    s.savedAt = new Date().toISOString(); s.appVersion = APP_VERSION;
    return JSON.stringify(s, null, 1);
  }
  function load(obj) {
    if (!obj || (obj.app !== APP_ID && !LEGACY_APP_IDS.includes(obj.app))) throw new Error('This file is not a Panelyzer panel.');
    if ((obj.fileVersion || 0) > FILE_VERSION) throw new Error('This file was saved by a newer version of the tool.');
    const d = defaultState();
    state = Object.assign(d, obj, { app: APP_ID });
    state.settings = Object.assign(defaultState().settings, obj.settings || {});
    state.ui = Object.assign(defaultState().ui, obj.ui || {});
    state.rows = (state.rows || []).map(r => Object.assign({ id: uid(), marker: '', fluor: '', expression: 2, priority: 'normal', tags: '', locked: false, notes: '' }, r));
  }
  function markDirty() { dirty = true; updateTitle(); }
  function markClean() { dirty = false; updateTitle(); }
  function updateTitle() { document.title = (dirty ? '• ' : '') + (state.panelName || 'Untitled panel') + ' — Panelyzer'; }

  let afterLoad = () => {};
  function setAfterLoad(fn) { afterLoad = fn; }

  /* ------------------------------------------------------------- row helpers */
  const EXPRESSION = [{ v: 4, label: 'Very high' }, { v: 3, label: 'High' }, { v: 2, label: 'Medium' }, { v: 1, label: 'Low / dim' }];
  const PRIORITY = [{ v: 'critical', label: 'Critical', w: 2 }, { v: 'normal', label: 'Normal', w: 1 }, { v: 'low', label: 'Low', w: 0.5 }];
  const newRow = (o) => Object.assign({ id: uid(), marker: '', fluor: '', expression: 2, priority: 'normal', tags: '', locked: false, notes: '' }, o || {});
  const tagList = s => String(s || '').split(/[,;]+/).map(t => t.trim().toLowerCase()).filter(Boolean);

  /* ------------------------------------------------------------------ dialog */
  function dialog(title, body, buttons) {
    const dlg = h('dialog', { 'aria-label': title });
    const foot = h('div', { class: 'dlg-foot' });
    dlg.append(h('div', { class: 'dlg-head' }, h('h3', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')), h('div', { class: 'dlg-body' }, body), foot);
    (buttons || [{ label: 'Close' }]).forEach(b => foot.appendChild(h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: async () => { const keep = b.onClick ? await b.onClick(dlg) : false; if (keep !== true) dlg.close(); } }, b.label)));
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 50));
    document.body.appendChild(dlg); dlg.showModal();
    return dlg;
  }

  root.SPDApp = {
    E, DATA, C, APP_VERSION, h, $, $$, toast, statusEl, download, toCSV, safeName, uid, fmt, normKey, readFile, pickFiles, dialog,
    LIB, get state() { return state; }, set state(v) { state = v; }, defaultState, pushUndo, undo, redo,
    allInstruments, baseInstrument, instrument, dets, registry, resolveFluor, suggestFluors, autoGains, hcKeyFor, librarySignature, spreadCalibration, AF_PREFIX, isAF, afForInstrument, afNames, refsForInstrument, signature, invalidate, argmax,
    analysis, panelFluors, panelWarnings, serialize, load, markDirty, markClean, updateTitle, isDirty: () => dirty, setAfterLoad,
    EXPRESSION, PRIORITY, newRow, tagList,
  };
})(typeof self !== 'undefined' ? self : this);
