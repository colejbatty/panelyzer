"""numpy reference values for tests/unit/engine_math.test.cjs (run: python tests/fixtures/make_math_reference.py)."""
import json, pathlib
import numpy as np
here = pathlib.Path(__file__).parent
d = json.loads((here / 'panel27_signatures.json').read_text())
S = np.array(d['cols']).T          # detectors x fluors
W = np.linalg.pinv(S)              # fluors x detectors (OLS unmixing)
SS = np.sqrt((W ** 2) @ S).T       # SS[j,k] = sqrt(sum_d W[k,d]^2 S[d,j])
N = S / np.linalg.norm(S, axis=0)
ref = {
    'ci': float(np.linalg.cond(S)),
    'trace_inv': float(np.trace(np.linalg.inv(S.T @ S))),
    'cos': (N.T @ N).round(12).tolist(),
    'W': W.round(12).tolist(),
    'SS': SS.round(12).tolist(),
    'nu': np.sqrt((W ** 2).sum(axis=1)).round(12).tolist(),
}
(here / 'panel27_numpy_reference.json').write_text(json.dumps(ref))
print('ci', ref['ci'])
