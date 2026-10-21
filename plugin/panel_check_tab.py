# SPDX-License-Identifier: LGPL-3.0-or-later
# Copyright (C) 2026 Cole Batty and contributors
"""
Panel Check — a Honeychrome plugin (companion to Spectral Panel Designer)
=========================================================================

Adds a "Panel Check" tab to Honeychrome that evaluates the experiment's current
spectral model and closes the loop with Spectral Panel Designer:

  * Panel metrics on your real reference spectra: complexity index (fluors alone and
    with AutoSpectral autofluorescence), per-fluor cosine similarity, noise
    amplification and a predicted spillover-spreading matrix from a photon-noise model
    of the experiment's own unmixing matrix.
  * Control QC: agreement of every reference with Honeychrome's bundled reference
    library for this cytometer, and flags for low-agreement or negative-profile controls.
  * Measured spread: unmixes each single-stain control (positive gate vs its negative)
    and computes the empirical spillover-spreading matrix (robust SDs), stain index and
    unmixing residuals, then compares measured with predicted spread and fits the scale
    that converts the designer's relative units into this instrument's units.
  * Export for Spectral Panel Designer: one JSON file the designer imports ("Import
    Honeychrome") to load these references, autofluorescence and the spread calibration.

Install
-------
* As a user plugin (Honeychrome run from Python — user plugins are disabled in the packaged
  Microsoft Store / macOS / Linux builds):
    pip install honeychrome            then run:   python -m honeychrome
    copy this file to  <home>/Experiments/plugins/panel_check_tab.py
    Edit > App Configuration > enable the plugin, restart Honeychrome.
* As a bundled plugin (inside the Honeychrome source tree): place it in
  src/honeychrome/bundled_plugins/ and enable "panel_check_tab" in App Configuration.

Project: https://github.com/OWNER/spectral-panel-designer  (LGPL-3.0-or-later)
Nothing is sent anywhere; the export is written inside the experiment folder.
"""

plugin_name = 'Panel Check'
PLUGIN_VERSION = '1.0.0'

import json
import math
import re
from datetime import datetime
from pathlib import Path, PureWindowsPath

import numpy as np

INTERNAL_NEGATIVE = '[Internal Negative]'
try:  # keep in sync with Honeychrome if it changes the sentinel
    from honeychrome.settings import INTERNAL_NEGATIVE_SENTINEL as INTERNAL_NEGATIVE  # noqa: F811
except Exception:
    pass

AGREE_WARN = 0.90      # library agreement below this: caution
AGREE_BAD = 0.80       # below this: check control
SIM_WARN = 0.98        # similarity limits (as in Spectral Panel Designer)
SIM_CAUTION = 0.90
RESIDUAL_WARN = 0.03   # |median positive in another channel| / signal


# =============================================================================
# Core computations (pure numpy — no Qt, unit-testable)
# =============================================================================

def fluorescence_ids(settings_raw, channel_filter):
    pnn = settings_raw['event_channels_pnn']
    ids = list(settings_raw['fluorescence_channel_ids'])
    if channel_filter == 'area_only':
        ids = [i for i in ids if pnn[i].endswith('-A')]
    return ids


def _norm_rows(A):
    A = np.clip(np.asarray(A, float), 0, None)
    mx = A.max(axis=1, keepdims=True)
    mx[mx <= 0] = 1.0
    return A / mx


def build_model(experiment):
    """Collect labels, reference spectra, unmixing matrix and AF profiles from an ExperimentModel."""
    proc = experiment.process
    raw = experiment.settings['raw']
    pnn = raw['event_channels_pnn']
    ids = fluorescence_ids(raw, proc.get('fluorescence_channel_filter'))
    channels = [pnn[i] for i in ids]
    profiles = proc.get('profiles') or {}
    controls = [c for c in (proc.get('spectral_model') or []) if c.get('label') in profiles]
    labels = [c['label'] for c in controls]
    if not labels:
        return None
    M = np.array([profiles[lab] for lab in labels], float)
    if M.shape[1] != len(channels):  # profiles built without the area filter
        alt = [pnn[i] for i in raw['fluorescence_channel_ids']]
        if M.shape[1] == len(alt):
            channels, ids = alt, list(raw['fluorescence_channel_ids'])
        else:
            raise ValueError(f'Profiles have {M.shape[1]} channels but the experiment lists {len(channels)}.')
    M = _norm_rows(M)
    n, D = M.shape

    W = np.array(proc.get('unmixing_matrix') or [], float)
    if W.shape != (n, D):
        W = np.linalg.pinv(M.T)  # OLS: (MᵀM)⁻¹… in row form
    spill = np.array(proc.get('spillover') or [], float)
    if spill.shape == (n, n):
        try:
            W_eff = np.linalg.inv(spill) @ W   # Honeychrome applies compensation after unmixing
        except np.linalg.LinAlgError:
            W_eff = W
    else:
        W_eff = W

    af_names, af_rows, af_counts = [], [], []
    for name, entry in (proc.get('af_profiles') or {}).items():
        try:
            sp = np.atleast_2d(np.array(entry.get('spectra') if isinstance(entry, dict) else entry, float))
        except Exception:
            continue
        names = entry.get('channel_names') if isinstance(entry, dict) else None
        if names and len(names) == sp.shape[1]:
            idx = {c: k for k, c in enumerate(names)}
            sp = np.array([[row[idx[c]] if c in idx else 0.0 for c in channels] for row in sp])
        if sp.shape[1] != D:
            continue
        mean = _norm_rows(sp).mean(axis=0)
        af_names.append(name)
        af_rows.append(mean / (mean.max() or 1))
        af_counts.append(sp.shape[0])
    AF = np.array(af_rows) if af_rows else np.zeros((0, D))

    return dict(labels=labels, controls=controls, channels=channels, channel_ids=ids, M=M, W=W, W_eff=W_eff,
                af_names=af_names, AF=AF, af_counts=af_counts,
                unmixing_method=proc.get('unmixing_method', 'OLS'),
                negative_type=proc.get('negative_type'),
                cytometer=raw.get('cytometer'), cytometer_db_col=raw.get('cytometer_db_col'))


def cosine_matrix(M):
    N = M / (np.linalg.norm(M, axis=1, keepdims=True) + 1e-12)
    return N @ N.T


def complexity_index(M):
    if M.shape[0] < 2:
        return 1.0
    s = np.linalg.svd(M, compute_uv=False)
    return float(s[0] / s[-1]) if s[-1] > 1e-12 * s[0] else math.inf


def predicted_spread(M, W):
    """SS[j, k] = sqrt(Σ_d W[k,d]² · M[j,d])  (relative units; shot-noise model)."""
    return np.sqrt(np.clip(M @ (W ** 2).T, 0, None))


def noise_amplification(W):
    return np.sqrt((W ** 2).sum(axis=1))


def library_agreement(model):
    """Cosine of each reference vs Honeychrome's bundled library for this cytometer (or None)."""
    out = [None] * len(model['labels'])
    key = model.get('cytometer_db_col')
    if not key:
        return out
    try:
        from honeychrome.controller_components.spectral_reference_library import cosine_similarity_to_reference
    except Exception:
        return out
    for i, lab in enumerate(model['labels']):
        try:
            out[i] = cosine_similarity_to_reference(model['M'][i], model['channels'], lab, key)
        except Exception:
            out[i] = None
    return out


def robust_sd(x):
    """84.13th percentile minus median (robust SD estimate used for spillover spreading)."""
    if len(x) < 3:
        return float('nan')
    p50, p84 = np.percentile(x, [50, 84.13])
    return float(p84 - p50)


def spread_from_unmixed(U_pos, U_neg, j):
    """
    Empirical spillover spreading row for control j from unmixed positive/negative events.
      SS[j,k] = sqrt(max(0, rSD_pos_k² − rSD_neg_k²)) / sqrt(ΔF_j)
      SI_j    = ΔF_j / (2 · rSD_neg_j)
      residual[j,k] = (median_pos_k − median_neg_k) / ΔF_j     (unmixing error; ideally 0)
    """
    n = U_pos.shape[1]
    med_p, med_n = np.median(U_pos, axis=0), np.median(U_neg, axis=0)
    rsd_p = np.array([robust_sd(U_pos[:, k]) for k in range(n)])
    rsd_n = np.array([robust_sd(U_neg[:, k]) for k in range(n)])
    dF = float(med_p[j] - med_n[j])
    row = np.full(n, np.nan)
    resid = np.full(n, np.nan)
    if dF > 0:
        row = np.sqrt(np.clip(rsd_p ** 2 - rsd_n ** 2, 0, None)) / math.sqrt(dF)
        resid = (med_p - med_n) / dF
    row[j] = np.nan
    resid[j] = np.nan
    si = dF / (2 * rsd_n[j]) if rsd_n[j] > 0 and dF > 0 else float('nan')
    return row, si, resid, dF


def fit_scale(pred, meas):
    """Robust scale c so that meas ≈ c·pred, plus log-space Pearson r over usable pairs."""
    m = np.isfinite(pred) & np.isfinite(meas) & (pred > 0) & (meas > 0)
    if m.sum() < 3:
        return None, None, int(m.sum())
    lp, lm = np.log(pred[m]), np.log(meas[m])
    c = float(np.exp(np.median(lm - lp)))
    r = float(np.corrcoef(lp, lm)[0, 1]) if m.sum() > 2 else None
    return c, r, int(m.sum())


def _rel_path(p):
    """Experiment-relative sample paths are stored with OS separators; normalise them."""
    return Path(*PureWindowsPath(p).parts) if '\\' in str(p) else Path(p)


def measure_controls(controller, model, progress=None):
    """Unmix every single-stain control and compute measured spread, stain index and residuals."""
    from honeychrome.controller_components.functions import sample_from_fcs
    from honeychrome.controller_components.spectral_functions import get_raw_events

    exp, exp_dir, gating = controller.experiment, Path(controller.experiment_dir), controller.raw_gating
    samples = exp.samples
    by_name = {v: k for k, v in (samples.get('all_samples') or {}).items()}
    ids, W = model['channel_ids'], model['W_eff']
    n = len(model['labels'])
    SS = np.full((n, n), np.nan)
    RES = np.full((n, n), np.nan)
    info = [dict(status='not measured') for _ in range(n)]
    neg_cache = {}

    def resolve(name, fallback=None):
        rel = by_name.get(name)
        cands = [exp_dir / _rel_path(rel)] if rel else []
        if fallback:
            cands.append(Path(fallback))
            cands.append(exp_dir / _rel_path(fallback))
        for c in cands:
            if c.exists():
                return c
        return None

    def default_unstained():
        for rel, name in (samples.get('all_samples') or {}).items():
            if re.search('unstained', rel, re.I) or re.search('unstained', name, re.I):
                return name
        return None

    def events(path, gate):
        smp = sample_from_fcs(str(path))
        g = gate if gate and gating.find_matching_gate_paths(gate) else None
        return get_raw_events(smp, ids, gate_label=g, gating_strategy=gating if g else None)

    for j, ctl in enumerate(model['controls']):
        label = ctl['label']
        if progress:
            progress(f'Measuring {label} ({j + 1}/{n})')
        if ctl.get('control_type') != 'Single Stained Spectral Control' or not ctl.get('gate_label'):
            info[j] = dict(status='no single-stain control (library or assignment)')
            continue
        path = resolve(ctl.get('sample_name'), ctl.get('sample_path'))
        if path is None:
            info[j] = dict(status='FCS file not found')
            continue
        try:
            F_pos = events(path, ctl['gate_label'])
            neg_name = ctl.get('universal_negative_name') or ''
            use_unstained = model.get('negative_type') == 'unstained' and neg_name != INTERNAL_NEGATIVE
            if use_unstained:
                neg_name = neg_name or default_unstained()
            if use_unstained and neg_name:
                if neg_name not in neg_cache:
                    npath = resolve(neg_name)
                    neg_cache[neg_name] = events(npath, 'Neg Unstained') if npath else None
                F_neg = neg_cache[neg_name]
                neg_src = f'unstained: {neg_name}'
            else:
                F_neg = None
            if F_neg is None:
                F_neg = events(path, ctl.get('neg_gate_label') or f'Neg {label}')
                neg_src = 'internal negative gate'
            if len(F_pos) < 50 or len(F_neg) < 50:
                info[j] = dict(status=f'too few events (pos {len(F_pos)}, neg {len(F_neg)})')
                continue
            U_pos, U_neg = F_pos @ W.T, F_neg @ W.T
            row, si, resid, dF = spread_from_unmixed(U_pos, U_neg, j)
            SS[j], RES[j] = row, resid
            info[j] = dict(status='measured', n_pos=int(len(F_pos)), n_neg=int(len(F_neg)), stain_index=float(si),
                           signal=float(dF), negative=neg_src,
                           max_residual=float(np.nanmax(np.abs(resid))) if np.isfinite(resid).any() else None,
                           worst_residual_into=model['labels'][int(np.nanargmax(np.abs(resid)))] if np.isfinite(resid).any() else None)
        except Exception as e:  # keep going for other controls
            info[j] = dict(status=f'error: {e}')
    return SS, RES, info


def analyse(model):
    """All model-level metrics in one dict."""
    M, W = model['M'], model['W_eff']
    cos = cosine_matrix(M)
    n = len(model['labels'])
    best = None
    for i in range(n):
        for j in range(i + 1, n):
            if best is None or cos[i, j] > best[0]:
                best = (float(cos[i, j]), i, j)
    out = dict(cos=cos, ci=complexity_index(M), max_cos=best, nu=noise_amplification(W),
               ss_pred=predicted_spread(M, W), agreement=library_agreement(model))
    if len(model['AF']):
        both = np.vstack([M, model['AF']])
        out['ci_with_af'] = complexity_index(both)
        cos_af = cosine_matrix(both)[:n, n:]
        out['af_overlap'] = cos_af.max(axis=1)
        out['af_overlap_name'] = [model['af_names'][int(k)] for k in cos_af.argmax(axis=1)]
    return out


def issues(model, res, info=None):
    """Plain-language findings, most serious first: list of (severity, text)."""
    out = []
    labs = model['labels']
    for i, a in enumerate(res['agreement']):
        if a is not None and a < AGREE_BAD:
            out.append(('problem', f'{labs[i]}: reference agrees poorly with the library spectrum for this cytometer '
                                   f'(cosine {a:.2f}). Check the control (positive gate, bead/cell autofluorescence, labeling) before trusting the unmix.'))
        elif a is not None and a < AGREE_WARN:
            out.append(('caution', f'{labs[i]}: reference agreement with the library is {a:.2f}.'))
    for c in model['controls']:
        if c.get('profile_warning'):
            out.append(('problem', f"{c['label']}: {c['profile_warning']}"))
    cos = res['cos']
    for i in range(len(labs)):
        for j in range(i + 1, len(labs)):
            v = cos[i, j]
            if v >= SIM_WARN:
                out.append(('problem', f'{labs[i]} and {labs[j]} are {v:.3f} similar — very hard to unmix.'))
            elif v >= SIM_CAUTION:
                out.append(('caution', f'{labs[i]} and {labs[j]} are {v:.3f} similar — keep them off co-expressed markers.'))
    if 'af_overlap' in res:
        for i, v in enumerate(res['af_overlap']):
            if v >= SIM_CAUTION:
                out.append(('caution', f'{labs[i]} overlaps autofluorescence "{res["af_overlap_name"][i]}" ({v:.2f}).'))
    if info:
        for i, inf in enumerate(info):
            if inf.get('max_residual') is not None and inf['max_residual'] > RESIDUAL_WARN:
                out.append(('problem' if inf['max_residual'] > 0.15 else 'caution', f"{labs[i]}: unmixing leaves {100 * inf['max_residual']:.1f}% of its signal in "
                                       f"{inf['worst_residual_into']} — the reference may not match this control's spectrum."))
    order = {'problem': 0, 'caution': 1}
    return sorted(out, key=lambda x: order[x[0]])


def feedback_payload(model, res, experiment_name, measured=None):
    """JSON payload for Spectral Panel Designer's "Import Honeychrome"."""
    labs = model['labels']
    ctl = []
    for i, c in enumerate(model['controls']):
        d = dict(label=labs[i], antigen=c.get('antigen', ''), particle_type=c.get('particle_type', ''),
                 control_type=c.get('control_type', ''), spectrum=[round(float(x), 6) for x in model['M'][i]],
                 library_agreement=None if res['agreement'][i] is None else round(float(res['agreement'][i]), 4),
                 profile_warning=c.get('profile_warning'))
        if measured:
            inf = measured['info'][i]
            d.update({k: inf.get(k) for k in ('status', 'stain_index', 'n_pos', 'n_neg', 'max_residual', 'worst_residual_into', 'negative')})
        ctl.append(d)
    spread = dict(labels=labs, predicted_unit=np.round(res['ss_pred'], 6).tolist())
    if measured:
        spread.update(measured=[[None if not np.isfinite(v) else round(float(v), 6) for v in row] for row in measured['SS']],
                      scale=measured['scale'], log_r=measured['r'], n_pairs=measured['n_pairs'])
    return {
        'app': 'honeychrome-panel-check', 'version': PLUGIN_VERSION, 'exported': datetime.now().isoformat(timespec='seconds'),
        'experiment': experiment_name, 'cytometer': model.get('cytometer'), 'cytometer_db_col': model.get('cytometer_db_col'),
        'unmixing_method': model.get('unmixing_method'), 'channels': model['channels'],
        'complexity_index': None if not math.isfinite(res['ci']) else round(res['ci'], 4),
        'complexity_index_with_af': None if 'ci_with_af' not in res or not math.isfinite(res['ci_with_af']) else round(res['ci_with_af'], 4),
        'controls': ctl,
        'af_profiles': [dict(name=nm, spectrum=[round(float(x), 6) for x in model['AF'][k]], components=model['af_counts'][k])
                        for k, nm in enumerate(model['af_names'])],
        'spread': spread,
    }


# =============================================================================
# Figures (matplotlib)
# =============================================================================

def _heatmap(ax, A, labels, title, cmap, vmax=None, fmt='{:.2f}', show=lambda v: True, blank_diag=False):
    A = np.array(A, float)
    if blank_diag:
        A = A.copy()
        np.fill_diagonal(A, np.nan)
    im = ax.imshow(A, cmap=cmap, vmin=0, vmax=vmax if vmax else np.nanmax(A) if np.isfinite(A).any() else 1)
    ax.set_xticks(range(len(labels)), labels, rotation=60, ha='right', fontsize=7)
    ax.set_yticks(range(len(labels)), labels, fontsize=7)
    ax.set_title(title, fontsize=10)
    ax.grid(False)
    for i in range(A.shape[0]):
        for j in range(A.shape[1]):
            v = A[i, j]
            if np.isfinite(v) and show(v) and len(labels) <= 30:
                ax.text(j, i, fmt.format(v), ha='center', va='center', fontsize=6,
                        color='white' if v > 0.6 * (vmax or np.nanmax(A)) else 'black')
    return im


def figure_model(model, res):
    from matplotlib.figure import Figure
    fig = Figure(figsize=(11, 5.2), layout='constrained')
    a1, a2 = fig.subplots(1, 2)
    im = _heatmap(a1, res['cos'], model['labels'], 'Similarity (cosine)', 'Blues', 1.0, show=lambda v: v >= 0.5, blank_diag=True)
    fig.colorbar(im, ax=a1, shrink=0.7)
    ss = res['ss_pred']
    off = ss[~np.eye(len(ss), dtype=bool)]
    vmax = float(np.percentile(off, 98)) if off.size else 1
    im = _heatmap(a2, ss, model['labels'], 'Predicted spread (relative), row → column', 'Oranges', vmax, fmt='{:.1f}', show=lambda v: v >= 0.5 * vmax, blank_diag=True)
    fig.colorbar(im, ax=a2, shrink=0.7)
    return fig


def figure_measured(model, res, measured):
    from matplotlib.figure import Figure
    fig = Figure(figsize=(11, 5.2), layout='constrained')
    a1, a2 = fig.subplots(1, 2)
    SS = measured['SS']
    off = SS[np.isfinite(SS)]
    vmax = float(np.percentile(off, 98)) if off.size else 1
    im = _heatmap(a1, SS, model['labels'], 'Measured spillover spreading, row → column', 'Oranges', vmax, fmt='{:.1f}', show=lambda v: v >= 0.5 * vmax)
    fig.colorbar(im, ax=a1, shrink=0.7)
    pred, c = res['ss_pred'], measured['scale']
    m = np.isfinite(SS) & (SS > 0) & (pred > 0)
    if m.any():
        x, y = pred[m] * (c or 1), SS[m]
        a2.scatter(x, y, s=14, alpha=0.7)
        lo, hi = min(x.min(), y.min()), max(x.max(), y.max())
        a2.plot([lo, hi], [lo, hi], lw=1, color='0.4')
        a2.set_xscale('log'); a2.set_yscale('log')
        a2.set_xlabel('Predicted × scale'); a2.set_ylabel('Measured')
        a2.set_title(f"Predicted vs measured (scale {c:.3g}, log r = {measured['r']:.2f}, n = {measured['n_pairs']})" if c and measured['r'] is not None else 'Predicted vs measured', fontsize=10)
        # label the largest excesses
        ratio = np.where(m, SS / np.where(pred > 0, pred * (c or 1), np.nan), np.nan)
        for (i, j) in np.argwhere(np.nan_to_num(ratio) > 2.5)[:8]:
            a2.annotate(f"{model['labels'][i]}→{model['labels'][j]}", (pred[i, j] * (c or 1), SS[i, j]), fontsize=6)
    return fig


# =============================================================================
# Qt widget
# =============================================================================

try:  # the core above is importable without Qt (unit tests); the widget needs PySide6
    from PySide6.QtCore import Qt
    from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QScrollArea, QPushButton, QLabel,
                                   QMessageBox)
    _HAVE_QT = True
except ImportError:  # pragma: no cover
    _HAVE_QT = False
    QWidget = object

def _clear(layout):
    """Remove widgets immediately (not just deleteLater) so re-renders never overlap."""
    while layout.count():
        item = layout.takeAt(0)
        w = item.widget()
        if w is not None:
            w.hide()
            w.setParent(None)
            w.deleteLater()
        elif item.layout() is not None:
            _clear(item.layout())


COL_FLUOR = ['Fluor', 'Antigen', 'Control', 'Peak channel', 'Library agreement', 'Closest fluor', 'Similarity',
             'Noise ν', 'Predicted spread received', 'Stain index', 'Max unmixing residual', 'Flags']


class PluginWidget(QWidget):
    def __init__(self, bus=None, controller=None, parent=None):
        if not _HAVE_QT:
            raise ImportError('Panel Check needs PySide6 (it runs inside Honeychrome).')
        super().__init__(parent)
        self.bus, self.controller = bus, controller
        self.model = self.res = self.measured = None

        self.content = QWidget()
        self.layout_main = QVBoxLayout(self.content)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setWidget(self.content)
        outer = QVBoxLayout(self)
        outer.addWidget(scroll)

        title = QLabel(f'<h2 style="margin:0">Panel Check</h2><p style="color:#666;margin:2px 0 0">'
                       f'Spectral model QC, predicted vs measured spread, and export to Spectral Panel Designer (v{PLUGIN_VERSION}).</p>')
        title.setTextFormat(Qt.RichText)
        self.layout_main.addWidget(title)

        row = QHBoxLayout()
        self.btn_refresh = QPushButton('Refresh')
        self.btn_refresh.clicked.connect(self.refresh)
        self.btn_measure = QPushButton('Measure spread from controls')
        self.btn_measure.setToolTip('Unmixes every single-stain control (positive gate vs negative) with the current unmixing matrix')
        self.btn_measure.clicked.connect(self.measure)
        self.btn_export = QPushButton('Export for Spectral Panel Designer')
        self.btn_export.clicked.connect(self.export)
        for b in (self.btn_refresh, self.btn_measure, self.btn_export):
            row.addWidget(b)
        row.addStretch()
        self.layout_main.addLayout(row)

        self.summary = QLabel('Open an experiment with a spectral model, then press Refresh.')
        self.summary.setTextFormat(Qt.RichText)
        self.summary.setWordWrap(True)
        self.layout_main.addWidget(self.summary)

        self.results_widget = QWidget()
        self.results = QVBoxLayout(self.results_widget)
        self.layout_main.addWidget(self.results_widget)
        self.layout_main.addStretch()

        if bus is not None:
            try:
                bus.modeChangeRequested.connect(self._on_mode)
            except Exception:
                pass
            for sig in ('spectralModelUpdated', 'spectralProcessRefreshed'):
                try:
                    getattr(bus, sig).connect(self._on_model_changed)
                except Exception:
                    pass

    # ---------------------------------------------------------------- events
    def _on_mode(self, mode):
        if mode == plugin_name:
            self.refresh()

    def _on_model_changed(self, *args):
        self.measured = None
        if getattr(self.controller, 'current_mode', None) == plugin_name:
            self.refresh()

    def _status(self, text):
        print(f'[Panel Check] {text}')
        if self.bus is not None:
            try:
                self.bus.statusMessage.emit(text)
            except Exception:
                pass

    # ---------------------------------------------------------------- actions
    def refresh(self):
        _clear(self.results)
        exp = getattr(self.controller, 'experiment', None)
        if exp is None or not getattr(self.controller, 'experiment_dir', None):
            self.summary.setText('No experiment loaded.')
            return
        try:
            self.model = build_model(exp)
        except Exception as e:
            self.summary.setText(f'<b>Could not read the spectral model:</b> {e}')
            return
        if not self.model:
            self.summary.setText('The spectral model has no reference profiles yet. Generate the spectral process first.')
            return
        self.res = analyse(self.model)
        self._render()

    def measure(self):
        if not self.model:
            self.refresh()
            if not self.model:
                return
        if getattr(self.controller, 'raw_gating', None) is None:
            QMessageBox.warning(self, plugin_name, 'Raw gating is not available yet.')
            return
        from honeychrome.view_components.busy_cursor import with_busy_cursor

        @with_busy_cursor
        def work():
            return measure_controls(self.controller, self.model, progress=print)

        self._status('Panel Check: measuring spread from single-stain controls…')
        try:
            SS, RES, info = work()
        except Exception as e:
            QMessageBox.warning(self, plugin_name, f'Measurement failed: {e}')
            return
        c, r, npairs = fit_scale(self.res['ss_pred'], SS)
        self.measured = dict(SS=SS, RES=RES, info=info, scale=c, r=r, n_pairs=npairs)
        done = sum(1 for i in info if i.get('status') == 'measured')
        self._status(f'Panel Check: measured {done}/{len(info)} controls.')
        self._render()

    def export(self):
        if not self.model:
            self.refresh()
            if not self.model:
                return
        exp_dir = Path(self.controller.experiment_dir)
        out_dir = exp_dir / 'Panel Check'
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f'{exp_dir.name} panel check.json'
        payload = feedback_payload(self.model, self.res, exp_dir.name, self.measured)
        path.write_text(json.dumps(payload, indent=1))
        msg = f'Saved {path.name} in {out_dir}.\n\nIn Spectral Panel Designer: Library → Import Honeychrome, and pick this file.'
        if not self.measured:
            msg += '\n\nTip: run "Measure spread from controls" first to include the spread calibration.'
        QMessageBox.information(self, plugin_name, msg)
        self._status(f'Panel Check: exported {path}')

    # ---------------------------------------------------------------- render
    def _render(self):
        from honeychrome.view_components.copyable_table_widget import CopyableTableWidget
        from honeychrome.view_components.exportable_plot_widget import ExportablePlotWidget
        _clear(self.results)
        m, r = self.model, self.res
        labs, n = m['labels'], len(m['labels'])
        ci = f"{r['ci']:.2f}" if math.isfinite(r['ci']) else '∞'
        af = (f" · with autofluorescence <b>{r['ci_with_af']:.2f}</b> ({len(m['af_names'])} profile(s))"
              if 'ci_with_af' in r and math.isfinite(r['ci_with_af']) else ' · no AutoSpectral AF profiles')
        mc = r['max_cos']
        top = f"{mc[0]:.3f} ({labs[mc[1]]} · {labs[mc[2]]})" if mc else '—'
        meas = ''
        if self.measured:
            ms = self.measured
            done = sum(1 for i in ms['info'] if i.get('status') == 'measured')
            meas = (f"<br>Measured spread from <b>{done}/{n}</b> controls"
                    + (f" · predicted→measured scale <b>{ms['scale']:.3g}</b>, log-space r = <b>{ms['r']:.2f}</b> over {ms['n_pairs']} pairs" if ms['scale'] else ''))
        self.summary.setText(f"<p><b>{n}</b> fluors · {m['cytometer'] or 'cytometer'} · {len(m['channels'])} channels · unmixing {m['unmixing_method']}<br>"
                             f"Complexity index <b>{ci}</b>{af}<br>Highest similarity {top}{meas}</p>")

        found = issues(m, r, self.measured['info'] if self.measured else None)
        if found:
            html = '<p><b>Findings</b></p><ul>' + ''.join(
                f"<li><span style='color:{'#c62828' if s == 'problem' else '#a36b00'}'><b>{'Problem' if s == 'problem' else 'Caution'}:</b></span> {t}</li>" for s, t in found) + '</ul>'
        else:
            html = "<p><b>Findings:</b> <span style='color:#2e7d32'>no issues found</span></p>"
        lab = QLabel(html)
        lab.setTextFormat(Qt.RichText)
        lab.setWordWrap(True)
        self.results.addWidget(lab)

        rows = []
        cos = r['cos']
        for i in range(n):
            others = [(cos[i, j], labs[j]) for j in range(n) if j != i]
            nn = max(others) if others else (None, '')
            rec = float(np.nansum(np.delete(r['ss_pred'][:, i], i)))
            inf = self.measured['info'][i] if self.measured else {}
            flags = []
            a = r['agreement'][i]
            if a is not None and a < AGREE_BAD:
                flags.append('check control')
            if nn[0] is not None and nn[0] >= SIM_WARN:
                flags.append('too similar')
            elif nn[0] is not None and nn[0] >= SIM_CAUTION:
                flags.append('similar')
            if 'af_overlap' in r and r['af_overlap'][i] >= SIM_CAUTION:
                flags.append('overlaps AF')
            if inf.get('max_residual') is not None and inf['max_residual'] > RESIDUAL_WARN:
                flags.append('unmixing residual')
            if inf and inf.get('status') not in (None, 'measured'):
                flags.append(inf['status'])
            ctl = m['controls'][i]
            rows.append({
                'Fluor': labs[i], 'Antigen': ctl.get('antigen', ''), 'Control': ctl.get('particle_type', '') or ctl.get('control_type', ''),
                'Peak channel': m['channels'][int(np.argmax(m['M'][i]))],
                'Library agreement': '' if a is None else round(float(a), 3),
                'Closest fluor': nn[1], 'Similarity': '' if nn[0] is None else round(float(nn[0]), 3),
                'Noise ν': round(float(r['nu'][i]), 3), 'Predicted spread received': round(rec, 3),
                'Stain index': '' if not inf.get('stain_index') or not math.isfinite(inf['stain_index']) else round(inf['stain_index'], 1),
                'Max unmixing residual': '' if inf.get('max_residual') is None else f"{100 * inf['max_residual']:.1f}% → {inf['worst_residual_into']}",
                'Flags': ', '.join(flags),
            })
        table = CopyableTableWidget(rows, COL_FLUOR)
        table.setMinimumHeight(min(60 + 30 * n, 520))
        self.results.addWidget(table)

        exp_dir = Path(self.controller.experiment_dir)
        self.results.addWidget(ExportablePlotWidget(figure_model(m, r), title='Panel Check similarity and predicted spread', experiment_dir=exp_dir))
        if self.measured:
            self.results.addWidget(ExportablePlotWidget(figure_measured(m, r, self.measured), title='Panel Check measured spread', experiment_dir=exp_dir))
        note = QLabel("<p style='color:#666'>Predicted spread uses the experiment's own unmixing matrix and reference spectra with a photon-noise model "
                      "(relative units). Measured spread is (rSD²<sub>pos</sub> − rSD²<sub>neg</sub>)<sup>½</sup> / ΔF<sup>½</sup> per channel after unmixing each single-stain control; "
                      "the fitted scale converts predicted units into this instrument's units and is exported to Spectral Panel Designer. "
                      "Bead controls report bead brightness, not antibody brightness on cells.</p>")
        note.setTextFormat(Qt.RichText)
        note.setWordWrap(True)
        self.results.addWidget(note)
