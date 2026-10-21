// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/* SVG charts: detector-signature lines, wavelength spectra, heatmaps. No dependencies. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true; if (t === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  };

  /** Identity color for a fluor from its emission peak (cytometry convention), tuned per theme. */
  function fluorColor(emPeak) {
    const wl = emPeak || 550;
    const stops = [[380, 275], [440, 240], [490, 192], [515, 145], [550, 95], [580, 52], [600, 32], [630, 12], [690, 0], [700, 360], [860, 318]];
    let h = stops[0][1];
    if (wl >= stops[stops.length - 1][0]) h = stops[stops.length - 1][1];
    else for (let i = 1; i < stops.length; i++) if (wl <= stops[i][0]) { const [a, ha] = stops[i - 1], [b, hb] = stops[i]; h = ha + (hb - ha) * (wl - a) / (b - a); break; }
    h = (h + 360) % 360;
    const dark = isDark();
    // yellows/greens need less lightness on light backgrounds
    let l = dark ? 63 : (h > 40 && h < 170 ? 36 : 45);
    if (wl > 700) l = dark ? 66 - (wl - 700) / 12 : 40 - (wl - 700) / 25;
    return `hsl(${h.toFixed(0)} ${wl > 700 ? 55 : 72}% ${l.toFixed(0)}%)`;
  }

  /* ------------------------------------------------------- tooltip */
  let tipEl = null;
  function tip() { if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tooltip hidden'; tipEl.setAttribute('role', 'status'); document.body.appendChild(tipEl); } return tipEl; }
  function showTip(evt, build) {
    const t = tip(); t.replaceChildren(); build(t); t.classList.remove('hidden');
    const pad = 14, r = t.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.add('hidden'); }
  function ttTitle(t, s) { const d = document.createElement('div'); d.className = 'tt-title'; d.textContent = s; t.appendChild(d); }
  function ttRow(t, color, value, label) {
    const r = document.createElement('div'); r.className = 'tt-row';
    if (color) { const k = document.createElement('span'); k.className = 'tt-key'; k.style.borderColor = color; r.appendChild(k); }
    const b = document.createElement('b'); b.textContent = value; r.appendChild(b);
    const s = document.createElement('span'); s.textContent = label; r.appendChild(s);
    t.appendChild(r);
  }

  /* ----------------------------------------- signature (detector) plot */
  /**
   * series: [{name, values (Float64Array over detectors), color, source}]
   * dets: detector list. opts: {height, highlight:Set, onToggle(name)}
   */
  function signaturePlot(container, series, dets, opts) {
    opts = opts || {};
    container.replaceChildren();
    const wrap = document.createElement('div'); wrap.className = 'chart'; container.appendChild(wrap);
    const W = Math.max(640, container.clientWidth || 900), H = opts.height || 340;
    const m = { l: 52, r: 12, t: 26, b: dets.length > 80 ? 34 : 54 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, D = dets.length;
    const x = i => m.l + (D === 1 ? iw / 2 : (i / (D - 1)) * iw), y = v => m.t + ih - v * ih;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'Normalized signatures across detectors' }, wrap);
    // laser bands
    const groups = [];
    dets.forEach((d, i) => { const g = groups[groups.length - 1]; if (!g || g.laser !== d.laser) groups.push({ laser: d.laser, name: d.laserName, a: i, b: i }); else g.b = i; });
    const step = D > 1 ? iw / (D - 1) : iw;
    groups.forEach((g, gi) => {
      if (gi % 2 === 0) svgEl('rect', { class: 'band', x: x(g.a) - step / 2, y: m.t, width: (g.b - g.a + 1) * step, height: ih }, svg);
      const t = svgEl('text', { class: 'laser-label', x: (x(g.a) + x(g.b)) / 2, y: m.t - 9, 'text-anchor': 'middle' }, svg);
      t.textContent = `${g.name} ${g.laser}`;
    });
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      svgEl('line', { class: v === 0 ? 'baseline' : 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
      const t = svgEl('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tabular' }, svg); t.textContent = v.toFixed(2).replace(/0$/, '');
    }
    // x labels
    const every = D > 70 ? 5 : Math.max(1, Math.ceil(12 / (iw / Math.max(1, D))));
    dets.forEach((d, i) => {
      if (D > 70) { const ch = +(d.name.split('-')[1] || i); if (ch % every !== 0 && !(ch === 1)) return; }
      else if (every > 1 && i % every !== 0) return;
      const tx = x(i), ty = H - m.b + 12;
      const t = svgEl('text', { x: tx, y: ty, 'text-anchor': D > 70 ? 'middle' : 'end', transform: D > 70 ? null : `rotate(-60 ${tx} ${ty})`, style: 'font-size:9.5px' }, svg);
      t.textContent = D > 70 ? (d.name.split('-')[1] || d.name) : d.name;
    });
    if (D > 70) { const t = svgEl('text', { x: m.l + iw / 2, y: H - 4, 'text-anchor': 'middle', class: 'axis-label' }, svg); t.textContent = 'Channel number per laser'; }
    // lines
    const hl = opts.highlight || new Set();
    if (hl.size) wrap.classList.add('dimmed');
    const paths = new Map();
    for (const s of series) {
      let d = '';
      for (let i = 0; i < D; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s.values[i]).toFixed(1);
      const p = svgEl('path', { d, class: 'series' + (hl.has(s.name) ? ' hl' : ''), stroke: s.color }, svg);
      paths.set(s.name, p);
    }
    // bring highlighted to front
    for (const n of hl) { const p = paths.get(n); if (p) svg.appendChild(p); }
    const cross = svgEl('line', { class: 'crosshair hidden', y1: m.t, y2: m.t + ih }, svg);
    const hit = svgEl('rect', { x: m.l - step / 2, y: m.t, width: iw + step, height: ih, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(D - 1, Math.round((px - m.l) / (iw / Math.max(1, D - 1)))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.classList.remove('hidden');
      const d = dets[i];
      const vals = series.map(s => ({ s, v: s.values[i] })).filter(o => o.v >= 0.01).sort((a, b) => b.v - a.v);
      const shown = (hl.size ? vals.filter(o => hl.has(o.s.name)) : vals).slice(0, 10);
      showTip(ev, t => {
        ttTitle(t, `${d.name} · ${Math.round(d.lo)}–${Math.round(d.hi)} nm (${d.laser} nm laser)`);
        if (!shown.length) ttRow(t, null, '—', 'no signal ≥ 0.01');
        shown.forEach(o => ttRow(t, o.s.color, o.v.toFixed(2), o.s.name));
        if (!hl.size && vals.length > 10) ttRow(t, null, '+' + (vals.length - 10), 'more');
      });
    });
    hit.addEventListener('pointerleave', () => { cross.classList.add('hidden'); hideTip(); });
    const yl = svgEl('text', { x: 11, y: m.t + ih / 2, transform: `rotate(-90 11 ${m.t + ih / 2})`, 'text-anchor': 'middle', class: 'axis-label' }, svg);
    yl.textContent = 'Normalized intensity';

    // legend
    if (series.length > 1 && opts.legend !== false) {
      const lg = document.createElement('div'); lg.className = 'legend'; wrap.appendChild(lg);
      for (const s of series) {
        const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', hl.has(s.name) ? 'true' : 'false');
        const k = document.createElement('span'); k.className = 'key'; k.style.borderColor = s.color; b.appendChild(k);
        b.appendChild(document.createTextNode(s.name));
        b.title = 'Click to highlight';
        b.addEventListener('mouseenter', () => { wrap.classList.add('dimmed'); paths.get(s.name).classList.add('hl'); svg.appendChild(paths.get(s.name)); });
        b.addEventListener('mouseleave', () => { if (!hl.has(s.name)) paths.get(s.name).classList.remove('hl'); if (!hl.size) wrap.classList.remove('dimmed'); });
        b.addEventListener('click', () => opts.onToggle && opts.onToggle(s.name));
        lg.appendChild(b);
      }
    }
    return svg;
  }

  /* ----------------------------------------------- wavelength spectra */
  /** spectra: [{name, ex, em, color}] on the SPD grid; lasers: [{wl,name}] */
  function spectrumPlot(container, spectra, lasers, opts) {
    opts = opts || {};
    container.replaceChildren();
    const SPD = root.SPD;
    const wrap = document.createElement('div'); wrap.className = 'chart'; container.appendChild(wrap);
    const W = Math.max(420, container.clientWidth || 600), H = opts.height || 220;
    const m = { l: 36, r: 10, t: 18, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x0 = 300, x1 = 900;
    const x = wl => m.l + (wl - x0) / (x1 - x0) * iw, y = v => m.t + ih - v * ih;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Excitation and emission spectra' }, wrap);
    for (let wl = 300; wl <= 900; wl += 100) {
      svgEl('line', { class: 'gridline', x1: x(wl), x2: x(wl), y1: m.t, y2: m.t + ih }, svg);
      const t = svgEl('text', { x: x(wl), y: H - 10, 'text-anchor': 'middle' }, svg); t.textContent = wl;
    }
    svgEl('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);
    (lasers || []).forEach(L => {
      svgEl('line', { x1: x(L.wl), x2: x(L.wl), y1: m.t, y2: m.t + ih, stroke: 'var(--ink-3)', 'stroke-width': 1 }, svg);
      const t = svgEl('text', { x: x(L.wl) + 3, y: m.t + 9 }, svg); t.textContent = L.wl;
    });
    for (const s of spectra) {
      let dEx = '', dEm = '';
      for (let i = 0; i < SPD.GRID_N; i++) {
        const wl = SPD.gridWl(i); if (wl > x1) break;
        dEx += (i ? 'L' : 'M') + x(wl).toFixed(1) + ' ' + y(s.ex[i]).toFixed(1);
        dEm += (i ? 'L' : 'M') + x(wl).toFixed(1) + ' ' + y(s.em[i]).toFixed(1);
      }
      svgEl('path', { d: dEm + `L${x(Math.min(x1, SPD.gridWl(SPD.GRID_N - 1)))} ${y(0)}L${x(x0)} ${y(0)}Z`, fill: s.color, opacity: 0.18 }, svg);
      svgEl('path', { d: dEm, class: 'series', stroke: s.color }, svg);
      svgEl('path', { d: dEx, class: 'series', stroke: s.color, 'stroke-width': 1.5, opacity: 0.75, 'stroke-dasharray': '1 0' }, svg);
    }
    const hit = svgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
    const cross = svgEl('line', { class: 'crosshair hidden', y1: m.t, y2: m.t + ih }, svg);
    hit.addEventListener('pointermove', ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
      const wl = Math.round((x0 + (px - m.l) / iw * (x1 - x0)) / 2) * 2;
      cross.setAttribute('x1', x(wl)); cross.setAttribute('x2', x(wl)); cross.classList.remove('hidden');
      showTip(ev, t => {
        ttTitle(t, wl + ' nm');
        spectra.forEach(s => { ttRow(t, s.color, SPD.at(s.ex, wl).toFixed(2), s.name + ' excitation'); ttRow(t, s.color, SPD.at(s.em, wl).toFixed(2), s.name + ' emission'); });
      });
    });
    hit.addEventListener('pointerleave', () => { cross.classList.add('hidden'); hideTip(); });
    return svg;
  }

  /* -------------------------------------------------------- heatmap */
  const RAMPS = {
    blue: ['#f1f6fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    orange: ['#fdf3ee', '#fbdccd', '#f6b99c', '#ef9469', '#e2703f', '#c55425', '#9a3f19', '#6e2b10'],
  };
  const RAMPS_DARK = {
    blue: ['#1d2229', '#1c3350', '#1c4778', '#1f5ea3', '#2f78cc', '#5598e7', '#86b6ef', '#cde2fb'],
    orange: ['#272019', '#45291a', '#6b331b', '#93401f', '#bd5226', '#e2703f', '#f6a27c', '#fbdccd'],
  };
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rampColor(name, t) {
    const r = (isDark() ? RAMPS_DARK : RAMPS)[name];
    t = Math.max(0, Math.min(1, t)) * (r.length - 1);
    const i = Math.min(r.length - 2, Math.floor(t)), f = t - i;
    const a = hexToRgb(r[i]), b = hexToRgb(r[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
  }
  function rampCss(name) { const r = (isDark() ? RAMPS_DARK : RAMPS)[name]; return `linear-gradient(90deg, ${r.join(',')})`; }
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  /**
   * names: labels; M: Float64Array n*n; opts: {ramp, min, max, format, flag(v,i,j), showValue(v,i,j),
   *   tooltip(i,j,v) -> [title, rows], diagonal: 'show'|'blank', rowAxis, colAxis}
   */
  function heatmap(container, names, M, opts) {
    opts = opts || {};
    container.replaceChildren();
    const wrap = document.createElement('div'); wrap.className = 'chart heat-wrap'; container.appendChild(wrap);
    const n = names.length;
    const cell = Math.max(14, Math.min(30, Math.floor(((container.clientWidth || 900) - 160) / Math.max(1, n))));
    const labW = Math.min(150, 12 + Math.max(...names.map(s => s.length)) * 6.3);
    const m = { l: labW, t: labW, r: 10, b: 10 };
    const W = m.l + n * cell + m.r, H = m.t + n * cell + m.b;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.label || 'Matrix heatmap', style: `width:${W}px;max-width:none` }, wrap);
    const min = opts.min != null ? opts.min : 0, max = opts.max != null ? opts.max : 1;
    const fmt = opts.format || (v => v.toFixed(2));
    names.forEach((s, i) => {
      const t = svgEl('text', { x: m.l - 6, y: m.t + i * cell + cell / 2 + 4, 'text-anchor': 'end' }, svg); t.textContent = s;
      const cx = m.l + i * cell + cell / 2, cy = m.t - 6;
      const t2 = svgEl('text', { x: cx, y: cy, transform: `rotate(-60 ${cx} ${cy})` }, svg); t2.textContent = s;
    });
    if (opts.rowAxis) { const t = svgEl('text', { x: 4, y: 12, class: 'axis-label' }, svg); t.textContent = opts.rowAxis; }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = M[i * n + j];
      if (i === j && opts.diagonal === 'blank') {
        svgEl('rect', { x: m.l + j * cell, y: m.t + i * cell, width: cell, height: cell, fill: 'var(--surface-2)', class: 'cell' }, svg);
        continue;
      }
      const t = (v - min) / ((max - min) || 1);
      const fill = rampColor(opts.ramp || 'blue', t);
      const flagged = opts.flag && opts.flag(v, i, j);
      const r = svgEl('rect', { x: m.l + j * cell, y: m.t + i * cell, width: cell, height: cell, fill, class: 'cell' + (flagged ? ' flag' : ''), tabindex: -1 }, svg);
      r.addEventListener('pointermove', ev => showTip(ev, tt => {
        const [title, rows] = opts.tooltip ? opts.tooltip(i, j, v) : [`${names[i]} × ${names[j]}`, [[fmt(v), '']]];
        ttTitle(tt, title); rows.forEach(rw => ttRow(tt, null, rw[0], rw[1]));
      }));
      r.addEventListener('pointerleave', hideTip);
      if (cell >= 20 && opts.showValue && opts.showValue(v, i, j)) {
        const lum = luminance(fill);
        const tx = svgEl('text', { x: m.l + j * cell + cell / 2, y: m.t + i * cell + cell / 2 + 3.5, 'text-anchor': 'middle', class: 'cell-text', style: `fill:${lum > 0.35 ? '#141413' : '#ffffff'}` }, svg);
        tx.textContent = opts.cellText ? opts.cellText(v) : fmt(v);
      }
    }
    // scale legend
    const sl = document.createElement('div'); sl.className = 'scale-legend';
    const a = document.createElement('span'); a.textContent = fmt(min);
    const bar = document.createElement('span'); bar.className = 'bar'; bar.style.background = rampCss(opts.ramp || 'blue');
    const b = document.createElement('span'); b.textContent = (opts.maxLabel || fmt(max));
    sl.append(a, bar, b);
    if (opts.flagLabel) { const f = document.createElement('span'); f.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid var(--critical);border-radius:2px;vertical-align:-2px"></span> '; f.appendChild(document.createTextNode(opts.flagLabel)); f.style.marginLeft = '14px'; sl.appendChild(f); }
    container.appendChild(sl);
    return svg;
  }

  root.SPDCharts = { signaturePlot, spectrumPlot, heatmap, fluorColor, showTip, hideTip, rampColor };
})(typeof self !== 'undefined' ? self : this);
