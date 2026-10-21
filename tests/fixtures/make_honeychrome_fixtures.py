"""
Synthetic Honeychrome fixtures (no real experiment data):
  synthetic_experiment.kit       — minimal .kit JSON: 4 bead controls + 1 AutoSpectral AF profile
  panel_check_export.json        — Panel Check export produced by plugin/panel_check_tab.py core
Run: python tests/fixtures/make_honeychrome_fixtures.py
"""
import json, math, pathlib, sys
from types import SimpleNamespace
import numpy as np

here = pathlib.Path(__file__).parent
root = here.parents[1]
sys.path.insert(0, str(root / 'plugin'))
import panel_check_tab as pc  # noqa: E402

B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
lib = json.loads((root / 'data' / 'honeychrome_library.json').read_text())['Aurora']
ch = lib['channels']
def spec(name):
    return [round((B64.index(c) / 63) ** 2, 6) for c in lib['spectra'][name]]

pnn = ['Time'] + [c + '-A' for c in ch[:16]] + ['SSC-H', 'SSC-A'] + [c + '-A' for c in ch[16:]] + ['FSC-H', 'FSC-A']
fl_ids = [pnn.index(c + '-A') for c in ch]
labels = [('BV421', 'CD4'), ('PE', 'CD8'), ('APC', 'CD3'), ('BUV395', 'CD19')]
profiles = {lab: spec(lab) for lab, _ in labels}
af1 = np.array(spec('BV510')) * 0.6 + np.array(spec('BUV496')) * 0.4
af2 = np.array(spec('BV480')) * 0.7 + np.array(spec('BB515')) * 0.3
kit = {
    'settings': {'raw': {'event_channels_pnn': pnn, 'fluorescence_channel_ids': fl_ids, 'cytometer': 'Cytek Aurora',
                         'cytometer_db_col': 'Aurora', 'scatter_channel_ids': [pnn.index('SSC-A'), pnn.index('FSC-A')], 'time_channel_id': 0}},
    'samples': {'all_samples': {}, 'single_stain_controls': [], 'unstained_samples': []},
    'process': {
        'fluorescence_channel_filter': 'area_only', 'negative_type': 'unstained', 'unmixing_method': 'OLS',
        'spectral_model': [{'label': lab, 'antigen': ag, 'control_type': 'Single Stained Spectral Control', 'particle_type': 'Beads',
                            'gate_label': f'Pos {lab}', 'sample_name': f'{ag} {lab} (Beads)', 'profile_warning': None} for lab, ag in labels],
        'profiles': profiles,
        'af_profiles': {'Synthetic AF': {'spectra': [(af1 / af1.max()).round(6).tolist(), (af2 / af2.max()).round(6).tolist()],
                                         'channel_names': [c + '-A' for c in ch]}},
        'spillover': np.eye(4).tolist(),
    },
    'cytometry': {}, 'statistics': {},
}
M = np.array([profiles[lab] for lab, _ in labels])
kit['process']['unmixing_matrix'] = np.linalg.pinv(M.T).round(10).tolist()
(here / 'synthetic_experiment.kit').write_text(json.dumps(kit))

exp = SimpleNamespace(settings=kit['settings'], process=kit['process'], samples=kit['samples'])
model = pc.build_model(exp)
res = pc.analyse(model)
# synthetic measured spread: q = 49 photoelectron scale -> measured = 7 x predicted
SS = res['ss_pred'] * 7.0
np.fill_diagonal(SS, np.nan)
c, r, n = pc.fit_scale(res['ss_pred'], SS)
info = [dict(status='measured', stain_index=500.0 + 100 * i, n_pos=1000, n_neg=5000, max_residual=0.002, worst_residual_into=labels[(i + 1) % 4][0],
             negative='unstained: Unstained (Beads)') for i in range(4)]
payload = pc.feedback_payload(model, res, 'Synthetic experiment', dict(SS=SS, info=info, scale=c, r=r, n_pairs=n))
payload['exported'] = '2026-01-01T00:00:00'
(here / 'panel_check_export.json').write_text(json.dumps(payload, indent=1))
print('scale', c, 'pairs', n, 'ci', res['ci'])
