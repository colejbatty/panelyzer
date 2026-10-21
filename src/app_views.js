// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/* Views: panel, analysis, optimize, library, instrument, report; imports; wiring. */
(function (root) {
  'use strict';
  const A = root.SPDApp, E = A.E, C = A.C, h = A.h, $ = A.$, $$ = A.$$;
  const S = () => A.state;

  /* ===================================================== shared helpers */
  function colorFor(name) {
    const f = A.registry().byName.get(name);
    if (f && f.emPeak) return C.fluorColor(f.emPeak);
    const s = A.signature(name); if (s) return C.fluorColor(A.dets()[A.argmax(s.sig)].center);
    return 'var(--ink-3)';
  }
  function changed(kind) {
    A.markDirty();
    A.invalidate(kind || 'panel');
    scheduleRender();
  }
  let _rt = null;
  function scheduleRender() { clearTimeout(_rt); _rt = setTimeout(() => renderActive(), 0); }
  function fluorOptions() {
    const dl = $('#fluor-options'); dl.replaceChildren();
    for (const f of A.registry().list.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const sig = A.signature(f.name); if (!sig) continue;
      dl.appendChild(h('option', { value: f.name }));
    }
  }
  function laserOfSig(sig) { return A.dets()[A.argmax(sig)]; }
  function sourceTag(name) {
    const s = A.signature(name), f = A.registry().byName.get(name);
    if (!s || !f) return null;
    if (s.source === 'measured') return h('span', { class: 'src-tag measured', title: 'Using your imported reference: ' + (s.refName || '') }, 'measured');
    if (s.source === 'library') return h('span', { class: 'src-tag measured', title: `Measured spectrum from Honeychrome's ${s.libKey} reference library` }, 'measured · lib');
    if (f.source === 'Derived') return h('span', { class: 'src-tag', title: f.sourceNote }, 'approx.');
    if (f.source === 'Custom') return h('span', { class: 'src-tag', title: f.sourceNote }, 'custom');
    return null;
  }
  function nearest(name) {
    const { names, an, idx } = A.analysis(); const i = idx.get(name);
    if (i == null || !an.cos) return null;
    let best = null; const n = names.length;
    for (let j = 0; j < n; j++) if (j !== i && (!best || an.cos[i * n + j] > best.v)) best = { name: names[j], v: an.cos[i * n + j] };
    return best;
  }
  function simStatus(v) {
    const st = S().settings;
    if (v == null) return null;
    return v >= st.simWarn ? 'bad' : v >= st.simCaution ? 'warn' : 'good';
  }
  function emptyState(title, text, actions) {
    return h('div', { class: 'card empty' }, h('h3', null, title), h('p', null, text), h('div', { class: 'row', style: 'justify-content:center' }, actions || []));
  }

  /* ========================================================= PANEL TAB */
  function renderPanel() {
    const el = $('#tab-panel'); el.replaceChildren();
    el.append(h('div', { class: 'section-head' },
      h('div', { style: 'flex:1' }, h('h2', null, 'Panel'), h('p', null, 'List markers, pick fluors, and describe expression and co-expression. Metrics update as you edit.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => { A.pushUndo(); S().rows.push(A.newRow()); changed(); setTimeout(() => { const ins = $$('#panel-body input.m-marker'); ins[ins.length - 1] && ins[ins.length - 1].focus(); }, 30); } }, '+ Add marker'),
        h('button', { class: 'btn', onclick: importPanelFile, title: 'CSV/TSV with Marker and Fluor columns, e.g. a Cytek Cloud / Full Spectrum Viewer panel export' }, 'Import panel…'),
        h('button', { class: 'btn', onclick: pasteMarkersDialog }, 'Paste list…'),
        h('button', { class: 'btn', onclick: loadExample }, 'Load example'),
        h('button', { class: 'btn ghost danger', onclick: () => { if (!S().rows.length) return; if (!confirm('Remove all rows from this panel?')) return; A.pushUndo(); S().rows = []; changed(); } }, 'Clear')
      )));
    el.append(h('div', { class: 'tiles', id: 'panel-tiles' }));
    if (!S().rows.length) {
      el.append(emptyState('No markers yet', 'Add markers one by one, paste a list from a spreadsheet, or load the example panel to explore the tool.', [
        h('button', { class: 'btn primary', onclick: () => { A.pushUndo(); S().rows.push(A.newRow()); changed(); } }, '+ Add marker'),
        h('button', { class: 'btn', onclick: importPanelFile }, 'Import panel…'),
        h('button', { class: 'btn', onclick: pasteMarkersDialog }, 'Paste list…'),
        h('button', { class: 'btn', onclick: loadExample }, 'Load example')]));
    } else {
      const tbody = h('tbody', { id: 'panel-body' });
      S().rows.forEach((r, i) => tbody.appendChild(panelRow(r, i)));
      el.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data panel-table' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Marker'), h('th', null, 'Fluor'), h('th', { title: 'Expected antigen density' }, 'Expression'),
          h('th', { title: 'How important it is to resolve this marker well' }, 'Priority'),
          h('th', { title: 'Comma-separated cell populations where this marker is positive. Markers sharing a population are treated as co-expressed.' }, 'Populations'),
          h('th', { title: 'Lock this marker→fluor pairing during optimization' }, 'Lock'), h('th', null, 'Peak'), h('th', null, 'Closest fluor'), h('th', null, 'Status'), h('th', null, ''))),
        tbody)));
    }
    el.append(h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', null, 'Checks'), h('ul', { class: 'warnings', id: 'panel-warnings' })));
    refreshPanelComputed();
  }

  function panelRow(r, i) {
    const tr = h('tr', { dataset: { id: r.id } });
    const upd = (k, v, kind) => { A.pushUndo(); r[k] = v; A.markDirty(); A.invalidate(kind); refreshPanelComputed(); updateCounts(); };
    const fluorIn = h('input', { type: 'text', class: 'm-fluor', list: 'fluor-options', value: r.fluor, placeholder: 'Choose fluor', title: r.notes || null, 'aria-label': 'Fluor for row ' + (i + 1), autocomplete: 'off',
      onchange: e => { const f = A.resolveFluor(e.target.value); if (f) e.target.value = f.name; upd('fluor', e.target.value.trim()); } });
    tr.append(
      h('td', { class: 'idx num' }, i + 1),
      h('td', null, h('input', { type: 'text', class: 'm-marker', value: r.marker, placeholder: 'e.g. CD3', 'aria-label': 'Marker for row ' + (i + 1), onchange: e => upd('marker', e.target.value.trim()) })),
      h('td', null, h('div', { class: 'fluor-cell' }, h('span', { class: 'swatch c-swatch' }), fluorIn, h('span', { class: 'c-src' }))),
      h('td', null, h('select', { 'aria-label': 'Expression', onchange: e => upd('expression', +e.target.value) }, A.EXPRESSION.map(o => h('option', { value: o.v, selected: r.expression === o.v }, o.label)))),
      h('td', null, h('select', { 'aria-label': 'Priority', onchange: e => upd('priority', e.target.value) }, A.PRIORITY.map(o => h('option', { value: o.v, selected: r.priority === o.v }, o.label)))),
      h('td', null, h('input', { type: 'text', value: r.tags, placeholder: 'e.g. CD4 T, Treg', 'aria-label': 'Populations', style: 'min-width:120px', onchange: e => upd('tags', e.target.value) })),
      h('td', { style: 'text-align:center' }, h('input', { type: 'checkbox', checked: r.locked, 'aria-label': 'Lock assignment', onchange: e => upd('locked', e.target.checked) })),
      h('td', { class: 'c-peak mono' }),
      h('td', { class: 'c-nn' }),
      h('td', { class: 'c-status' }),
      h('td', { style: 'white-space:nowrap' },
        h('button', { class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', onclick: () => moveRow(i, -1) }, '↑'),
        h('button', { class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', onclick: () => moveRow(i, 1) }, '↓'),
        h('button', { class: 'icon-btn', title: 'Remove row', 'aria-label': 'Remove row', onclick: () => { A.pushUndo(); S().rows.splice(i, 1); changed(); } }, '✕'))
    );
    return tr;
  }
  function moveRow(i, d) { const rows = S().rows, j = i + d; if (j < 0 || j >= rows.length) return; A.pushUndo(); [rows[i], rows[j]] = [rows[j], rows[i]]; changed(); }

  function refreshPanelComputed() {
    const { names, an } = A.analysis();
    const used = new Map();
    S().rows.forEach(r => { const f = A.resolveFluor(r.fluor); if (f) used.set(f.name, (used.get(f.name) || 0) + 1); });
    for (const tr of $$('#panel-body tr')) {
      const r = S().rows.find(x => x.id === tr.dataset.id); if (!r) continue;
      const f = A.resolveFluor(r.fluor), sig = f && A.signature(f.name);
      const fin = $('.m-fluor', tr);
      fin.classList.toggle('invalid', !!r.fluor && !sig);
      $('.c-swatch', tr).style.background = sig ? colorFor(f.name) : 'transparent';
      const src = $('.c-src', tr); src.replaceChildren(); if (sig) { const t = sourceTag(f.name); if (t) src.appendChild(t); }
      $('.c-peak', tr).textContent = sig ? sig.peakDet : '';
      const nn = sig ? nearest(f.name) : null, nnc = $('.c-nn', tr); nnc.replaceChildren();
      if (nn) nnc.append(h('span', { class: 'num' }, nn.v.toFixed(2)), ' ', h('span', { class: 'muted small' }, nn.name));
      const st = $('.c-status', tr); st.replaceChildren();
      if (!r.fluor) st.appendChild(A.statusEl('info', r.marker ? 'No fluor' : 'Empty'));
      else if (!sig) st.appendChild(A.statusEl('bad', f ? 'No signature' : 'Unknown fluor'));
      else if (used.get(f.name) > 1) st.appendChild(A.statusEl('bad', 'Duplicate'));
      else if (nn && simStatus(nn.v) === 'bad') st.appendChild(A.statusEl('bad', 'Too similar'));
      else if (nn && simStatus(nn.v) === 'warn') st.appendChild(A.statusEl('warn', 'Similar'));
      else if (sig.source === 'simulated' && sig.bestEx < 0.1) st.appendChild(A.statusEl('warn', 'Weak excitation'));
      else st.appendChild(A.statusEl('good', 'OK'));
    }
    // tiles
    const tiles = $('#panel-tiles');
    if (tiles) {
      tiles.replaceChildren();
      const n = names.length, D = A.dets().length, nF = A.analysis().nFluor, afN = A.analysis().afNames.length;
      const tile = (label, value, detail, status) => h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value num' }, value), detail ? h('div', { class: 'detail', title: typeof detail === 'string' ? detail : '' }, detail) : null, status || null);
      tiles.append(tile('Fluors in panel', String(nF), `${S().rows.filter(r => r.marker).length} markers · ${D} detectors${afN ? ` · ${afN} autofluorescence` : ''}`));
      const ci = an.ci;
      tiles.append(tile('Complexity index', ci == null ? '—' : isFinite(ci) ? ci.toFixed(2) : '∞', ci == null ? 'Add fluors to compute' : an.ciWithAF != null ? `With autofluorescence: ${isFinite(an.ciWithAF) ? an.ciWithAF.toFixed(2) : '∞'}` : isFinite(ci) ? 'Condition number of the signature matrix — lower unmixes more cleanly' : 'Signature matrix is singular'));
      if (an.maxCos) {
        const v = an.maxCos.v, k = simStatus(v);
        tiles.append(tile('Highest similarity', v.toFixed(3), `${names[an.maxCos.i]} · ${names[an.maxCos.j]}`, A.statusEl(k, k === 'bad' ? 'Above limit' : k === 'warn' ? 'Caution' : 'Within limit')));
      } else tiles.append(tile('Highest similarity', '—', 'Needs two or more fluors'));
      if (an.SS) {
        let best = { v: -1 }; for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (j !== k && an.SS[j * n + k] > best.v) best = { v: an.SS[j * n + k], j, k };
        tiles.append(tile('Largest spread (est.)', best.v.toFixed(2), `${names[best.j]} → ${names[best.k]}`));
      } else tiles.append(tile('Largest spread (est.)', '—', 'Needs an unmixable panel'));
    }
    const wl = $('#panel-warnings');
    if (wl) {
      wl.replaceChildren();
      const ws = A.panelWarnings();
      if (!ws.length) wl.appendChild(h('li', null, A.statusEl('good', 'No issues found'), h('span', { class: 'muted' }, S().rows.length ? 'Similarity, duplicates, excitation and unmixability all pass.' : 'Add markers to run checks.')));
      const order = { bad: 0, warn: 1, info: 2 };
      ws.sort((a, b) => order[a.kind] - order[b.kind]).forEach(w => wl.appendChild(h('li', null, A.statusEl(w.kind, w.kind === 'bad' ? 'Problem' : w.kind === 'warn' ? 'Caution' : 'Note'), h('span', null, w.text))));
    }
  }

  function pasteMarkersDialog() {
    const ta = h('textarea', { rows: 12, placeholder: 'CD3\tBUV395\thigh\tT cells\nCD4, BUV496\nCD8' });
    const replace = h('input', { type: 'checkbox' });
    A.dialog('Paste markers', h('div', null,
      h('p', { class: 'muted', style: 'margin-top:0' }, 'One marker per line. Optional columns (tab or comma separated): fluor, expression (very high / high / medium / low), populations. Copying straight from Excel works.'),
      ta, h('label', { class: 'check', style: 'margin-top:8px' }, replace, 'Replace existing rows')), [
      { label: 'Cancel' },
      { label: 'Add rows', primary: true, onClick: () => {
        const lines = ta.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return true;
        const table = parsePanelTable(ta.value);
        if (table && table.rows.length) { setTimeout(() => reviewPanelImport(table, replace.checked), 60); return; }
        A.pushUndo();
        const rows = lines.map(l => {
          const p = l.split(/\t|,(?![^()]*\))/).map(s => s.trim());
          const expr = (p[2] || '').toLowerCase();
          const ev = /very/.test(expr) ? 4 : /high|bright/.test(expr) ? 3 : /low|dim/.test(expr) ? 1 : 2;
          const f = p[1] ? A.resolveFluor(p[1]) : null;
          return A.newRow({ marker: p[0], fluor: f ? f.name : (p[1] || ''), expression: ev, tags: p.slice(3).join(', '), notes: f && f.name !== p[1] ? `Listed as “${p[1]}”` : '' });
        });
        if (replace.checked) S().rows = rows; else S().rows.push(...rows);
        changed(); A.toast(`Added ${rows.length} rows`);
      } }]);
    setTimeout(() => ta.focus(), 50);
  }

  /* ------------------------------------------------ panel table import */
  const COLS = {
    marker: /^(marker|antigen|target|specificity|antibody|protein)s?$/i,
    fluor: /^(fluorescent tag|fluor|fluorochrome|fluorophore|dye|conjugate|label|tag|format|colou?r|reporter)s?$/i,
    density: /antigen density|^expression|density|abundance/i,
    cls: /classification|antigen class/i,
    pops: /population|cell type|subset|^tags$/i,
    prio: /priority|importance/i,
    lock: /^lock/i, clone: /^clone$/i, supplier: /supplier|vendor|manufacturer/i, cat: /catalog|cat\.?\s*#|cat\.? no/i,
  };
  function densityValue(s) {
    s = String(s || '').toLowerCase();
    if (/very\s*high|very\s*bright|\+\+\+/.test(s)) return 4;
    if (/high|bright/.test(s)) return 3;
    if (/low|dim/.test(s)) return 1;
    const n = parseFloat(s); if (n >= 1 && n <= 4) return Math.round(n);
    return 2; // intermediate / medium / unknown
  }
  /** Parse a panel table (Cytek Cloud / Full Spectrum Viewer export, this tool's CSV, or any sheet with Marker + Fluor columns). */
  function parsePanelTable(text) {
    const rows = E.parseDelimited(text);
    const meta = {};
    let hi = -1, map = null;
    for (let r = 0; r < Math.min(rows.length, 80); r++) {
      const cells = rows[r].map(c => c.trim());
      if (/^name$/i.test(cells[0]) && cells[1] && hi < 0) meta.name = cells[1];
      const ci = cells.findIndex(c => /^configuration$/i.test(c)); if (ci >= 0 && cells[ci + 1]) meta.config = cells[ci + 1];
      const mi = cells.findIndex(c => COLS.marker.test(c)), fi = cells.findIndex(c => COLS.fluor.test(c));
      if (mi >= 0 && fi >= 0 && mi !== fi) {
        hi = r; map = { marker: mi, fluor: fi };
        for (const k of ['density', 'cls', 'pops', 'prio', 'lock', 'clone', 'supplier', 'cat']) { const j = cells.findIndex((c, idx) => idx !== mi && idx !== fi && COLS[k].test(c)); if (j >= 0) map[k] = j; }
        break;
      }
    }
    if (hi < 0) return null;
    const out = [];
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r], get = k => map[k] != null ? String(row[map[k]] || '').trim() : '';
      const nonEmpty = row.filter(c => String(c).trim()).length;
      if (!nonEmpty) { if (out.length) break; continue; }
      if (nonEmpty === 1 && row.length <= 2 && out.length) break; // next section title
      const marker = get('marker'), fluor = get('fluor');
      if (!marker && !fluor) continue;
      const cls = get('cls').toLowerCase(), prio = get('prio').toLowerCase();
      const priority = /crit|high|tertiary/.test(prio || cls) ? 'critical' : /low/.test(prio) ? 'low' : 'normal';
      const notes = [get('clone') && 'Clone ' + get('clone'), get('supplier'), get('cat') && '#' + get('cat')].filter(Boolean).join(' · ');
      out.push({ marker, fluorText: fluor, expression: densityValue(get('density')), priority, tags: get('pops'), locked: /^(y|yes|true|1|x)$/i.test(get('lock')), notes });
    }
    let instrumentId = null;
    if (meta.config) {
      if (/id\s*7000/i.test(meta.config)) instrumentId = /320|808|7.?l/i.test(meta.config) ? 'id7000-7l' : 'id7000-5l';
      else if (/5\s*l|uv\s*\/\s*v\s*\/\s*b\s*\/\s*yg\s*\/\s*r/i.test(meta.config)) instrumentId = 'aurora-5l';
    }
    return { rows: out, meta, instrumentId };
  }
  async function importPanelFile() {
    const files = await A.pickFiles('.csv,.tsv,.txt', false); if (!files.length) return;
    let table;
    try { table = parsePanelTable(await A.readFile(files[0])); } catch (e) { return A.toast(e.message, true); }
    if (!table || !table.rows.length) return A.toast('No table with “Marker” and “Fluor” (or “Fluorescent Tag”) columns found in ' + files[0].name, true);
    reviewPanelImport(table, !S().rows.length);
  }
  function reviewPanelImport(table, replaceDefault) {
    const items = table.rows.map(r => {
      const f = A.resolveFluor(r.fluorText);
      return Object.assign({}, r, { resolved: f ? f.name : null, choice: f ? f.name : (r.fluorText || ''), suggestions: f ? [] : A.suggestFluors(r.fluorText, 4) });
    });
    const unknown = items.filter(it => it.fluorText && !it.resolved);
    const replace = h('input', { type: 'checkbox', checked: replaceDefault });
    const switchInst = table.instrumentId && table.instrumentId !== S().instrumentId ? h('input', { type: 'checkbox', checked: true }) : null;
    const opts = A.registry().list.map(f => f.name).sort();
    const body = h('div', null,
      h('p', { style: 'margin-top:0' }, `${items.length} markers found${table.meta.name ? ' in “' + table.meta.name + '”' : ''}. `,
        h('b', null, `${items.length - unknown.length}`), ' fluors recognized', unknown.length ? [', ', h('b', null, String(unknown.length)), ' not in the library.'] : '.'),
      unknown.length ? h('div', null,
        h('p', { class: 'muted small' }, 'Map each unknown fluor to a library fluor, or keep the name as typed (it will be flagged until you import its spectrum or a reference control).'),
        h('div', { class: 'table-wrap', style: 'max-height:340px' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Marker'), h('th', null, 'Fluor in file'), h('th', null, 'Use'))),
          h('tbody', null, unknown.map(it => h('tr', null, h('td', null, it.marker), h('td', null, it.fluorText),
            h('td', null, h('select', { onchange: e => { it.choice = e.target.value; } },
              h('option', { value: it.fluorText }, 'Keep “' + it.fluorText + '”'),
              it.suggestions.length ? h('optgroup', { label: 'Closest matches' }, it.suggestions.map(s => h('option', { value: s }, s))) : null,
              h('optgroup', { label: 'All fluors' }, opts.map(s => h('option', { value: s }, s)))))))))))
        : null,
      h('div', { class: 'row', style: 'margin-top:12px;gap:18px' }, h('label', { class: 'check' }, replace, 'Replace existing rows'),
        switchInst ? h('label', { class: 'check' }, switchInst, `Switch instrument to ${A.allInstruments().find(i => i.id === table.instrumentId).name} (from “${table.meta.config}”)`) : null));
    A.dialog('Import panel', body, [{ label: 'Cancel' }, { label: 'Import', primary: true, onClick: () => {
      A.pushUndo();
      if (switchInst && switchInst.checked) { S().instrumentId = table.instrumentId; A.invalidate('all'); syncInstrumentSelect(); }
      const rows = items.map(it => {
        const f = A.resolveFluor(it.choice);
        const listed = it.fluorText && f && f.name !== it.fluorText ? `Listed as “${it.fluorText}”` : '';
        return A.newRow({ marker: it.marker, fluor: f ? f.name : it.choice, expression: it.expression, priority: it.priority, tags: it.tags, locked: it.locked, notes: [listed, it.notes].filter(Boolean).join(' · ') });
      });
      if (replace.checked) S().rows = rows; else S().rows.push(...rows);
      if (table.meta.name && (replace.checked || S().panelName === 'Untitled panel')) { S().panelName = table.meta.name; $('#panel-name').value = table.meta.name; }
      changed('all'); setTab('panel');
      const still = rows.filter(r => r.fluor && !A.resolveFluor(r.fluor)).length;
      A.toast(`Imported ${rows.length} markers` + (still ? ` · ${still} fluors still need a spectrum` : ''));
    } }]);
  }

  function loadExample() {
    if (S().rows.length && !confirm('Replace the current rows with the example panel?')) return;
    A.pushUndo();
    const ex = [
      ['Live/Dead', 'Zombie NIR', 4, 'normal', 'all'], ['CD45', 'BUV805', 3, 'low', 'all'], ['CD3', 'BUV395', 3, 'normal', 'CD4 T, CD8 T'],
      ['CD4', 'BUV496', 3, 'normal', 'CD4 T'], ['CD8', 'BV510', 3, 'normal', 'CD8 T'], ['CD45RA', 'BUV737', 3, 'normal', 'CD4 T, CD8 T, B, NK'],
      ['CCR7', 'BV421', 2, 'critical', 'CD4 T, CD8 T'], ['CD27', 'BV785', 2, 'normal', 'CD4 T, CD8 T, B'], ['CD28', 'BV605', 2, 'normal', 'CD4 T, CD8 T'],
      ['PD-1', 'PE', 1, 'critical', 'CD4 T, CD8 T'], ['CD25', 'PE-Cy5', 1, 'critical', 'CD4 T'], ['CD127', 'BV711', 2, 'normal', 'CD4 T, CD8 T'],
      ['HLA-DR', 'BV650', 3, 'normal', 'B, Mono, CD4 T, CD8 T'], ['CD19', 'BUV563', 3, 'normal', 'B'], ['CD56', 'BUV661', 2, 'normal', 'NK'],
      ['CD16', 'BB515', 3, 'normal', 'NK, Mono'], ['CD14', 'BV570', 3, 'normal', 'Mono'], ['CD38', 'APC-Fire 750', 3, 'normal', 'B, CD4 T, CD8 T, NK'],
      ['CXCR5', 'BB700', 1, 'critical', 'CD4 T, B'], ['CD57', 'Spark Blue 550', 3, 'normal', 'CD8 T, NK'], ['TIGIT', 'PE-Cy7', 2, 'normal', 'CD8 T, NK'],
      ['CD161', 'APC', 2, 'normal', 'CD8 T, NK'], ['CD95', 'PE-Cy5.5', 2, 'normal', 'CD4 T, CD8 T'], ['CD39', 'Alexa Fluor 700', 1, 'normal', 'CD4 T'],
    ];
    S().rows = ex.map(([marker, fluor, expression, priority, tags]) => A.newRow({ marker, fluor, expression, priority, tags }));
    if (S().panelName === 'Untitled panel') { S().panelName = 'Example: 24-color human PBMC'; $('#panel-name').value = S().panelName; }
    changed(); A.toast('Example panel loaded');
  }

  /* ====================================================== ANALYSIS TAB */
  function renderAnalysis() {
    const el = $('#tab-analysis'); el.replaceChildren();
    const { names, cols, an } = A.analysis();
    el.append(h('div', { class: 'section-head' }, h('div', null, h('h2', null, 'Analysis'), h('p', null, `${names.length} fluors on ${A.baseInstrument().name}. Signatures are peak-normalized; spread is estimated from a photon-noise model of OLS unmixing.`))));
    if (!names.length) { el.append(emptyState('Nothing to analyze', 'Assign fluors on the Panel tab first.', [h('button', { class: 'btn primary', onclick: () => setTab('panel') }, 'Go to Panel')])); return; }
    const D = A.dets(), n = names.length;
    const hl = new Set(S().ui.highlight.filter(x => names.includes(x)));

    // --- signatures
    const sigCard = h('div', { class: 'card' });
    const chartBox = h('div');
    const viewSeg = segmented([['chart', 'Chart'], ['table', 'Table']], S().ui.sigView || 'chart', v => { S().ui.sigView = v; renderAnalysis(); });
    sigCard.append(h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Signatures'), h('p', { class: 'sub' }, 'Each fluor\'s normalized emission across every detector. Hover for values; click legend chips to highlight.')),
      h('div', { class: 'chart-tools' }, hl.size ? h('button', { class: 'btn sm', onclick: () => { S().ui.highlight = []; renderAnalysis(); } }, 'Clear highlight') : null, viewSeg,
        h('button', { class: 'btn sm', onclick: exportSignaturesCSV }, 'CSV'))), chartBox);
    el.append(sigCard);
    if ((S().ui.sigView || 'chart') === 'chart') {
      requestAnimationFrame(() => C.signaturePlot(chartBox, names.map((nm, i) => ({ name: nm, values: cols[i], color: colorFor(nm) })), D, {
        highlight: hl, height: 360, onToggle: nm => { const s = new Set(S().ui.highlight); s.has(nm) ? s.delete(nm) : s.add(nm); S().ui.highlight = [...s]; renderAnalysis(); } }));
    } else chartBox.append(matrixTable(['Detector', ...names], D.map((d, k) => [d.name, ...cols.map(c => c[k].toFixed(3))])));

    if (!an.W) {
      el.append(h('div', { class: 'card' }, h('ul', { class: 'warnings' }, an.warnings.map(w => h('li', null, A.statusEl('bad', 'Problem'), w)))));
    }
    const grid = h('div', { class: 'grid-2' }); el.append(grid);

    // --- similarity
    const st = S().settings;
    const simCard = h('div', { class: 'card' }), simBox = h('div');
    const simView = S().ui.simView || 'chart';
    simCard.append(h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Similarity matrix'), h('p', { class: 'sub' }, `Cosine similarity of signatures. Outlined cells are ≥ ${st.simWarn}.`)),
      h('div', { class: 'chart-tools' }, segmented([['chart', 'Heatmap'], ['table', 'Table']], simView, v => { S().ui.simView = v; renderAnalysis(); }), h('button', { class: 'btn sm', onclick: () => exportMatrixCSV('similarity', names, an.cos, 3) }, 'CSV'))), simBox);
    grid.append(simCard);
    if (simView === 'chart') requestAnimationFrame(() => C.heatmap(simBox, names, an.cos, { ramp: 'blue', min: 0, max: 1, diagonal: 'blank', flag: v => v >= st.simWarn, flagLabel: '≥ ' + st.simWarn,
      showValue: v => v >= 0.5, cellText: v => v.toFixed(2).replace(/^0/, ''), label: 'Similarity matrix',
      tooltip: (i, j, v) => [`${names[i]} · ${names[j]}`, [[v.toFixed(3), 'cosine similarity']]] }));
    else simBox.append(matrixTable(['', ...names], names.map((nm, i) => [nm, ...names.map((_, j) => an.cos[i * n + j].toFixed(3))])));

    // --- spread
    const ssCard = h('div', { class: 'card' }), ssBox = h('div');
    grid.append(ssCard);
    if (an.SS) {
      const vals = []; for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (j !== k) vals.push(an.SS[j * n + k]);
      vals.sort((a, b) => a - b);
      const vmax = st.spreadMax || Math.max(0.5, E.quantile(vals, 0.98));
      const ssView = S().ui.ssView || 'chart';
      ssCard.append(h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Spillover spreading matrix (estimated)'), h('p', { class: 'sub' }, A.spreadCalibration().calibrated ? `Rows spread into columns. Calibrated to measured spread in “${A.spreadCalibration().experiment}” (×${A.spreadCalibration().scale.toPrecision(3)}, log r = ${(A.spreadCalibration().r || 0).toFixed(2)}) — comparable with that instrument's measured SSM.` : 'Rows spread into columns. Values are relative units from a shot-noise model — compare within this panel, or calibrate with the Honeychrome Panel Check plugin.')),
        h('div', { class: 'chart-tools' }, segmented([['chart', 'Heatmap'], ['table', 'Table']], ssView, v => { S().ui.ssView = v; renderAnalysis(); }), h('button', { class: 'btn sm', onclick: () => exportMatrixCSV('spread', names, an.SS, 3, true) }, 'CSV'))), ssBox);
      if (ssView === 'chart') requestAnimationFrame(() => C.heatmap(ssBox, names, an.SS, { ramp: 'orange', min: 0, max: vmax, diagonal: 'blank', maxLabel: '≥ ' + vmax.toFixed(1), format: v => v.toFixed(1),
        showValue: v => v >= vmax * 0.5, cellText: v => v.toFixed(1), rowAxis: 'from ↓  into →', label: 'Spillover spreading matrix',
        tooltip: (i, j, v) => [`${names[i]} → ${names[j]}`, [[v.toFixed(2), 'spread (relative SD per √intensity)']]] }));
      else ssBox.append(matrixTable(['from \\ into', ...names], names.map((nm, j) => [nm, ...names.map((_, k) => j === k ? '' : an.SS[j * n + k].toFixed(3))])));
    } else ssCard.append(h('h3', null, 'Spillover spreading matrix'), h('p', { class: 'muted' }, 'Not available: the panel cannot be unmixed.'));

    // --- per-fluor summary
    if (an.SS) {
      const rows = names.map((nm, k) => {
        let rec = 0, top = []; for (let j = 0; j < n; j++) if (j !== k) { rec += an.SS[j * n + k]; top.push([an.SS[j * n + k], names[j]]); }
        let out = 0; for (let j = 0; j < n; j++) if (j !== k) out += an.SS[k * n + j];
        top.sort((a, b) => b[0] - a[0]);
        const nn = nearest(nm), sg = A.signature(nm), marker = S().rows.find(r => A.resolveFluor(r.fluor) && A.resolveFluor(r.fluor).name === nm);
        return { nm, marker: marker ? marker.marker : '', peak: sg.peakDet, src: sg.source, nn, nu: an.nu[k], rec, out, top: top.slice(0, 3) };
      });
      const maxRec = Math.max(...rows.map(r => r.rec)) || 1;
      el.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Per-fluor unmixing summary'), h('p', { class: 'sub' }, 'Noise amplification ν = √Σ W²: how much detector background each fluor\'s unmixed channel picks up. Received spread is the column sum of the spreading matrix — high values mean dim markers on that fluor will be hard to resolve.')),
        h('div', { class: 'chart-tools' }, h('button', { class: 'btn sm', onclick: exportUnmixingCSV }, 'Unmixing matrix CSV'))),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Fluor'), h('th', null, 'Marker'), h('th', null, 'Peak'), h('th', null, 'Signature'), h('th', null, 'Closest'), h('th', { class: 'num' }, 'ν'), h('th', null, 'Received spread'), h('th', { class: 'num' }, 'Spread out'), h('th', null, 'Main spreaders into it'))),
          h('tbody', null, rows.map(r => h('tr', null,
            h('td', null, h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'swatch', style: { background: colorFor(r.nm) } }), r.nm)),
            h('td', null, r.marker), h('td', { class: 'mono' }, r.peak), h('td', null, r.src === 'measured' ? h('span', { class: 'src-tag measured' }, 'measured') : h('span', { class: 'muted small' }, r.src === 'autofluorescence' ? 'autofluorescence' : 'simulated')),
            h('td', null, r.nn ? [h('span', { class: 'num' }, r.nn.v.toFixed(2)), ' ', h('span', { class: 'muted small' }, r.nn.name)] : ''),
            h('td', { class: 'num' }, r.nu.toFixed(2)),
            h('td', null, h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'bar-inline', style: { width: Math.max(2, 90 * r.rec / maxRec) + 'px', background: 'var(--serious)' } }), h('span', { class: 'num' }, r.rec.toFixed(2)))),
            h('td', { class: 'num' }, r.out.toFixed(2)),
            h('td', { class: 'small' }, r.top.map(t => `${t[1]} (${t[0].toFixed(1)})`).join(', ')))))))));
    }
  }
  function segmented(opts, value, onPick) {
    return h('div', { class: 'seg', role: 'group' }, opts.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': v === value ? 'true' : 'false', onclick: () => onPick(v) }, label)));
  }
  function matrixTable(header, rows) {
    return h('div', { class: 'table-wrap', style: 'max-height:520px' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, header.map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', null, rows.map(r => h('tr', null, r.map((x, i) => h('td', { class: i ? 'num' : '' }, x)))))));
  }

  /* ======================================================= exports */
  function exportMatrixCSV(kind, names, M, d, blankDiag) {
    const n = names.length;
    const rows = [[kind === 'spread' ? 'from \\ into' : '', ...names]];
    names.forEach((nm, i) => rows.push([nm, ...names.map((_, j) => blankDiag && i === j ? '' : M[i * n + j].toFixed(d))]));
    A.download(`${A.safeName(S().panelName)}_${kind}_matrix.csv`, A.toCSV(rows), 'text/csv');
  }
  function exportSignaturesCSV() {
    const { names, cols } = A.analysis(), D = A.dets();
    const rows = [['Fluor', 'Source', ...D.map(d => d.name)]];
    names.forEach((nm, i) => rows.push([nm, A.signature(nm).source, ...[...cols[i]].map(v => v.toFixed(4))]));
    A.download(`${A.safeName(S().panelName)}_signatures.csv`, A.toCSV(rows), 'text/csv');
  }
  function exportUnmixingCSV() {
    const { names, an } = A.analysis(), D = A.dets();
    if (!an.W) return A.toast('Panel cannot be unmixed', true);
    const rows = [['Fluor \\ Detector', ...D.map(d => d.name)]];
    names.forEach((nm, i) => rows.push([nm, ...[...an.W[i]].map(v => v.toFixed(5))]));
    A.download(`${A.safeName(S().panelName)}_unmixing_matrix.csv`, A.toCSV(rows), 'text/csv');
  }
  function exportPanelCSV() {
    const rows = [['Marker', 'Fluor', 'Expression', 'Priority', 'Populations', 'Locked', 'Peak detector', 'Signature source', 'Closest fluor', 'Similarity', 'Notes']];
    for (const r of S().rows) {
      const f = A.resolveFluor(r.fluor), sg = f && A.signature(f.name), nn = sg ? nearest(f.name) : null;
      rows.push([r.marker, f ? f.name : r.fluor, (A.EXPRESSION.find(e => e.v === r.expression) || {}).label, r.priority, r.tags, r.locked ? 'yes' : '', sg ? sg.peakDet : '', sg ? sg.source : '', nn ? nn.name : '', nn ? nn.v.toFixed(3) : '', r.notes || '']);
    }
    A.download(`${A.safeName(S().panelName)}_panel.csv`, A.toCSV(rows), 'text/csv');
  }
  function exportControlsCSV() {
    const rows = [['Marker', 'Fluor', 'Suggested control file name', 'Needs measured reference', 'Reason']];
    for (const r of S().rows) {
      const f = A.resolveFluor(r.fluor); if (!f && !r.fluor) continue;
      const s = f && A.signature(f.name), nm = f ? f.name : r.fluor;
      const need = !s || s.source !== 'measured';
      const reason = !s ? 'not in library' : s.source === 'measured' ? 'already measured' : f.source === 'Derived' ? 'library spectrum is approximated' : 'library spectrum is simulated';
      rows.push([r.marker, nm, `${(r.marker || 'Control').replace(/[\\/:*?"<>|]/g, '-')} ${nm.replace(/[\\/:*?"<>|]/g, '-')} (Cells).fcs`, need ? 'yes' : 'no', reason]);
    }
    rows.push(['', 'Unstained', 'Unstained (Cells).fcs', 'yes', 'negative control and autofluorescence']);
    A.download(`${A.safeName(S().panelName)}_control_checklist.csv`, A.toCSV(rows), 'text/csv');
  }
  function exportLibraryCSV() {
    const D = A.dets(), rows = [['Fluor', 'Group', 'Source', 'Signature', ...D.map(d => d.name)]];
    for (const f of A.registry().list) { const s = A.signature(f.name); if (s) rows.push([f.name, f.group, f.source, s.source, ...[...s.sig].map(v => v.toFixed(4))]); }
    A.download(`library_signatures_${A.baseInstrument().id}.csv`, A.toCSV(rows), 'text/csv');
  }

  /* ====================================================== OPTIMIZE TAB */
  const NON_CONJ = new Set(['Viability', 'DNA dye', 'Tracking / proliferation', 'Fluorescent protein', 'Functional / organelle']);
  function isNonConj(name) { const f = A.registry().byName.get(name); return !!(f && NON_CONJ.has(f.group)); }
  const GROUPS = ['Polymer dye', 'Small molecule', 'Tandem', 'Phycobiliprotein', 'Viability', 'Tracking / proliferation', 'DNA dye', 'Functional / organelle', 'Quantum dot', 'Fluorescent protein', 'Custom', 'Reference only'];
  const DEFAULT_GROUPS = { 'Polymer dye': true, 'Small molecule': true, 'Tandem': true, 'Phycobiliprotein': true, 'Custom': true, 'Reference only': true };
  function optSettings() {
    const u = S().ui;
    u.opt = Object.assign({ target: null, pool: 'all', groups: Object.assign({}, DEFAULT_GROUPS), keepLocked: true, maxCos: 0.98, objective: 'ci', brightness: 0.3, thorough: false, includeApprox: true }, u.opt || {});
    return u.opt;
  }
  let running = null;
  function buildPool(o, required) {
    const out = [], req = new Set(required || []);
    for (const nm of req) if (A.isAF(nm) && A.signature(nm)) out.push({ id: nm, sig: A.signature(nm).sig, brightness: 5 });
    for (const f of A.registry().list) {
      if (req.has(f.name)) { out.push({ id: f.name, sig: A.signature(f.name).sig, brightness: f.brightness }); continue; }
      if (!o.groups[f.group]) continue;
      if (o.pool === 'inventory' && !f.inventory) continue;
      const s = A.signature(f.name); if (!s) continue;
      if (!o.includeApprox && f.source === 'Derived' && s.source === 'simulated') continue;
      if (s.source === 'simulated' && s.bestEx < 0.15) continue;
      out.push({ id: f.name, sig: s.sig, brightness: f.brightness });
    }
    return out;
  }
  /** Fluors that must stay in any suggested set: locked rows (if honored) and non-conjugatable dyes in use. */
  function requiredFluors(o) {
    return [...new Set(S().rows.filter(r => { const f = A.resolveFluor(r.fluor); return f && ((o.keepLocked && r.locked) || isNonConj(f.name)); })
      .map(r => A.resolveFluor(r.fluor)).filter(f => A.signature(f.name)).map(f => f.name))];
  }

  function renderOptimize() {
    const el = $('#tab-optimize'); el.replaceChildren();
    const o = optSettings();
    const markers = S().rows.filter(r => r.marker);
    if (o.target == null) o.target = Math.max(markers.length, A.panelFluors().length) || 20;
    el.append(h('div', { class: 'section-head' }, h('div', null, h('h2', null, 'Optimize'), h('p', null, 'Search for a low-complexity fluor set, then place markers on fluors so bright, co-expressed markers do not spread into dim ones.'))));

    // ---- candidate pool (shared)
    const poolCard = h('div', { class: 'card' });
    const grpBoxes = h('div', { class: 'row', style: 'gap:6px 14px' }, GROUPS.map(g => h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: !!o.groups[g], onchange: e => { o.groups[g] = e.target.checked; updatePoolCount(); } }), g)));
    const poolCount = h('span', { class: 'muted small' });
    function updatePoolCount() { poolCount.textContent = `${buildPool(o).length} candidate fluors`; }
    poolCard.append(h('h3', null, 'Candidate fluors'), h('p', { class: 'sub' }, 'Shared by both tools below. Fluors excited at < 15% by every laser are skipped automatically.'),
      h('div', { class: 'grid-form' },
        h('label', { class: 'field' }, 'Source', h('select', { onchange: e => { o.pool = e.target.value; updatePoolCount(); } }, h('option', { value: 'all', selected: o.pool === 'all' }, 'Whole library'), h('option', { value: 'inventory', selected: o.pool === 'inventory' }, 'Only fluors marked “in stock”'))),
        h('label', { class: 'field' }, 'Similarity limit', h('input', { type: 'number', min: 0.5, max: 0.999, step: 0.01, value: o.maxCos, onchange: e => { o.maxCos = Math.min(0.999, Math.max(0.5, +e.target.value || 0.98)); } }), h('span', { class: 'hint' }, 'No two chosen fluors above this')),
        h('label', { class: 'field' }, 'Approximated spectra', h('select', { onchange: e => { o.includeApprox = e.target.value === 'yes'; updatePoolCount(); } }, h('option', { value: 'yes', selected: o.includeApprox }, 'Include'), h('option', { value: 'no', selected: !o.includeApprox }, 'Exclude'))),
        h('label', { class: 'field' }, 'Locked rows', h('select', { onchange: e => { o.keepLocked = e.target.value === 'yes'; } }, h('option', { value: 'yes', selected: o.keepLocked }, 'Keep their fluors'), h('option', { value: 'no', selected: !o.keepLocked }, 'Ignore locks')))),
      grpBoxes, h('div', { style: 'margin-top:8px' }, poolCount));
    updatePoolCount();
    el.append(poolCard);

    const grid = h('div', { class: 'grid-2' }); el.append(grid);
    // ---- suggest fluors
    const sCard = h('div', { class: 'card' }); grid.append(sCard);
    const sRes = h('div'), sProg = h('div', { class: 'row hidden' }, h('div', { class: 'progress' }, h('div')), h('span', { class: 'muted small prog-text' }), h('button', { class: 'btn sm', onclick: () => { if (running) running.stop = true; } }, 'Stop'));
    sCard.append(h('h3', null, 'Suggest a fluor set'), h('p', { class: 'sub' }, 'Greedy build plus swap refinement. Locked rows are always kept.'),
      h('div', { class: 'grid-form' },
        h('label', { class: 'field' }, 'Number of fluors', h('input', { type: 'number', min: 1, max: A.dets().length, value: o.target, onchange: e => { o.target = Math.max(1, Math.min(A.dets().length, Math.round(+e.target.value || 1))); } })),
        h('label', { class: 'field' }, 'Minimize', h('select', { onchange: e => { o.objective = e.target.value; } }, h('option', { value: 'ci', selected: o.objective === 'ci' }, 'Complexity index'), h('option', { value: 'noise', selected: o.objective === 'noise' }, 'Total unmixing noise (trace)'))),
        h('label', { class: 'field' }, 'Prefer bright fluors', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: o.brightness, oninput: e => { o.brightness = +e.target.value; } }), h('span', { class: 'hint' }, 'Trade a little complexity for brightness')),
        h('label', { class: 'field' }, 'Search', h('select', { onchange: e => { o.thorough = e.target.value === 'thorough'; } }, h('option', { value: 'quick', selected: !o.thorough }, 'Quick (1 start)'), h('option', { value: 'thorough', selected: o.thorough }, 'Thorough (6 starts)')))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: runSuggest }, 'Suggest fluors'), sProg), sRes);

    async function runSuggest() {
      if (running) return;
      const afs = A.afNames(), req = requiredFluors(o).concat(afs), pool = buildPool(o, req);
      if (!pool.length) return A.toast('No candidate fluors — widen the candidate settings.', true);
      running = { stop: false }; sProg.classList.remove('hidden'); sRes.replaceChildren();
      const bar = $('.progress > div', sProg), txt = $('.prog-text', sProg);
      try {
        const r0 = await E.optimizeFluorSet(pool, req, { target: o.target + afs.length, maxCos: o.maxCos, objective: o.objective, brightnessWeight: o.brightness, restarts: o.thorough ? 6 : 1, timeLimitMs: o.thorough ? 60000 : 20000,
          onProgress: p => { if (p.phase === 'build') { bar.style.width = (60 * p.n / p.target) + '%'; txt.textContent = `Building ${p.n}/${p.target}`; } else { bar.style.width = '80%'; txt.textContent = `Refining… best ${p.best.toFixed(3)}`; } },
          shouldStop: () => running.stop });
        const r = Object.assign({}, r0, { ids: r0.ids.filter(id => !A.isAF(id)), reachedTarget: r0.ids.filter(id => !A.isAF(id)).length >= o.target });
        showSuggestResult(r, pool);
      } catch (e) { A.toast(e.message, true); }
      finally { running = null; sProg.classList.add('hidden'); }
    }
    function showSuggestResult(r, pool) {
      const cols = r.ids.map(id => pool.find(p => p.id === id).sig);
      const an = E.analyzePanel(cols);
      const cur = new Set(A.panelFluors()), sug = new Set(r.ids);
      const n = r.ids.length;
      sRes.replaceChildren(h('div', { class: 'result-box' },
        !r.reachedTarget ? h('ul', { class: 'warnings', style: 'margin-bottom:10px' }, h('li', null, A.statusEl('warn', 'Short'), `Only ${n} fluors fit under the ${o.maxCos} similarity limit. Raise the limit or widen the pool.`)) : null,
        h('div', { class: 'tiles' },
          h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Complexity index'), h('div', { class: 'value num' }, fmtCI(an.ci)), h('div', { class: 'detail' }, 'Current panel: ' + fmtCI(A.analysis().an.ci))),
          h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Highest similarity'), h('div', { class: 'value num' }, an.maxCos ? an.maxCos.v.toFixed(3) : '—'), h('div', { class: 'detail' }, an.maxCos ? `${r.ids[an.maxCos.i]} · ${r.ids[an.maxCos.j]}` : ''))),
        h('div', { class: 'pill-list' }, r.ids.map(id => h('span', { class: 'pill' + (cur.size && !cur.has(id) ? ' added' : ''), title: cur.size && !cur.has(id) ? 'Not in current panel' : '' }, h('span', { class: 'swatch', style: { background: colorFor(id) } }), id)),
          [...cur].filter(x => !sug.has(x)).map(id => h('span', { class: 'pill removed', title: 'In current panel, not suggested' }, id))),
        h('p', { class: 'muted small' }, `${r.evals.toLocaleString()} evaluations in ${(r.elapsedMs / 1000).toFixed(1)} s. Green outline = new vs current panel; struck-through = dropped.`),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => applyFluorSet(r.ids) }, markers.length ? 'Apply and assign markers' : 'Apply to panel'),
          h('button', { class: 'btn', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.ids.join('\n')).then(() => A.toast('Copied')); } }, 'Copy list'))));
    }

    // ---- assignment
    const aCard = h('div', { class: 'card' }); grid.append(aCard);
    const aRes = h('div'), aProg = h('div', { class: 'row hidden' }, h('div', { class: 'progress' }, h('div')), h('span', { class: 'muted small prog-text' }), h('button', { class: 'btn sm', onclick: () => { if (running) running.stop = true; } }, 'Stop'));
    const st = S().settings;
    o.assignMode = o.assignMode || 'current';
    aCard.append(h('h3', null, 'Assign markers to fluors'), h('p', { class: 'sub' }, 'Predicts each marker\'s resolution from its expression, fluor brightness, background noise after unmixing, and spread from co-expressed markers, then searches assignments (simulated annealing).'),
      h('div', { class: 'grid-form' },
        h('label', { class: 'field' }, 'Fluors to use', h('select', { onchange: e => { o.assignMode = e.target.value; } }, h('option', { value: 'current', selected: o.assignMode === 'current' }, 'Current panel fluors (reshuffle)'), h('option', { value: 'pool', selected: o.assignMode === 'pool' }, 'Pick from candidate pool'))),
        h('label', { class: 'field' }, 'Background noise', h('input', { type: 'number', min: 0, max: 20, step: 0.5, value: st.background, onchange: e => { st.background = Math.max(0, +e.target.value || 0); A.markDirty(); } }), h('span', { class: 'hint' }, 'Higher favors bright fluors for dim markers')),
        A.afNames().length ? h('label', { class: 'field' }, 'Autofluorescence level', h('select', { onchange: e => { st.afLevel = +e.target.value; A.markDirty(); } }, [['0', 'Ignore'], ['1', 'Low'], ['2', 'Medium'], ['3', 'High'], ['4', 'Very high']].map(([val, l]) => h('option', { value: val, selected: String(st.afLevel) === val }, l))), h('span', { class: 'hint' }, `${A.afNames().length} profile(s) from the Library tab, treated as present on every cell`)) : null,
        h('label', { class: 'field' }, 'Weight of non-co-expressed pairs', h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: st.unrelatedWeight, onchange: e => { st.unrelatedWeight = Math.min(1, Math.max(0, +e.target.value || 0)); A.markDirty(); } }), h('span', { class: 'hint' }, '0 = ignore, 1 = treat all as co-expressed'))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => runAssign() }, 'Optimize assignment'), aProg), aRes);

    function markerModel(rows, fluorNames) {
      return rows.map(r => {
        const f = A.resolveFluor(r.fluor);
        return { name: r.marker, row: r, expression: r.expression, weight: (A.PRIORITY.find(p => p.v === r.priority) || { w: 1 }).w,
          tags: A.tagList(r.tags), lockedFluor: f && (r.locked || isNonConj(f.name)) ? fluorNames.indexOf(f.name) : -1 };
      });
    }
    async function runAssign(fixedSet) {
      if (running) return;
      const rows = S().rows.filter(r => r.marker);
      if (!rows.length) return A.toast('Add marker names on the Panel tab first.', true);
      running = { stop: false }; aProg.classList.remove('hidden'); aRes.replaceChildren();
      const bar = $('.progress > div', aProg), txt = $('.prog-text', aProg);
      try {
        let fluorNames;
        if (fixedSet) fluorNames = fixedSet.slice();
        else if (o.assignMode === 'current') {
          fluorNames = A.panelFluors();
          if (fluorNames.length < rows.length) throw new Error(`The panel has ${fluorNames.length} usable fluors for ${rows.length} markers. Assign more fluors or choose “Pick from candidate pool”.`);
        } else {
          const afs = A.afNames(), req = requiredFluors(o).concat(afs), pool = buildPool(o, req);
          txt.textContent = 'Choosing fluor set…';
          const r = await E.optimizeFluorSet(pool, req, { target: rows.length + afs.length, maxCos: o.maxCos, objective: o.objective, brightnessWeight: o.brightness, restarts: 1, timeLimitMs: 20000, shouldStop: () => running.stop,
            onProgress: p => { bar.style.width = (p.phase === 'build' ? 30 * p.n / p.target : 35) + '%'; } });
          const ids = r.ids.filter(id => !A.isAF(id));
          if (ids.length < rows.length) throw new Error(`Only ${ids.length} fluors fit the similarity limit for ${rows.length} markers.`);
          fluorNames = ids;
        }
        let result = await assignOnSet(rows, fluorNames, bar, txt);
        if (!fixedSet && o.assignMode === 'pool' && !running.stop) result = await refineWithPool(rows, result, bar, txt);
        showAssignResult(rows, result);
      } catch (e) { A.toast(e.message, true); }
      finally { running = null; aProg.classList.add('hidden'); }
    }
    /** Fluor list + autofluorescence components, with AF modelled as locked, zero-weight "markers" present on every cell. */
    function withAF(rows, fluorNames) {
      const afs = st.afLevel > 0 ? A.afNames() : [];
      const all = fluorNames.concat(afs);
      const br = all.map(nm => A.isAF(nm) ? 1 : A.registry().byName.get(nm).brightness);
      const mk = markerModel(rows, all).concat(afs.map((nm, j) => ({ name: nm, isAF: true, expression: st.afLevel, weight: 0, tags: ['all'], lockedFluor: fluorNames.length + j })));
      const reserved = all.map((nm, i) => isNonConj(nm) || A.isAF(nm) ? i : -1).filter(i => i >= 0);
      return { all, br, mk, reserved };
    }
    async function assignOnSet(rows, fluorNames, bar, txt) {
      const wa = withAF(rows, fluorNames);
      const cols = wa.all.map(nm => A.signature(nm).sig);
      const an = E.analyzePanel(cols);
      if (!an.SS) throw new Error('That fluor set cannot be unmixed.');
      const br = wa.br, mk = wa.mk;
      const opts = { background: st.background, unrelatedWeight: st.unrelatedWeight, reserved: wa.reserved };
      const curIdx0 = rows.map(rw => { const f = A.resolveFluor(rw.fluor); return f ? fluorNames.indexOf(f.name) : -1; }).concat(mk.slice(rows.length).map(m => m.lockedFluor));
      const r = await E.optimizeAssignment(mk, an, br, wa.all.length, Object.assign({ initial: curIdx0, shouldStop: () => running && running.stop,
        onProgress: p => { bar.style.width = (40 + 50 * ((p.restart - 1 + p.frac) / p.restarts)) + '%'; txt.textContent = `Annealing ${p.restart}/${p.restarts}`; } }, opts));
      const ev = E.evaluateAssignment(mk, r.assignment, an, br, wa.all.length, opts);
      // baseline: current assignment, when every marker has a fluor in this set
      const curIdx = rows.map(rw => { const f = A.resolveFluor(rw.fluor); return f ? fluorNames.indexOf(f.name) : -1; });
      const curFull = curIdx.concat(mk.slice(rows.length).map(m => m.lockedFluor));
      const base = curIdx.every(x => x >= 0) && new Set(curIdx).size === curIdx.length ? E.evaluateAssignment(mk, curFull, an, br, wa.all.length, opts) : null;
      return { fluorNames, assignment: r.assignment, eval: ev, base, an, br, mk };
    }
    async function refineWithPool(rows, res, bar, txt) {
      const pool = buildPool(o); let { fluorNames, assignment } = res;
      const opts = { background: st.background, unrelatedWeight: st.unrelatedWeight };
      const evalSet = (names, asg) => {
        const wa = withAF(rows, names);
        const cols = wa.all.map(nm => A.signature(nm).sig), W = E.unmixingMatrix(cols);
        if (!W) return null;
        const sp = E.spreadMatrix(cols, W, 1);
        const full = asg.slice(0, rows.length).concat(wa.mk.slice(rows.length).map(m => m.lockedFluor));
        return { cost: E.evaluateAssignment(wa.mk, full, { SS: sp.SS, nu: sp.nu }, wa.br, wa.all.length, opts).cost };
      };
      const C2 = (a, b) => { const x = A.signature(a).sig, y = A.signature(b).sig; return E.dot(x, y) / Math.sqrt(E.dot(x, x) * E.dot(y, y)); };
      let best = evalSet(fluorNames, assignment).cost;
      for (let round = 0; round < 2 && !running.stop; round++) {
        let improved = false;
        for (let m = 0; m < rows.length && !running.stop; m++) {
          const fi = assignment[m];
          if (rows[m].locked || isNonConj(fluorNames[fi])) continue;
          for (const cand of pool) {
            if (fluorNames.includes(cand.id) || isNonConj(cand.id)) continue;
            if (fluorNames.some((nm, k) => k !== fi && C2(nm, cand.id) > o.maxCos)) continue;
            const trial = fluorNames.slice(); trial[fi] = cand.id;
            const r = evalSet(trial, assignment);
            if (r && r.cost < best - 1e-9) { best = r.cost; fluorNames = trial; improved = true; }
          }
          bar.style.width = (90 + 10 * (m / rows.length)) + '%'; txt.textContent = `Swapping in pool fluors (round ${round + 1})`;
          await new Promise(r => setTimeout(r, 0));
        }
        if (!improved) break;
      }
      return assignOnSet(rows, fluorNames, bar, txt);
    }
    function showAssignResult(rows, res) {
      const { fluorNames, assignment, eval: ev, base } = res;
      const maxR = Math.max(...ev.per.slice(0, rows.length).map(p => p.R));
      const tbl = h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Marker'), h('th', null, 'Expression'), h('th', null, 'Current'), h('th', null, 'Suggested'), h('th', null, 'Predicted resolution'), h('th', null, 'Main spread sources'))),
        h('tbody', null, rows.map((rw, i) => {
          const p = ev.per[i], sug = fluorNames[assignment[i]], cur = A.resolveFluor(rw.fluor), changedF = !cur || cur.name !== sug;
          return h('tr', null, h('td', null, rw.marker, rw.locked ? h('span', { class: 'muted small' }, ' (locked)') : cur && isNonConj(cur.name) ? h('span', { class: 'muted small', title: 'Viability, DNA, tracking dyes and fluorescent proteins are not antibody conjugates, so they stay with their marker.' }, ' (dye, fixed)') : null),
            h('td', null, (A.EXPRESSION.find(e => e.v === rw.expression) || {}).label),
            h('td', { class: 'muted' }, cur ? cur.name : (rw.fluor || '—')),
            h('td', null, h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'swatch', style: { background: colorFor(sug) } }), h('span', { style: changedF ? 'font-weight:600' : '' }, sug))),
            h('td', null, h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'bar-inline', style: { width: Math.max(2, 100 * p.R / maxR) + 'px' } }), h('span', { class: 'num small' }, p.R.toFixed(2)))),
            h('td', { class: 'small' }, p.top.map(t => rows[t.marker] ? rows[t.marker].marker : 'autofluorescence').join(', ') || h('span', { class: 'muted' }, 'background only')));
        })));
      const sig = rw => [rw.expression, rw.priority, A.tagList(rw.tags).sort().join(',')].join('|');
      const allSame = rows.length > 1 && rows.every(rw => sig(rw) === sig(rows[0]));
      aRes.replaceChildren(h('div', { class: 'result-box' },
        allSame ? h('ul', { class: 'warnings', style: 'margin-bottom:10px' }, h('li', null, A.statusEl('info', 'Note'), 'Every marker has the same expression, priority and populations, so the model has nothing to trade off. Set them on the Panel tab (e.g. CD138 high, CXCR4 low; populations such as “B, plasma”) and run again.')) : null,
        h('p', null, h('b', null, 'Score: '), h('span', { class: 'num' }, ev.cost.toFixed(3)), base ? [' vs current ', h('span', { class: 'num' }, base.cost.toFixed(3)), ' ', base.cost > ev.cost + 1e-9 ? A.statusEl('good', `${(100 * (1 - ev.cost / base.cost)).toFixed(0)}% better`) : A.statusEl('info', 'No improvement found')] : null,
          h('span', { class: 'muted small' }, ' (lower is better; Σ priority ÷ predicted resolution)')),
        h('div', { class: 'table-wrap' }, tbl),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: () => {
          A.pushUndo(); rows.forEach((rw, i) => { rw.fluor = fluorNames[assignment[i]]; }); changed('panel'); A.toast('Assignment applied'); } }, 'Apply to panel'))));
    }
    function applyFluorSet(ids) {
      const rows = S().rows.filter(r => r.marker);
      if (rows.length && ids.length >= rows.length) { o.assignMode = 'current'; runAssign(ids); A.toast('Assigning markers to the suggested fluors…'); return; }
      A.pushUndo();
      const cur = new Set(A.panelFluors());
      const add = ids.filter(id => !cur.has(id));
      const emptyRows = S().rows.filter(r => !r.fluor);
      add.forEach(id => { const er = emptyRows.shift(); if (er) er.fluor = id; else S().rows.push(A.newRow({ fluor: id })); });
      changed('panel'); A.toast(`Added ${add.length} fluors to the panel`); setTab('panel');
    }
    /* ---------------------------------------------- rank fluors to add to the panel */
    o.add = Object.assign({ marker: '', expression: 2, priority: 'normal', tags: '', show: 25, sort: 'overall', excludeLimit: true }, o.add || {});
    const ad = o.add;
    const xCard = h('div', { class: 'card' }); el.append(xCard);
    const xRes = h('div'), xProg = h('div', { class: 'row hidden' }, h('div', { class: 'progress' }, h('div')), h('span', { class: 'muted small prog-text' }), h('button', { class: 'btn sm', onclick: () => { if (running) running.stop = true; } }, 'Stop'));
    xCard.append(h('h3', null, 'Best fluors to add'), h('p', { class: 'sub' }, 'Ranks every candidate fluor by what happens if it joins the current panel carrying the marker described here: how well that new marker resolves, how much it degrades the markers you already have, and the change in complexity. Your current assignments stay fixed.'),
      h('div', { class: 'grid-form' },
        h('label', { class: 'field' }, 'New marker (optional)', h('input', { type: 'text', value: ad.marker, placeholder: 'e.g. CD86', onchange: e => { ad.marker = e.target.value.trim(); } })),
        h('label', { class: 'field' }, 'Its expression', h('select', { onchange: e => { ad.expression = +e.target.value; } }, A.EXPRESSION.map(x => h('option', { value: x.v, selected: ad.expression === x.v }, x.label)))),
        h('label', { class: 'field' }, 'Priority', h('select', { onchange: e => { ad.priority = e.target.value; } }, A.PRIORITY.map(x => h('option', { value: x.v, selected: ad.priority === x.v }, x.label)))),
        h('label', { class: 'field' }, 'Populations', h('input', { type: 'text', value: ad.tags, placeholder: 'e.g. B, Mono', onchange: e => { ad.tags = e.target.value; } }), h('span', { class: 'hint' }, 'Blank = treat as unrelated to everything')),
        h('label', { class: 'field' }, 'Show', h('select', { onchange: e => { ad.show = +e.target.value; } }, [10, 25, 50, 100].map(nv => h('option', { value: nv, selected: ad.show === nv }, `Top ${nv}`)))),
        h('label', { class: 'field' }, 'Candidates above the similarity limit', h('select', { onchange: e => { ad.excludeLimit = e.target.value === 'hide'; } }, h('option', { value: 'hide', selected: ad.excludeLimit }, 'Hide'), h('option', { value: 'show', selected: !ad.excludeLimit }, 'Show, flagged')))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: runRankAdd }, 'Rank fluors'), h('span', { class: 'muted small' }, 'Uses the candidate settings above.'), xProg), xRes);

    async function runRankAdd() {
      if (running) return;
      const P = A.panelFluors();
      if (!P.length) return A.toast('Assign at least one fluor on the Panel tab first.', true);
      if (P.length + 1 > A.dets().length) return A.toast('The panel already uses as many fluors as there are detectors.', true);
      const rowsM = S().rows.filter(r => r.marker && A.resolveFluor(r.fluor) && P.includes(A.resolveFluor(r.fluor).name));
      const inPanel = new Set(P);
      const pool = buildPool(o, []).filter(c => !inPanel.has(c.id) && !A.isAF(c.id));
      if (!pool.length) return A.toast('No candidate fluors — widen the candidate settings.', true);
      running = { stop: false }; xProg.classList.remove('hidden'); xRes.replaceChildren();
      const bar = $('.progress > div', xProg), txt = $('.prog-text', xProg);
      const opts = { background: st.background, unrelatedWeight: st.unrelatedWeight };
      const newMk = { name: ad.marker || 'New marker', expression: ad.expression, weight: (A.PRIORITY.find(p => p.v === ad.priority) || { w: 1 }).w, tags: A.tagList(ad.tags), lockedFluor: -1 };
      const cosv = (a, b) => E.dot(a, b) / Math.sqrt(E.dot(a, a) * E.dot(b, b));
      // model of a fluor list: fluors + AF, existing markers at their current fluors, optional new marker on the last fluor
      function evaluate(fluorNames, withNew) {
        const wa = withAF(rowsM, fluorNames);
        const cols = wa.all.map(nm => A.signature(nm).sig);
        const W = E.unmixingMatrix(cols); if (!W) return null;
        const sp = E.spreadMatrix(cols, W, 1);
        const mkRows = wa.mk.slice(0, rowsM.length), mkAF = wa.mk.slice(rowsM.length);
        const mk = mkRows.concat(withNew ? [newMk] : [], mkAF);
        const asg = rowsM.map(r => fluorNames.indexOf(A.resolveFluor(r.fluor).name)).concat(withNew ? [fluorNames.length - 1] : [], mkAF.map(m => m.lockedFluor));
        const ev = E.evaluateAssignment(mk, asg, { SS: sp.SS, nu: sp.nu }, wa.br, wa.all.length, opts);
        let existing = 0; for (let i = 0; i < rowsM.length; i++) existing += (mk[i].weight == null ? 1 : mk[i].weight) / ev.per[i].R;
        return { ev, existing, sp, cols, k: wa.all.length, names: wa.all, ci: E.complexityIndex(cols.slice(0, fluorNames.length)) };
      }
      try {
        const base = evaluate(P, false);
        if (!base) throw new Error('The current panel cannot be unmixed.');
        const afs = A.afNames(), afCols = afs.map(nm => A.signature(nm).sig);
        const panelCols = P.map(nm => A.signature(nm).sig);
        const out = [];
        for (let c = 0; c < pool.length; c++) {
          const cand = pool[c];
          let near = { v: -1, name: '' };
          panelCols.forEach((pc, i) => { const v = cosv(pc, cand.sig); if (v > near.v) near = { v, name: P[i] }; });
          const afOv = afCols.length ? Math.max(...afCols.map(a => cosv(a, cand.sig))) : null;
          const overLimit = near.v > o.maxCos;
          if (overLimit && ad.excludeLimit) continue;
          const r = evaluate(P.concat([cand.id]), true);
          if (!r) continue;
          const ni = P.length, n = r.k, iNew = rowsM.length;
          const pn = r.ev.per[iNew];
          let recv = 0, cause = 0; for (let j = 0; j < n; j++) if (j !== ni) { recv += r.sp.SS[j * n + ni]; cause += r.sp.SS[ni * n + j]; }
          const top = pn.top.map(t => t.marker < rowsM.length ? rowsM[t.marker].marker : t.marker === iNew ? '' : 'autofluorescence').filter(Boolean);
          const newCost = newMk.weight > 0 ? newMk.weight / pn.R : 0;
          out.push({ id: cand.id, R: pn.R, newCost, degr: base.existing > 0 ? r.existing / base.existing - 1 : 0, score: newCost + (r.existing - base.existing),
            ci: r.ci, dci: r.ci - (isFinite(base.ci) ? base.ci : 0), near, afOv, recv, cause, top, overLimit, brightness: cand.brightness, sig: A.signature(cand.id) });
          if (c % 6 === 0) { bar.style.width = (100 * c / pool.length) + '%'; txt.textContent = `Evaluating ${c + 1}/${pool.length}`; await new Promise(res => setTimeout(res, 0)); if (running.stop) break; }
        }
        showRankAdd(out, base, P);
      } catch (e) { A.toast(e.message, true); }
      finally { running = null; xProg.classList.add('hidden'); }
    }
    function showRankAdd(out, base, P) {
      const sorters = { overall: (a, b) => a.score - b.score, resolution: (a, b) => b.R - a.R, impact: (a, b) => a.degr - b.degr, complexity: (a, b) => a.ci - b.ci, similarity: (a, b) => a.near.v - b.near.v };
      const draw = () => {
        const list = out.slice().sort(sorters[ad.sort] || sorters.overall).slice(0, ad.show);
        const maxR = Math.max(...out.map(x => x.R)) || 1;
        const stCI = isFinite(base.ci) ? base.ci : null;
        xRes.replaceChildren(h('div', { class: 'result-box' },
          h('div', { class: 'row', style: 'margin-bottom:10px' }, h('span', { class: 'small' }, `${out.length} candidates · current complexity index ${stCI == null ? '∞' : stCI.toFixed(2)} · sort by`),
            segmented([['overall', 'Best overall'], ['resolution', 'New marker resolution'], ['impact', 'Least impact on panel'], ['complexity', 'Lowest complexity'], ['similarity', 'Least similar']], ad.sort, nv => { ad.sort = nv; draw(); })),
          h('div', { class: 'table-wrap', style: 'max-height:640px' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Fluor'), h('th', null, 'Peak'), h('th', { title: 'Predicted resolution of the new marker on this fluor (signal ÷ background and spread)' }, `${ad.marker || 'New marker'} resolution`),
              h('th', { class: 'num', title: 'Change in the summed resolution cost of the markers already in the panel' }, 'Impact on panel'), h('th', { class: 'num' }, 'Complexity'), h('th', null, 'Closest panel fluor'),
              afSel() ? h('th', { class: 'num' }, 'AF overlap') : null, h('th', null, 'Main spread into it'), h('th', null, ''))),
            h('tbody', null, list.map((x, i) => h('tr', null,
              h('td', { class: 'num muted' }, i + 1),
              h('td', null, h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'swatch', style: { background: colorFor(x.id) } }), x.id, sourceTag(x.id))),
              h('td', { class: 'mono' }, x.sig ? x.sig.peakDet : ''),
              h('td', null, h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'bar-inline', style: { width: Math.max(2, 90 * x.R / maxR) + 'px' } }), h('span', { class: 'num small' }, x.R.toFixed(2)))),
              h('td', { class: 'num' }, x.degr > 0.05 ? A.statusEl(x.degr > 0.15 ? 'bad' : 'warn', '+' + (100 * x.degr).toFixed(1) + '%') : h('span', { class: 'small' }, (x.degr >= 0 ? '+' : '') + (100 * x.degr).toFixed(1) + '%')),
              h('td', { class: 'num' }, isFinite(x.ci) ? `${x.ci.toFixed(2)} ` : '∞ ', h('span', { class: 'muted small' }, isFinite(x.dci) ? `(+${x.dci.toFixed(2)})` : '')),
              h('td', null, x.overLimit ? A.statusEl('bad', `${x.near.v.toFixed(2)} ${x.near.name}`) : x.near.v >= S().settings.simCaution ? A.statusEl('warn', `${x.near.v.toFixed(2)} ${x.near.name}`) : [h('span', { class: 'num' }, x.near.v.toFixed(2)), ' ', h('span', { class: 'muted small' }, x.near.name)]),
              afSel() ? h('td', { class: 'num' }, x.afOv == null ? '' : x.afOv.toFixed(2)) : null,
              h('td', { class: 'small' }, x.top.join(', ') || h('span', { class: 'muted' }, 'background only')),
              h('td', null, h('button', { class: 'btn sm', onclick: () => {
                A.pushUndo(); S().rows.push(A.newRow({ marker: ad.marker, fluor: x.id, expression: ad.expression, priority: ad.priority, tags: ad.tags }));
                changed('panel'); A.toast(`${x.id}${ad.marker ? ' for ' + ad.marker : ''} added to panel`);
              } }, 'Add'))))))),
          h('p', { class: 'muted small' }, 'Resolution uses the same model as marker assignment (expression × brightness against unmixing noise, autofluorescence and spread from co-expressed markers). “Impact on panel” is how much worse the existing markers become; overall rank = new marker cost + added cost to existing markers.')));
      };
      const afSel = () => A.afNames().length > 0;
      draw();
    }

    window.__spdRunAssign = runAssign; // for tests
  }
  const fmtCI = v => v == null ? '—' : isFinite(v) ? v.toFixed(2) : '∞';

  /* ======================================================= LIBRARY TAB */
  function renderLibrary() {
    const el = $('#tab-library'); el.replaceChildren();
    const lf = S().ui.libFilter, D = A.dets();
    el.append(h('div', { class: 'section-head' }, h('div', { style: 'flex:1' }, h('h2', null, 'Library'), h('p', null, 'Signatures come from, in order: your measured references → Honeychrome\'s measured reference library for this cytometer → simulation from FPbase spectra (approximations where FPbase has no record).')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: importReferenceCSV }, 'Import references (CSV)'),
        h('button', { class: 'btn', onclick: importFCS }, 'Import single-stain FCS'),
        h('button', { class: 'btn', onclick: importHoneychrome, title: 'Read reference spectra and autofluorescence from a Honeychrome experiment (.kit) or a Panel Check export (.json, adds spread calibration)' }, 'Import Honeychrome…'),
        h('button', { class: 'btn', onclick: importCustomSpectrum }, 'Add dye spectrum'),
        h('button', { class: 'btn ghost', onclick: exportLibraryCSV }, 'Export signatures'))));
    el.append(renderReferencesCard(), renderAFCard());
    const lasers = A.instrument().lasers;
    const listBox = h('div'), preview = h('div', { class: 'card', style: 'position:sticky;top:110px' });
    const countEl = h('span', { class: 'muted small' });
    const filters = h('div', { class: 'row', style: 'margin-bottom:10px' },
      h('input', { type: 'search', placeholder: 'Search fluors…', value: lf.q, 'aria-label': 'Search fluors', style: 'width:220px', oninput: e => { lf.q = e.target.value; drawList(); } }),
      h('select', { 'aria-label': 'Group', onchange: e => { lf.group = e.target.value; drawList(); } }, h('option', { value: '' }, 'All groups'), GROUPS.map(g => h('option', { value: g, selected: lf.group === g }, g))),
      h('select', { 'aria-label': 'Peak laser', onchange: e => { lf.laser = e.target.value; drawList(); } }, h('option', { value: '' }, 'Any peak laser'), lasers.map(L => h('option', { value: L.wl, selected: String(lf.laser) === String(L.wl) }, `${L.name} ${L.wl} nm`))),
      h('select', { 'aria-label': 'Source', onchange: e => { lf.source = e.target.value; drawList(); } }, h('option', { value: '' }, 'Any source'), ['FPbase', 'Derived', 'Honeychrome', 'Custom', 'Reference', 'measured', 'library'].map(s => h('option', { value: s, selected: lf.source === s }, s === 'Derived' ? 'Approximated' : s === 'measured' ? 'Has your measured reference' : s === 'library' ? 'Has measured library spectrum' : s === 'Honeychrome' ? 'Honeychrome library only' : s))),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: lf.inventory, onchange: e => { lf.inventory = e.target.checked; drawList(); } }), 'In stock only'),
      countEl);
    el.append(filters, h('div', { style: 'display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,1fr);gap:16px;align-items:start' }, listBox, preview));
    let selected = S().ui.libSelected || 'BV421';
    function drawList() {
      const q = A.normKey(lf.q);
      const inPanel = new Set(A.panelFluors());
      const items = A.registry().list.filter(f => {
        const s = A.signature(f.name); if (!s) return false;
        if (q && !A.normKey(f.name).includes(q) && !(f.aliases || []).some(a => A.normKey(a).includes(q))) return false;
        if (lf.group && f.group !== lf.group) return false;
        if (lf.laser && String(D[A.argmax(s.sig)].laser) !== String(lf.laser)) return false;
        if (lf.source === 'measured' || lf.source === 'library') { if (s.source !== lf.source) return false; } else if (lf.source && f.source !== lf.source) return false;
        if (lf.inventory && !f.inventory) return false;
        return true;
      }).sort((a, b) => (a.emPeak || 0) - (b.emPeak || 0) || a.name.localeCompare(b.name));
      countEl.textContent = `${items.length} fluors`;
      listBox.replaceChildren(h('div', { class: 'table-wrap', style: 'max-height:680px' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Fluor'), h('th', null, 'Group'), h('th', { class: 'num' }, 'Ex/Em'), h('th', null, 'Peak'), h('th', { title: 'Relative brightness 1–5 (editable)' }, 'Bright.'), h('th', null, 'In stock'), h('th', null, ''))),
        h('tbody', null, items.map(f => {
          const s = A.signature(f.name);
          const tr = h('tr', { style: f.name === selected ? 'outline:2px solid var(--accent);outline-offset:-2px' : '', onclick: e => { if (e.target.closest('input,button,select')) return; selected = f.name; S().ui.libSelected = f.name; drawList(); drawPreview(); } },
            h('td', null, h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'swatch', style: { background: colorFor(f.name) } }), h('span', null, f.name), sourceTag(f.name))),
            h('td', { class: 'small muted' }, f.group),
            h('td', { class: 'num small' }, f.exPeak ? `${f.exPeak}/${f.emPeak}` : '—'),
            h('td', { class: 'mono' }, s.peakDet),
            h('td', null, h('input', { type: 'number', min: 1, max: 5, step: 0.5, value: f.brightness, style: 'width:58px', 'aria-label': 'Brightness of ' + f.name, onchange: e => { setOverride(f.name, 'brightness', Math.min(5, Math.max(0.5, +e.target.value || 3))); } })),
            h('td', { style: 'text-align:center' }, h('input', { type: 'checkbox', checked: f.inventory, 'aria-label': f.name + ' in stock', onchange: e => setOverride(f.name, 'inventory', e.target.checked) })),
            h('td', null, inPanel.has(f.name) ? h('span', { class: 'muted small' }, 'in panel') : h('button', { class: 'btn sm', onclick: () => addToPanel(f.name) }, 'Add')));
          return tr;
        })))));
    }
    function drawPreview() {
      const f = A.registry().byName.get(selected) || A.registry().list[0]; if (!f) return;
      const s = A.signature(f.name);
      const specBox = h('div'), sigBox = h('div');
      const sims = A.registry().list.filter(g => g.name !== f.name && A.signature(g.name)).map(g => { const t = A.signature(g.name).sig; return [E.dot(s.sig, t) / Math.sqrt(E.dot(s.sig, s.sig) * E.dot(t, t)), g.name]; }).sort((a, b) => b[0] - a[0]).slice(0, 8);
      preview.replaceChildren(h('div', null,
        h('div', { class: 'row', style: 'gap:8px' }, h('span', { class: 'swatch', style: { background: colorFor(f.name), width: '16px', height: '16px' } }), h('h3', { style: 'margin:0' }, f.name), sourceTag(f.name)),
        h('p', { class: 'sub', style: 'margin-top:4px' }, `${f.group} · ${f.sourceNote || f.source}${f.aliases && f.aliases.length ? ' · also: ' + f.aliases.slice(0, 4).join(', ') : ''}`),
        f.ex ? h('div', null, h('div', { class: 'small muted' }, 'Excitation (line) and emission (filled), with this instrument\'s lasers'), specBox) : h('p', { class: 'muted' }, 'No spectrum: measured reference only.'),
        h('div', { class: 'small muted', style: 'margin-top:10px' }, `Signature on ${A.baseInstrument().name} (${s.source})`), sigBox,
        h('div', { class: 'small', style: 'margin-top:10px' }, h('b', null, 'Most similar on this instrument'), h('div', { class: 'pill-list', style: 'margin-top:6px' }, sims.map(([v, nm]) => h('span', { class: 'pill', style: 'cursor:pointer', onclick: () => { selected = nm; S().ui.libSelected = nm; drawList(); drawPreview(); } }, h('span', { class: 'swatch', style: { background: colorFor(nm) } }), nm, h('span', { class: 'num muted' }, v.toFixed(2)))))),
        f.source === 'Custom' ? h('button', { class: 'btn sm danger', style: 'margin-top:12px', onclick: () => { if (!confirm('Delete custom fluor ' + f.name + '?')) return; A.pushUndo(); S().customFluors = S().customFluors.filter(c => c.name !== f.name); changed('all'); } }, 'Delete custom fluor') : null));
      requestAnimationFrame(() => {
        if (f.ex) C.spectrumPlot(specBox, [{ name: f.name, ex: f.ex, em: f.em, color: colorFor(f.name) }], lasers, { height: 200 });
        C.signaturePlot(sigBox, [{ name: f.name, values: s.sig, color: colorFor(f.name) }], D, { height: 220, legend: false });
      });
    }
    drawList(); drawPreview();
  }
  function setOverride(name, key, val) {
    const o = S().fluorOverrides[name] = S().fluorOverrides[name] || {};
    o[key] = val; A.markDirty(); A.invalidate('fluor');
  }
  function addToPanel(name) {
    A.pushUndo();
    const empty = S().rows.find(r => !r.fluor);
    if (empty) empty.fluor = name; else S().rows.push(A.newRow({ fluor: name }));
    changed('panel'); A.toast(`${name} added to panel`);
  }

  /* ---------------------------------------------- references & calibration */
  function renderReferencesCard() {
    const refs = A.refsForInstrument(), card = h('div', { class: 'card' });
    card.append(h('div', { class: 'card-head' }, h('div', null, h('h3', null, `Measured references · ${A.baseInstrument().name}`),
      h('p', { class: 'sub' }, refs.length ? 'Linked references replace the simulated signature of that fluor. Unlinked ones appear as their own fluors.' : 'None yet. Import single-stain controls (FCS) or exported signatures (CSV) to use your instrument\'s real spectra.')),
      h('div', { class: 'chart-tools' },
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: S().useReferences, onchange: e => { A.pushUndo(); S().useReferences = e.target.checked; changed('all'); } }), 'Prefer measured over simulated'),
        refs.some(r => r.linkedFluor && A.registry().byName.get(r.linkedFluor) && A.registry().byName.get(r.linkedFluor).ex) ? h('button', { class: 'btn sm', onclick: calibrate }, 'Calibrate detector gains…') : null)));
    if (refs.length) {
      const opts = A.registry().list.filter(f => !f.refOnly).map(f => f.name).sort();
      card.append(h('div', { class: 'table-wrap', style: 'max-height:320px' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Use'), h('th', null, 'Name'), h('th', null, 'Linked library fluor'), h('th', null, 'Origin'), h('th', null, 'Peak'), h('th', { class: 'num' }, 'Fit to simulated'), h('th', null, ''))),
        h('tbody', null, refs.map((r, i) => {
          const lib = r.linkedFluor && A.registry().byName.get(r.linkedFluor);
          let fit = '—';
          if (lib && lib.ex) { const sim = E.simulateSignature(lib, A.instrument(), A.dets()).sig; fit = (E.dot(sim, Float64Array.from(r.sig)) / Math.sqrt(E.dot(sim, sim) * E.dot(r.sig, r.sig))).toFixed(3); }
          return h('tr', null,
            h('td', null, h('input', { type: 'checkbox', checked: r.enabled !== false, 'aria-label': 'Use reference', onchange: e => { A.pushUndo(); r.enabled = e.target.checked; changed('all'); } })),
            h('td', null, h('input', { type: 'text', value: r.name, style: 'min-width:140px', onchange: e => { A.pushUndo(); r.name = e.target.value.trim() || r.name; changed('all'); } })),
            h('td', null, h('select', { onchange: e => { A.pushUndo(); r.linkedFluor = e.target.value || null; changed('all'); } }, h('option', { value: '' }, '— not linked —'), opts.map(nm => h('option', { value: nm, selected: r.linkedFluor === nm }, nm)))),
            h('td', { class: 'small muted' }, r.origin),
            h('td', { class: 'mono' }, A.dets()[A.argmax(r.sig)] ? A.dets()[A.argmax(r.sig)].name : ''),
            h('td', { class: 'num', title: 'Cosine similarity between this reference and the simulated signature of the linked fluor' }, fit),
            h('td', null, h('button', { class: 'icon-btn', 'aria-label': 'Delete reference', onclick: () => { A.pushUndo(); refs.splice(i, 1); changed('all'); } }, '✕')));
        })))));
    }
    return card;
  }
  /* ------------------------------------------------ autofluorescence */
  function renderAFCard() {
    const id = A.baseInstrument().id, list = A.afForInstrument(), card = h('div', { class: 'card' });
    card.append(h('div', { class: 'card-head' }, h('div', null, h('h3', null, `Autofluorescence · ${A.baseInstrument().name}`),
      h('p', { class: 'sub' }, list.length ? 'Enabled profiles are unmixed alongside your fluors: they add to spread and noise, flag fluors that overlap autofluorescence, and steer optimization away from them.' : 'None yet. Cells are not dark — add an autofluorescence profile from an unstained cell sample (FCS), a CSV, or a Honeychrome experiment so predictions reflect your tissue.')),
      h('div', { class: 'chart-tools' }, h('button', { class: 'btn sm', onclick: importAFfromFCS }, 'From unstained FCS'), h('button', { class: 'btn sm', onclick: importAFfromCSV }, 'From CSV'))));
    if (list.length) card.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, 'Use'), h('th', null, 'Name'), h('th', null, 'Origin'), h('th', null, 'Peak'), h('th', null, ''))),
      h('tbody', null, list.map((a, i) => h('tr', null,
        h('td', null, h('input', { type: 'checkbox', checked: a.enabled !== false, 'aria-label': 'Use autofluorescence profile', onchange: e => { A.pushUndo(); a.enabled = e.target.checked; changed('all'); } })),
        h('td', null, h('input', { type: 'text', value: a.name, style: 'min-width:160px', onchange: e => { const nm = e.target.value.trim(); if (!nm) return; A.pushUndo(); a.name = nm; changed('all'); } })),
        h('td', { class: 'small muted' }, a.origin || ''),
        h('td', { class: 'mono' }, A.dets()[A.argmax(a.sig)] ? A.dets()[A.argmax(a.sig)].name : ''),
        h('td', null, h('button', { class: 'icon-btn', 'aria-label': 'Delete profile', onclick: () => { A.pushUndo(); list.splice(i, 1); changed('all'); } }, '✕'))))))));
    return card;
  }
  function addAF(items, instId) {
    const id = instId || A.baseInstrument().id;
    S().autofluorescence = S().autofluorescence || {};
    const list = S().autofluorescence[id] = S().autofluorescence[id] || [];
    for (const it of items) {
      let nm = it.name, k = 2; while (list.some(a => a.name === nm)) nm = `${it.name} (${k++})`;
      list.push({ name: nm, sig: [...it.sig].map(x => +x.toFixed(5)), origin: it.origin, enabled: true });
    }
  }
  async function importAFfromFCS() {
    const files = await A.pickFiles('.fcs', true); if (!files.length) return;
    const add = [];
    for (const f of files) {
      try { const r = E.autofluorescenceFromFCS(E.parseFCS(await A.readFile(f, 'buffer')), A.dets()); add.push({ name: f.name.replace(/\.fcs$/i, '').replace(/^.*Reference Group-\w+\s*/i, ''), sig: r.sig, origin: `FCS: ${f.name} (${r.nEvents} events)` }); }
      catch (e) { A.toast(`${f.name}: ${e.message}`, true); }
    }
    if (add.length) { A.pushUndo(); addAF(add); changed('all'); A.toast(`Added ${add.length} autofluorescence profile(s)`); }
  }
  async function importAFfromCSV() {
    const files = await A.pickFiles('.csv,.tsv,.txt', false); if (!files.length) return;
    try {
      const res = E.parseReferenceTable(await A.readFile(files[0]), A.dets());
      if (!res.signatures.length) throw new Error('No signatures found');
      A.pushUndo(); addAF(res.signatures.map(s => ({ name: s.name, sig: s.sig, origin: 'CSV: ' + files[0].name }))); changed('all'); A.toast(`Added ${res.signatures.length} autofluorescence profile(s)`);
    } catch (e) { A.toast(e.message, true); }
  }

  /* ------------------------------------------------ Honeychrome import */
  async function importHoneychrome() {
    const files = await A.pickFiles('.kit,.json', false); if (!files.length) return;
    let obj;
    try { obj = JSON.parse(await A.readFile(files[0])); } catch (e) { return A.toast('Could not read ' + files[0].name + ': ' + e.message, true); }
    const isPC = obj && obj.app === 'honeychrome-panel-check';
    const parse = (o, D) => isPC ? E.parsePanelCheck(o, D) : E.parseHoneychromeKit(o, D);
    // pick the instrument whose detector names match the experiment best
    let best = null;
    for (const inst of A.allInstruments()) {
      try { const r = parse(obj, E.detectors(inst)); if (!best || r.matched > best.r.matched || (r.matched === best.r.matched && inst.id === S().instrumentId)) best = { inst, r }; }
      catch (e) { return A.toast(e.message, true); }
    }
    const { inst, r } = best;
    if (r.matched < r.nChannels * 0.8) return A.toast(`Only ${r.matched}/${r.nChannels} channels of this ${r.cytometer || 'experiment'} match a known instrument. Add a custom instrument whose detector names match (Instrument tab).`, true);
    const D = E.detectors(inst), expName = isPC ? (r.experiment || files[0].name.replace(/\.json$/i, '')) : files[0].name.replace(/\.kit$/i, '');
    const opts = A.registry().list.filter(f => !f.refOnly).map(f => f.name).sort();
    const items = r.refs.map(ref => {
      const f = A.resolveFluor(ref.label), lib = f && !f.refOnly ? f : null;
      let fit = null, basis = null;
      const libSig = lib ? A.librarySignature(lib.name, inst) : null;
      const cosv = (a, b) => E.dot(a, b) / Math.sqrt(E.dot(a, a) * E.dot(b, b));
      if (libSig) { fit = cosv(libSig, ref.sig); basis = 'measured library'; }
      else if (lib && lib.ex) { fit = cosv(E.simulateSignature(lib, inst, D).sig, ref.sig); basis = 'simulated'; }
      return Object.assign({}, ref, { name: lib ? lib.name : ref.label, link: lib ? lib.name : null, include: true, fit, basis });
    });
    const switchInst = inst.id !== S().instrumentId ? h('input', { type: 'checkbox', checked: true }) : null;
    const addRows = h('input', { type: 'checkbox', checked: !S().rows.length });
    const replaceRows = h('input', { type: 'checkbox', checked: !S().rows.length });
    const fitCell = it => it.fit == null ? h('span', { class: 'muted' }, '—') : h('span', { title: 'vs ' + it.basis + ' spectrum' }, it.fit >= 0.9 ? A.statusEl('good', it.fit.toFixed(2)) : it.fit >= 0.8 || it.basis !== 'measured library' ? A.statusEl('warn', it.fit.toFixed(2) + (it.fit < 0.8 ? ' (vs simulated)' : '')) : A.statusEl('bad', it.fit.toFixed(2) + ' check control'), h('span', { class: 'muted small' }, it.basis === 'measured library' ? ' lib' : ' sim'));
    const qcCell = it => it.maxResidual != null && it.maxResidual > 0.03 ? A.statusEl(it.maxResidual > 0.15 ? 'bad' : 'warn', `${(100 * it.maxResidual).toFixed(0)}% → ${it.residualInto}`) : it.status && it.status !== 'measured' ? h('span', { class: 'muted small' }, it.status) : it.stainIndex ? h('span', { class: 'small' }, 'SI ' + Math.round(it.stainIndex)) : '';
    const sp = r.spread && r.spread.scale > 0 ? r.spread : null;
    const applyCal = sp ? h('input', { type: 'checkbox', checked: true }) : null;
    const body = h('div', null,
      h('p', { style: 'margin-top:0' }, `${r.cytometer || 'Experiment'} · ${r.matched}/${r.nChannels} channels matched to ${inst.name} · ${items.length} reference spectra · ${r.af.length} autofluorescence profile(s) · unmixing ${r.unmixingMethod || 'unknown'}.`),
      h('p', { class: 'muted small' }, '“Agreement” compares each measured spectrum with the library spectrum for that fluor. Low agreement usually means a contaminated or mis-gated control (or a mislabeled file) rather than a library problem — check those controls before trusting them.'),
      h('div', { class: 'table-wrap', style: 'max-height:360px' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Add'), h('th', null, 'Name'), h('th', null, 'Antigen'), h('th', null, 'Control'), h('th', null, 'Peak'), h('th', null, 'Link to library'), h('th', { title: 'Cosine vs the measured library spectrum (lib) or the simulated spectrum (sim)' }, 'Agreement'), r.panelCheck ? h('th', { title: 'Unmixing residual / stain index from Panel Check' }, 'Panel Check') : null)),
        h('tbody', null, items.map(it => h('tr', null,
          h('td', null, h('input', { type: 'checkbox', checked: true, onchange: e => { it.include = e.target.checked; } })),
          h('td', null, h('input', { type: 'text', value: it.name, style: 'min-width:120px', onchange: e => { it.name = e.target.value.trim() || it.name; } })),
          h('td', null, it.antigen), h('td', { class: 'small' }, it.particleType + (it.warning ? ' · ⚠ ' + it.warning : '')),
          h('td', { class: 'mono' }, D[A.argmax(it.sig)].name),
          h('td', null, h('select', { onchange: e => { it.link = e.target.value || null; } }, h('option', { value: '' }, '— not linked —'), opts.map(nm => h('option', { value: nm, selected: it.link === nm }, nm)))),
          h('td', null, fitCell(it)), r.panelCheck ? h('td', null, qcCell(it)) : null))))),
      sp ? h('label', { class: 'check', style: 'margin-top:10px' }, applyCal, `Apply spread calibration: predicted × ${sp.scale.toPrecision(3)} matched measured spread (log r = ${(sp.log_r || 0).toFixed(2)}, ${sp.n_pairs} pairs). The designer's spreading matrix will then be in this instrument's units.`) : null,
      r.af.length ? h('p', null, h('b', null, 'Autofluorescence: '), r.af.map(a => `${a.name}${a.components > 1 ? ` (mean of ${a.components} components)` : ''}`).join(', ')) : h('p', { class: 'muted small' }, 'This experiment has no AutoSpectral autofluorescence profiles. You can add one from an unstained cell FCS on the Library tab.'),
      h('div', { class: 'row', style: 'gap:18px;margin-top:8px' },
        switchInst ? h('label', { class: 'check' }, switchInst, `Switch instrument to ${inst.name}`) : null,
        items.some(it => it.antigen) ? h('label', { class: 'check' }, addRows, `Add ${items.filter(it => it.antigen).length} markers to the panel`) : null,
        items.some(it => it.antigen) ? h('label', { class: 'check' }, replaceRows, 'replacing current rows') : null));
    A.dialog('Import Honeychrome experiment', body, [{ label: 'Cancel' }, { label: 'Import', primary: true, onClick: () => {
      A.pushUndo();
      if (switchInst && switchInst.checked) { S().instrumentId = inst.id; syncInstrumentSelect(); }
      const target = S().instrumentId === inst.id;
      if (!target) { A.toast('References kept for ' + inst.name + '; switch instrument to use them.'); }
      S().references[inst.id] = S().references[inst.id] || [];
      const refs = S().references[inst.id];
      for (const it of items.filter(x => x.include)) {
        const ex = refs.findIndex(x => x.name === it.name); if (ex >= 0) refs.splice(ex, 1);
        refs.push({ name: it.name, sig: [...it.sig].map(x => +x.toFixed(5)), origin: `Honeychrome: ${expName} · ${it.particleType || 'control'}${it.antigen ? ' · ' + it.antigen : ''}`, linkedFluor: it.link, enabled: true, date: new Date().toISOString() });
      }
      if (r.af.length) addAF(r.af.map(a => ({ name: a.name, sig: a.sig, origin: `Honeychrome: ${expName}` })), inst.id);
      if (applyCal && applyCal.checked) { const ov = S().instOverrides[inst.id] = S().instOverrides[inst.id] || {}; ov.spreadCal = { scale: sp.scale, r: sp.log_r, n: sp.n_pairs, experiment: expName, date: new Date().toISOString() }; }
      if (addRows.checked) {
        const rows = items.filter(it => it.include && it.antigen).map(it => A.newRow({ marker: it.antigen, fluor: it.link || it.name, notes: 'From Honeychrome ' + expName }));
        if (replaceRows.checked) S().rows = rows; else S().rows.push(...rows);
      }
      changed('all');
      const bad = items.filter(it => it.include && it.fit != null && it.fit < 0.8 && it.basis === 'measured library').map(it => it.name);
      A.toast(`Imported ${items.filter(x => x.include).length} references` + (r.af.length ? ` and ${r.af.length} autofluorescence profile(s)` : '') + (bad.length ? ` · check: ${bad.join(', ')}` : ''), bad.length > 0);
    } }]);
  }

  function addReferences(list) {
    const id = A.baseInstrument().id;
    const refs = S().references[id] = S().references[id] || [];
    for (const r of list) {
      const existing = refs.findIndex(x => x.name === r.name);
      if (existing >= 0) refs.splice(existing, 1);
      refs.push(r);
    }
  }
  async function importReferenceCSV() {
    const files = await A.pickFiles('.csv,.tsv,.txt', true); if (!files.length) return;
    const found = [];
    for (const file of files) {
      try {
        const res = E.parseReferenceTable(await A.readFile(file), A.dets());
        res.signatures.forEach(s => found.push({ name: s.name, sig: s.sig, origin: `CSV: ${file.name}`, matched: res.matched }));
        if (res.matched < A.dets().length) A.toast(`${file.name}: matched ${res.matched}/${A.dets().length} detectors; missing ones set to 0.`);
      } catch (e) { A.toast(`${file.name}: ${e.message}`, true); }
    }
    if (found.length) reviewReferences(found);
  }
  async function importFCS() {
    const files = await A.pickFiles('.fcs', true); if (!files.length) return;
    const parsed = [];
    for (const f of files) {
      try { parsed.push({ file: f, fcs: E.parseFCS(await A.readFile(f, 'buffer')) }); }
      catch (e) { A.toast(`${f.name}: ${e.message}`, true); }
    }
    if (!parsed.length) return;
    const negSel = h('select', null, h('option', { value: '' }, 'None — use dim events in each file'), parsed.map((p, i) => h('option', { value: i, selected: /unstain|blank|neg/i.test(p.file.name) }, p.file.name)));
    const posFrac = h('input', { type: 'number', min: 0.2, max: 20, step: 0.2, value: 2 });
    A.dialog('Extract signatures from FCS', h('div', null,
      h('p', { class: 'muted', style: 'margin-top:0' }, `${parsed.length} file(s) loaded. Each stained control's signature = median of its brightest events in the peak channel minus the median of negative events, after a broad FSC/SSC gate.`),
      h('div', { class: 'grid-form' }, h('label', { class: 'field' }, 'Unstained / negative control', negSel), h('label', { class: 'field' }, 'Positive gate (top % of events)', posFrac))), [
      { label: 'Cancel' },
      { label: 'Extract', primary: true, onClick: () => {
        const ni = negSel.value === '' ? -1 : +negSel.value, neg = ni >= 0 ? parsed[ni].fcs : null;
        const out = [];
        parsed.forEach((p, i) => {
          if (i === ni) return;
          try {
            const r = E.signatureFromFCS(p.fcs, A.dets(), { negative: neg, posFrac: Math.min(0.2, Math.max(0.002, +posFrac.value / 100)) });
            const fromName = p.file.name.replace(/\.fcs$/i, '').replace(/^.*?(?:Reference Group_|Unmixing.*?_)/i, '').replace(/\s*\(Cells\)|\s*\(Beads\)/i, '').trim();
            out.push({ name: A.resolveFluor(fromName) ? A.resolveFluor(fromName).name : (A.resolveFluor(r.name) ? A.resolveFluor(r.name).name : fromName || r.name), sig: r.sig, origin: `FCS: ${p.file.name} (${r.nPos} pos events, peak ${r.peakDet})` });
          } catch (e) { A.toast(`${p.file.name}: ${e.message}`, true); }
        });
        if (out.length) setTimeout(() => reviewReferences(out), 60);
      } }]);
  }
  function reviewReferences(found) {
    const opts = A.registry().list.filter(f => !f.refOnly).map(f => f.name).sort();
    const rows = found.map(r => {
      const auto = A.resolveFluor(r.name); r.linkedFluor = auto && !auto.refOnly ? auto.name : null; r.include = true; return r;
    });
    const body = h('div', null, h('p', { class: 'muted', style: 'margin-top:0' }, 'Link each reference to a library fluor to replace its simulated signature, or leave it unlinked to add it as a new fluor.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Add'), h('th', null, 'Name'), h('th', null, 'Link to'), h('th', null, 'Peak'), h('th', null, 'Origin'))),
        h('tbody', null, rows.map(r => h('tr', null,
          h('td', null, h('input', { type: 'checkbox', checked: true, onchange: e => { r.include = e.target.checked; } })),
          h('td', null, h('input', { type: 'text', value: r.name, onchange: e => { r.name = e.target.value.trim() || r.name; } })),
          h('td', null, h('select', { onchange: e => { r.linkedFluor = e.target.value || null; } }, h('option', { value: '' }, '— not linked —'), opts.map(nm => h('option', { value: nm, selected: r.linkedFluor === nm }, nm)))),
          h('td', { class: 'mono' }, A.dets()[A.argmax(r.sig)].name), h('td', { class: 'small muted' }, r.origin)))))));
    A.dialog('Review imported references', body, [{ label: 'Cancel' }, { label: 'Add references', primary: true, onClick: () => {
      const add = rows.filter(r => r.include).map(r => ({ name: r.name, sig: [...r.sig].map(v => +v.toFixed(5)), origin: r.origin, linkedFluor: r.linkedFluor, enabled: true, date: new Date().toISOString() }));
      if (!add.length) return;
      A.pushUndo(); addReferences(add); changed('all'); A.toast(`Added ${add.length} references`);
    } }]);
  }
  function calibrate() {
    const instNoG = A.instrument({ noGains: true }), D = E.detectors(instNoG);
    const pairs = A.refsForInstrument().filter(r => r.enabled !== false && r.linkedFluor).map(r => ({ r, f: A.registry().byName.get(r.linkedFluor) })).filter(x => x.f && x.f.ex)
      .map(x => ({ name: x.f.name, base: E.simulateRaw(x.f, instNoG, D), meas: Float64Array.from(x.r.sig) }));
    if (pairs.length < 3) return A.toast('Link at least 3 references (ideally one per laser) to library fluors before calibrating.', true);
    const res = E.calibrateGains(pairs, D);
    const lasersCovered = new Set(); pairs.forEach(p => lasersCovered.add(D[A.argmax(p.meas)].laser));
    A.dialog('Calibrate detector gains', h('div', null,
      h('p', { style: 'margin-top:0' }, `Fitted per-detector gain corrections from ${pairs.length} linked references (${res.observations} detector observations; peaks on ${lasersCovered.size} of ${instNoG.lasers.length} lasers).`),
      h('p', null, 'Mismatch between simulated and measured signatures (RMS, peak-normalized): ', h('b', { class: 'num' }, res.rmsBefore.toFixed(3)), ' → ', h('b', { class: 'num' }, res.rmsAfter.toFixed(3))),
      h('p', { class: 'muted small' }, 'Gains apply to every simulated fluor on this instrument, so fluors you have not measured inherit your instrument\'s detector/laser balance. Detectors with no data borrow the nearest fitted detector on the same laser. Undo or reset any time on the Instrument tab.')), [
      { label: 'Cancel' },
      { label: 'Apply gains', primary: true, onClick: () => {
        A.pushUndo(); const id = A.baseInstrument().id; const ov = S().instOverrides[id] = S().instOverrides[id] || {};
        ov.gains = {}; D.forEach((d, i) => { ov.gains[d.name] = +res.gains[i].toFixed(4); }); changed('instrument'); A.toast('Detector gains applied');
      } }]);
  }
  async function importCustomSpectrum() {
    const files = await A.pickFiles('.csv,.tsv,.txt', false); if (!files.length) return;
    let spec;
    try { spec = E.parseSpectrumTable(await A.readFile(files[0])); } catch (e) { return A.toast(e.message, true); }
    const name = h('input', { type: 'text', value: files[0].name.replace(/\.\w+$/, '') });
    const br = h('input', { type: 'number', min: 1, max: 5, step: 0.5, value: 3 });
    A.dialog('Add dye spectrum', h('div', null, h('p', { class: 'muted', style: 'margin-top:0' }, `Parsed excitation peak ${E.peakWl(spec.ex)} nm and emission peak ${E.peakWl(spec.em)} nm.`),
      h('div', { class: 'grid-form' }, h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Brightness (1–5)', br))), [
      { label: 'Cancel' },
      { label: 'Add', primary: true, onClick: () => {
        const nm = name.value.trim(); if (!nm) { A.toast('Enter a name', true); return true; }
        if (A.registry().byName.has(nm) && !S().customFluors.some(c => c.name === nm)) { A.toast('A library fluor already has that name', true); return true; }
        A.pushUndo(); S().customFluors = S().customFluors.filter(c => c.name !== nm);
        S().customFluors.push({ name: nm, ex: [...spec.ex].map(v => +v.toFixed(4)), em: [...spec.em].map(v => +v.toFixed(4)), brightness: +br.value || 3, note: 'Imported from ' + files[0].name });
        changed('all'); A.toast(nm + ' added');
      } }]);
  }

  /* ====================================================== INSTRUMENT TAB */
  function renderInstrument() {
    const el = $('#tab-instrument'); el.replaceChildren();
    const base = A.baseInstrument(), inst = A.instrument(), D = A.dets(), ov = S().instOverrides[base.id] || {};
    el.append(h('div', { class: 'section-head' }, h('div', { style: 'flex:1' }, h('h2', null, 'Instrument'), h('p', null, base.notes || '')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => editInstrumentJSON(true) }, 'Duplicate as custom…'),
        base.custom ? h('button', { class: 'btn', onclick: () => editInstrumentJSON(false) }, 'Edit JSON…') : null,
        h('button', { class: 'btn', onclick: importInstrumentJSON }, 'Import JSON'),
        h('button', { class: 'btn ghost', onclick: () => A.download(base.id + '.instrument.json', JSON.stringify(inst, null, 1), 'application/json') }, 'Export JSON'),
        base.custom ? h('button', { class: 'btn ghost danger', onclick: () => { if (!confirm('Delete custom instrument ' + base.name + '?')) return; A.pushUndo(); S().customInstruments = S().customInstruments.filter(i => i.id !== base.id); S().instrumentId = 'aurora-5l'; changed('all'); syncInstrumentSelect(); } }, 'Delete') : null)));
    el.append(h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Lasers'), h('div', { class: 'value num' }, inst.lasers.length), h('div', { class: 'detail' }, inst.lasers.map(l => l.wl).join(' · ') + ' nm')),
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Fluorescence detectors'), h('div', { class: 'value num' }, D.length), h('div', { class: 'detail' }, 'Maximum colors that can be unmixed')),
      (() => { const ag = A.autoGains(A.instrument({ noGains: true })), st = S().settings;
        return h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Detector gain calibration'),
          h('div', { class: 'value', style: 'font-size:18px' }, ov.gains ? 'From your references' : ag && st.autoCalibrate !== false ? 'From measured library' : 'None'),
          ov.gains ? h('button', { class: 'btn sm', style: 'margin-top:4px', onclick: () => { A.pushUndo(); delete ov.gains; changed('instrument'); } }, 'Reset to default')
            : ag ? h('label', { class: 'check small', style: 'margin-top:4px' }, h('input', { type: 'checkbox', checked: st.autoCalibrate !== false, onchange: e => { st.autoCalibrate = e.target.checked; changed('instrument'); } }), `Fit to ${ag.n} ${ag.key} library dyes (RMS ${ag.rmsBefore.toFixed(3)}→${ag.rmsAfter.toFixed(3)})`)
            : h('div', { class: 'detail' }, 'Calibrate from references on the Library tab'));
      })(),
      (() => { const key = A.hcKeyFor(A.baseInstrument()), st = S().settings, cal = A.spreadCalibration();
        return h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Measured library & spread units'),
          key ? h('label', { class: 'check small', style: 'margin-top:6px' }, h('input', { type: 'checkbox', checked: st.useHCLibrary !== false, onchange: e => { st.useHCLibrary = e.target.checked; changed('all'); } }), `Use Honeychrome's ${key} measured spectra`) : h('div', { class: 'detail' }, 'No measured library for this instrument'),
          h('div', { class: 'detail', style: 'margin-top:6px' }, cal.calibrated ? `Spread calibrated to ${cal.experiment} (×${cal.scale.toPrecision(3)})` : 'Spread in relative units'),
          cal.calibrated ? h('button', { class: 'btn sm', style: 'margin-top:4px', onclick: () => { A.pushUndo(); delete ov.spreadCal; changed('all'); } }, 'Remove spread calibration') : null);
      })()));
    el.append(h('div', { class: 'card' }, h('h3', null, 'Lasers'), h('p', { class: 'sub' }, 'Signature simulation weights each laser by power × scale. Adjust the scale if your instrument\'s laser balance differs (calibration handles this automatically).'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Laser'), h('th', { class: 'num' }, 'Wavelength'), h('th', { class: 'num' }, 'Power (mW)'), h('th', null, 'Scale'), h('th', { class: 'num' }, 'Detectors'), h('th', null, 'Detection range'))),
        h('tbody', null, inst.lasers.map(L => h('tr', null, h('td', null, L.name), h('td', { class: 'num' }, L.wl + ' nm'), h('td', { class: 'num' }, L.power),
          h('td', null, h('input', { type: 'number', min: 0, max: 10, step: 0.05, value: L.scale, 'aria-label': 'Scale for ' + L.name, onchange: e => { A.pushUndo(); const o = S().instOverrides[base.id] = S().instOverrides[base.id] || {}; o.laserScale = o.laserScale || {}; o.laserScale[L.wl] = Math.max(0, +e.target.value || 0); changed('instrument'); } })),
          h('td', { class: 'num' }, L.detectors.length), h('td', { class: 'mono' }, `${Math.round(Math.min(...L.detectors.map(d => d.lo != null ? d.lo : d.center - d.bw / 2)))}–${Math.round(Math.max(...L.detectors.map(d => d.hi != null ? d.hi : d.center + d.bw / 2)))} nm`))))))));
    el.append(h('details', { class: 'card' }, h('summary', { style: 'cursor:pointer;font-weight:600' }, `Detectors (${D.length})`),
      h('div', { class: 'table-wrap', style: 'margin-top:10px;max-height:520px' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Detector'), h('th', null, 'Laser'), h('th', { class: 'num' }, 'Center'), h('th', { class: 'num' }, 'Range'), h('th', { class: 'num' }, 'Gain correction'))),
        h('tbody', null, D.map(d => h('tr', null, h('td', { class: 'mono' }, d.name), h('td', null, d.laserName + ' ' + d.laser), h('td', { class: 'num' }, d.center.toFixed(1)), h('td', { class: 'num' }, `${d.lo.toFixed(1)}–${d.hi.toFixed(1)}`), h('td', { class: 'num' }, d.gain !== 1 ? d.gain.toFixed(3) : '—'))))))));
  }
  function editInstrumentJSON(asCopy) {
    const base = A.instrument({ noGains: true });
    const cfg = JSON.parse(JSON.stringify(base));
    if (asCopy) { cfg.basedOn = base.basedOn || base.id; cfg.id = 'custom-' + A.uid(); cfg.name = base.name + ' (custom)'; }
    cfg.custom = true; delete cfg.editable;
    const ta = h('textarea', { rows: 22 }); ta.value = JSON.stringify(cfg, null, 1);
    A.dialog(asCopy ? 'New custom instrument' : 'Edit instrument', h('div', null,
      h('p', { class: 'muted', style: 'margin-top:0' }, 'Each laser: name, wl (nm), power, scale, detectors [{name, center, bw} or {name, lo, hi}]. Optional response: [[nm, relative QE], …] at instrument, laser or detector level. Detector names must match your FCS/CSV channel names for imports.'), ta), [
      { label: 'Cancel' },
      { label: 'Save instrument', primary: true, onClick: () => {
        let obj; try { obj = JSON.parse(ta.value); validateInstrument(obj); } catch (e) { A.toast('Invalid instrument: ' + e.message, true); return true; }
        obj.custom = true; A.pushUndo();
        S().customInstruments = S().customInstruments.filter(i => i.id !== obj.id); S().customInstruments.push(obj);
        S().instrumentId = obj.id; changed('all'); syncInstrumentSelect(); A.toast('Instrument saved');
      } }]);
  }
  function validateInstrument(o) {
    if (!o.id || !o.name) throw new Error('id and name are required');
    if (!Array.isArray(o.lasers) || !o.lasers.length) throw new Error('lasers must be a non-empty array');
    const names = new Set();
    for (const L of o.lasers) {
      if (!(L.wl > 200 && L.wl < 1100)) throw new Error('laser wl must be in nm');
      if (!Array.isArray(L.detectors) || !L.detectors.length) throw new Error(`laser ${L.wl} has no detectors`);
      for (const d of L.detectors) {
        if (!d.name) throw new Error('every detector needs a name');
        if (names.has(d.name)) throw new Error('duplicate detector name ' + d.name);
        names.add(d.name);
        if (!((d.center > 0 && d.bw > 0) || (d.lo > 0 && d.hi > d.lo))) throw new Error(`detector ${d.name} needs center+bw or lo+hi`);
        if (d.center == null) { d.center = (d.lo + d.hi) / 2; d.bw = d.hi - d.lo; }
      }
    }
  }
  async function importInstrumentJSON() {
    const files = await A.pickFiles('.json', false); if (!files.length) return;
    try {
      const obj = JSON.parse(await A.readFile(files[0])); validateInstrument(obj);
      if (DATA.INSTRUMENTS.some(i => i.id === obj.id)) obj.id = 'custom-' + A.uid();
      obj.custom = true; A.pushUndo();
      S().customInstruments = S().customInstruments.filter(i => i.id !== obj.id); S().customInstruments.push(obj); S().instrumentId = obj.id;
      changed('all'); syncInstrumentSelect(); A.toast('Imported ' + obj.name);
    } catch (e) { A.toast('Could not import: ' + e.message, true); }
  }
  const DATA = A.DATA;

  /* ========================================================== REPORT */
  function printReport() {
    const rep = $('#report'); rep.replaceChildren();
    const { names, cols, an } = A.analysis(), n = names.length;
    rep.append(h('h1', null, S().panelName), h('p', { class: 'muted' }, `${A.baseInstrument().name} · ${n} fluors · generated ${new Date().toLocaleString()} · Panelyzer ${A.APP_VERSION}`));
    rep.append(h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Complexity index'), h('div', { class: 'value' }, fmtCI(an.ci))),
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Highest similarity'), h('div', { class: 'value' }, an.maxCos ? an.maxCos.v.toFixed(3) : '—'), h('div', { class: 'detail' }, an.maxCos ? `${names[an.maxCos.i]} · ${names[an.maxCos.j]}` : ''))));
    rep.append(h('table', { class: 'data', style: 'margin-bottom:16px' }, h('thead', null, h('tr', null, ['Marker', 'Fluor', 'Expression', 'Priority', 'Populations', 'Peak', 'Closest (similarity)'].map(x => h('th', null, x)))),
      h('tbody', null, S().rows.map(r => { const f = A.resolveFluor(r.fluor), s = f && A.signature(f.name), nn = s ? nearest(f.name) : null; return h('tr', null, h('td', null, r.marker), h('td', null, f ? f.name : r.fluor), h('td', null, (A.EXPRESSION.find(e => e.v === r.expression) || {}).label), h('td', null, r.priority), h('td', null, r.tags), h('td', null, s ? s.peakDet : ''), h('td', null, nn ? `${nn.name} (${nn.v.toFixed(2)})` : '')); }))));
    const ws = A.panelWarnings().filter(w => w.kind !== 'info');
    if (ws.length) rep.append(h('h3', null, 'Checks'), h('ul', null, ws.map(w => h('li', null, w.text))));
    const sigBox = h('div', { style: 'width:1000px' }), simBox = h('div', { style: 'width:1000px' }), ssBox = h('div', { style: 'width:1000px' });
    rep.append(h('h3', null, 'Signatures'), sigBox, h('h3', { style: 'break-before:page' }, 'Similarity matrix'), simBox, an.SS ? h('h3', { style: 'break-before:page' }, 'Estimated spillover spreading matrix') : null, ssBox);
    rep.style.display = 'block'; rep.style.position = 'absolute'; rep.style.left = '-10000px';
    if (n) {
      C.signaturePlot(sigBox, names.map((nm, i) => ({ name: nm, values: cols[i], color: colorFor(nm) })), A.dets(), { height: 360 });
      C.heatmap(simBox, names, an.cos, { ramp: 'blue', min: 0, max: 1, diagonal: 'blank', flag: v => v >= S().settings.simWarn, showValue: v => v >= 0.5, cellText: v => v.toFixed(2).replace(/^0/, '') });
      if (an.SS) { const vals = []; for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (j !== k) vals.push(an.SS[j * n + k]); vals.sort((a, b) => a - b); const vmax = Math.max(0.5, E.quantile(vals, 0.98)); C.heatmap(ssBox, names, an.SS, { ramp: 'orange', min: 0, max: vmax, diagonal: 'blank', format: v => v.toFixed(1), showValue: v => v >= vmax * 0.5, cellText: v => v.toFixed(1) }); }
    }
    rep.style.position = ''; rep.style.left = ''; rep.style.display = '';
    setTimeout(() => window.print(), 80);
  }

  /* ============================================================ wiring */
  const RENDER = { panel: renderPanel, analysis: renderAnalysis, optimize: renderOptimize, library: renderLibrary, instrument: renderInstrument, help: () => {} };
  function setTab(t) {
    S().ui.tab = t;
    $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
    $$('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + t));
    renderActive(); window.scrollTo({ top: 0 });
  }
  function renderActive() {
    fluorOptions(); updateCounts();
    const fn = RENDER[S().ui.tab] || renderPanel;
    try { fn(); } catch (e) { console.error(e); A.toast('Render error: ' + e.message, true); }
  }
  function updateCounts() {
    const n = A.panelFluors().length; const c = $('#count-panel'); if (c) c.textContent = n ? String(n) : '';
    const r = A.refsForInstrument().length; const c2 = $('#count-library'); if (c2) c2.textContent = r ? r + ' ref' : '';
  }
  function syncInstrumentSelect() {
    const sel = $('#instrument'); sel.replaceChildren();
    A.allInstruments().forEach(i => sel.appendChild(h('option', { value: i.id, selected: i.id === S().instrumentId }, i.name)));
  }
  function applyTheme() {
    const t = S().settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    const ic = { auto: '<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor"/>',
      light: '<circle cx="10" cy="10" r="3.6" fill="currentColor"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 1.8v2.2M10 16v2.2M1.8 10h2.2M16 10h2.2M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5"/></g>',
      dark: '<path d="M15.5 12.6A6.6 6.6 0 0 1 7.4 4.5a6.6 6.6 0 1 0 8.1 8.1z" fill="currentColor"/>' };
    $('#theme-btn').innerHTML = `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">${ic[t]}</svg>`;
    $('#theme-btn').title = 'Theme: ' + t;
  }

  /* ---- file handling (File System Access API when available, download fallback) */
  let fileHandle = null;
  async function save(as) {
    const text = A.serialize(), name = A.safeName(S().panelName) + '.panelyzer.json';
    if (window.showSaveFilePicker) {
      try {
        if (!fileHandle || as) fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Panelyzer panel', accept: { 'application/json': ['.json'] } }] });
        const w = await fileHandle.createWritable(); await w.write(text); await w.close();
        A.markClean(); A.toast('Saved ' + fileHandle.name); return;
      } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
    }
    A.download(name, text, 'application/json'); A.markClean(); A.toast('Downloaded ' + name);
  }
  async function open() {
    if (A.isDirty() && !confirm('Discard unsaved changes and open another panel?')) return;
    let text, handle = null;
    if (window.showOpenFilePicker) {
      try { [handle] = await window.showOpenFilePicker({ types: [{ description: 'Panelyzer panel', accept: { 'application/json': ['.json'] } }] }); text = await (await handle.getFile()).text(); }
      catch (e) { if (e.name === 'AbortError') return; handle = null; }
    }
    if (text == null) { const f = await A.pickFiles('.json', false); if (!f.length) return; text = await A.readFile(f[0]); }
    try { A.load(JSON.parse(text)); fileHandle = handle; afterLoad(); A.markClean(); A.toast('Opened ' + S().panelName); }
    catch (e) { A.toast('Could not open: ' + e.message, true); }
  }
  function newPanel() {
    if (A.isDirty() && !confirm('Discard unsaved changes and start a new panel?')) return;
    const keep = { customInstruments: S().customInstruments, instOverrides: S().instOverrides, fluorOverrides: S().fluorOverrides, customFluors: S().customFluors, references: S().references, autofluorescence: S().autofluorescence, settings: S().settings, instrumentId: S().instrumentId };
    A.state = Object.assign(A.defaultState(), keep); fileHandle = null; afterLoad(); A.markClean();
    A.toast('New panel (library, references and instrument settings kept)');
  }
  function afterLoad() {
    A.invalidate('all'); $('#panel-name').value = S().panelName; syncInstrumentSelect(); applyTheme(); setTab(S().ui.tab || 'panel'); A.updateTitle();
  }
  A.setAfterLoad(afterLoad);

  function init() {
    $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#panel-name').addEventListener('change', e => { S().panelName = e.target.value.trim() || 'Untitled panel'; A.markDirty(); });
    $('#instrument').addEventListener('change', e => { A.pushUndo(); S().instrumentId = e.target.value; changed('all'); A.toast('Instrument: ' + A.baseInstrument().name); });
    $('#btn-new').addEventListener('click', newPanel);
    $('#btn-open').addEventListener('click', open);
    $('#btn-save').addEventListener('click', () => save(false));
    $('#btn-undo').addEventListener('click', () => A.undo());
    $('#btn-redo').addEventListener('click', () => A.redo());
    $('#theme-btn').addEventListener('click', () => { const order = ['auto', 'light', 'dark']; S().settings.theme = order[(order.indexOf(S().settings.theme) + 1) % 3]; applyTheme(); renderActive(); });
    const menu = $('#export-menu'), list = $('#export-list');
    menu.querySelector('button').addEventListener('click', e => { e.stopPropagation(); list.classList.toggle('hidden'); });
    document.addEventListener('click', () => list.classList.add('hidden'));
    const actions = { saveas: () => save(true), panelcsv: exportPanelCSV, controls: exportControlsCSV, sigcsv: exportSignaturesCSV, simcsv: () => { const { names, an } = A.analysis(); if (names.length) exportMatrixCSV('similarity', names, an.cos, 3); }, sscsv: () => { const { names, an } = A.analysis(); if (an.SS) exportMatrixCSV('spread', names, an.SS, 3, true); else A.toast('Panel cannot be unmixed', true); }, wcsv: exportUnmixingCSV, libcsv: exportLibraryCSV, report: printReport };
    $$('#export-list button').forEach(b => b.addEventListener('click', () => { list.classList.add('hidden'); actions[b.dataset.act](); }));
    document.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey, inField = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.shiftKey); }
      else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); open(); }
      else if (mod && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); e.shiftKey ? A.redo() : A.undo(); }
      else if (mod && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); A.redo(); }
    });
    window.addEventListener('beforeunload', e => { if (A.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (['analysis', 'library'].includes(S().ui.tab)) renderActive(); }, 200); });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderActive());
    afterLoad(); A.markClean();
  }
  root.SPDViews = { init, setTab, renderActive, printReport };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof self !== 'undefined' ? self : this);
