"""Tests for the Panel Check plugin's computations (numpy only; Qt and Honeychrome optional)."""
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import panel_check_tab as pc  # noqa: E402

FIXTURES = HERE.parents[1] / 'tests' / 'fixtures'


@pytest.fixture(scope='module')
def kit():
    return json.loads((FIXTURES / 'synthetic_experiment.kit').read_text())


@pytest.fixture(scope='module')
def model(kit):
    exp = SimpleNamespace(process=kit['process'], settings=kit['settings'])
    return pc.build_model(exp)


def test_build_model_reads_profiles_in_channel_order(kit, model):
    raw = kit['settings']['raw']
    assert model['labels'] == [c['label'] for c in kit['process']['spectral_model']]
    assert model['channels'] == [raw['event_channels_pnn'][i] for i in raw['fluorescence_channel_ids']]
    n, D = model['M'].shape
    assert (n, D) == (len(model['labels']), len(model['channels']))
    assert np.allclose(model['M'].max(axis=1), 1.0)
    assert model['W_eff'].shape == (n, D)


def test_af_profiles_are_mapped_by_channel_names(kit, model):
    assert model['af_names'] == ['Synthetic AF']
    assert model['AF'].shape == (1, len(model['channels']))
    assert model['af_counts'] == [len(kit['process']['af_profiles']['Synthetic AF']['spectra'])]
    # AF spectra are re-indexed through their own channel_names
    entry = kit['process']['af_profiles']['Synthetic AF']
    sp = np.array(entry['spectra'], float)
    idx = {c: k for k, c in enumerate(entry['channel_names'])}
    expected = pc._norm_rows(np.array([[r[idx[c]] for c in model['channels']] for r in sp])).mean(axis=0)
    assert np.allclose(model['AF'][0], expected / expected.max())


def test_no_model_without_controls(kit):
    proc = dict(kit['process'], spectral_model=[])
    assert pc.build_model(SimpleNamespace(process=proc, settings=kit['settings'])) is None


def test_metrics_match_definitions(model):
    res = pc.analyse(model)
    M, W = model['M'], model['W_eff']
    assert np.allclose(res['cos'], res['cos'].T)
    assert np.allclose(np.diag(res['cos']), 1.0)
    assert res['ci'] == pytest.approx(np.linalg.cond(M), rel=1e-9)
    assert np.allclose(res['ss_pred'], np.sqrt(M @ (W ** 2).T))
    assert np.allclose(res['nu'], np.linalg.norm(W, axis=1))
    assert res['ci_with_af'] >= res['ci'] - 1e-9
    assert len(res['af_overlap']) == len(model['labels'])


def test_ols_unmixing_is_used_when_kit_has_none(kit):
    proc = dict(kit['process'], unmixing_matrix=[], spillover=[])
    m = pc.build_model(SimpleNamespace(process=proc, settings=kit['settings']))
    assert np.allclose(m['W'] @ m['M'].T, np.eye(len(m['labels'])), atol=1e-9)


def test_spread_from_poisson_controls_matches_prediction():
    """Simulate photon-noise single stains, unmix with OLS, and recover √Q × predicted spread."""
    rng = np.random.default_rng(1)
    D, Q, n_ev = 40, 25.0, 40000
    x = np.arange(D)
    M = np.array([np.exp(-0.5 * ((x - c) / w) ** 2) for c, w in [(8, 3), (14, 4), (24, 3), (31, 5)]])
    W = np.linalg.pinv(M.T)
    pred = pc.predicted_spread(M, W)
    base = 50.0
    for j in range(len(M)):
        a = 4e4

        def unmixed(amp):
            mean = base + amp * M[j]
            ev = rng.normal(mean, np.sqrt(Q * mean), size=(n_ev, D))
            return ev @ W.T

        row, si, resid, dF = pc.spread_from_unmixed(unmixed(a), unmixed(0.0), j)
        assert dF == pytest.approx(a, rel=0.02)
        assert si > 10
        assert np.nanmax(np.abs(resid)) < 0.01
        meas = row / math.sqrt(Q)
        k = [i for i in range(len(M)) if i != j]
        assert np.allclose(meas[k], pred[j, k], rtol=0.12, atol=0.05 * pred[j, k].max())


def test_fit_scale_recovers_constant():
    rng = np.random.default_rng(2)
    pred = rng.uniform(0.1, 2.0, 60)
    meas = 7.0 * pred * np.exp(0.05 * rng.standard_normal(60))
    c, r, n = pc.fit_scale(pred, meas)
    assert c == pytest.approx(7.0, rel=0.03)
    assert r > 0.95 and n == 60
    assert pc.fit_scale(np.array([1.0, np.nan]), np.array([1.0, 2.0])) == (None, None, 1)


def test_issues_flag_similar_pairs(model):
    m = dict(model)
    M = model['M'].copy()
    M[1] = 0.995 * M[0] + 0.005 * M[1]
    m['M'] = pc._norm_rows(M)
    m['W_eff'] = np.linalg.pinv(m['M'].T)
    found = pc.issues(m, pc.analyse(m))
    assert found and found[0][0] == 'problem'
    assert any(model['labels'][0] in t and model['labels'][1] in t for _, t in found)


def test_feedback_payload_is_json_and_matches_designer_format(model):
    res = pc.analyse(model)
    p = pc.feedback_payload(model, res, 'synthetic')
    p2 = json.loads(json.dumps(p, allow_nan=False))
    assert p2['app'] == 'honeychrome-panel-check'
    assert [c['label'] for c in p2['controls']] == model['labels']
    assert len(p2['controls'][0]['spectrum']) == len(p2['channels'])
    assert len(p2['spread']['predicted_unit']) == len(model['labels'])
    assert p2['af_profiles'][0]['name'] == 'Synthetic AF'
    # the shipped fixture (read by the designer's unit tests) has the same shape
    fixture = json.loads((FIXTURES / 'panel_check_export.json').read_text())
    assert set(fixture) >= {'app', 'channels', 'controls', 'spread'}


def test_widget_requires_qt():
    if pc._HAVE_QT:
        pytest.skip('Qt is installed')
    with pytest.raises(ImportError):
        pc.PluginWidget()
