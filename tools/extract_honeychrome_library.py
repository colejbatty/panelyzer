#!/usr/bin/env python3
# SPDX-License-Identifier: LGPL-3.0-or-later
# Copyright (C) 2026 Cole Batty and contributors
"""
Regenerates data/honeychrome_library.json from the measured spectral reference libraries
that ship with Honeychrome (https://github.com/Cytkit/honeychrome, LGPL-3.0).

    pip install honeychrome
    python tools/extract_honeychrome_library.py            # uses the installed package
    python tools/extract_honeychrome_library.py PATH/TO/honeychrome/data

Spectra are clipped at 0, normalized to their maximum and square-root encoded to 64 levels
(one base64url character per channel), in the CSV's channel order. Channel names drop the
"-A" suffix. Only the Aurora and ID7000 libraries are extracted (the instruments with presets).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
KEYS = ['Aurora', 'ID7000']


def data_dir():
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    import honeychrome
    return Path(honeychrome.__file__).parent / 'data'


def main():
    src = data_dir()
    out = {}
    for key in KEYS:
        df = pd.read_csv(src / f'{key}_spectral_reference_library.csv', index_col=0)
        channels = [c[:-2] if c.endswith('-A') else c for c in df.columns]
        spectra = {}
        for name, row in df.iterrows():
            v = np.clip(row.values.astype(float), 0, None)
            if v.max() <= 0:
                continue
            q = np.round(63 * np.sqrt(v / v.max())).astype(int)
            spectra[str(name)] = ''.join(B64[x] for x in q)
        out[key] = {'channels': channels, 'spectra': spectra}
        print(f'{key}: {len(spectra)} fluors x {len(channels)} channels')
    dest = Path(__file__).resolve().parents[1] / 'data' / 'honeychrome_library.json'
    dest.write_text(json.dumps(out))
    print(f'wrote {dest}')


if __name__ == '__main__':
    main()
