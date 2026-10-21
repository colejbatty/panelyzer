// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/* Instrument presets, dye metadata, derived-dye definitions. */
(function (root) {
  'use strict';

  /* ----------------------------------------------------------- instruments */
  const auroraBands = {
    UV: [[373, 15], [388, 15], [428, 15], [443, 15], [458, 15], [473, 15], [514, 28], [542, 28], [582, 31], [613, 31], [664, 27], [692, 28], [720, 29], [750, 30], [780, 30], [812, 34]],
    V: [[428, 15], [443, 15], [458, 15], [473, 15], [508, 20], [525, 17], [542, 17], [581, 19], [598, 20], [615, 20], [664, 27], [692, 28], [720, 29], [750, 30], [780, 30], [812, 34]],
    B: [[508, 20], [525, 17], [542, 17], [581, 19], [598, 20], [615, 20], [661, 17], [679, 18], [697, 19], [717, 20], [738, 21], [760, 23], [783, 23], [812, 34]],
    YG: [[577, 20], [598, 20], [615, 20], [661, 17], [679, 18], [697, 19], [720, 29], [750, 30], [780, 30], [812, 34]],
    R: [[661, 17], [679, 18], [697, 19], [717, 20], [738, 21], [760, 23], [783, 23], [812, 34]]
  };
  const auroraLaser = (name, wl, power, key) => ({
    name, wl, power, scale: 1,
    detectors: auroraBands[key].map(([c, bw], i) => ({ name: key + (i + 1), center: c, bw }))
  });
  const AURORA_5L = {
    id: 'aurora-5l', name: 'Cytek Aurora 5L (UV/V/B/YG/R)', vendor: 'Cytek', editable: false,
    notes: 'Detector filters from a published Aurora 5L optical configuration (UV 20 mW, V 100 mW, B 50 mW, YG 50 mW, R 80 mW). Avalanche photodiode response approximated.',
    response: [[350, 0.45], [400, 0.6], [500, 0.75], [600, 0.85], [700, 0.88], [800, 0.72], [860, 0.6]],
    lasers: [auroraLaser('UV', 355, 20, 'UV'), auroraLaser('Violet', 405, 100, 'V'), auroraLaser('Blue', 488, 50, 'B'),
      auroraLaser('Yellow-green', 561, 50, 'YG'), auroraLaser('Red', 640, 80, 'R')]
  };

  // Sony ID7000: every laser shares one 35-position channel grid (channel N sits at the same
  // wavelength on every laser; lasers skip channels at or below their line: 488 starts at ch4,
  // 561 at ch10, 637 at ch17). Channel boundaries below were fitted to Honeychrome's measured
  // ID7000 reference library (65 fluors, 182 channels) against FPbase spectra (held-out mean
  // cosine 0.92; a uniform-range layout scored 0.69).
  const SONY_GRID = [[427, 443.3], [443.3, 459.7], [459.7, 476.0], [476.0, 493.4], [493.4, 511], [511, 528.6], [528.6, 541], [541, 550.4], [550.4, 559.9], [559.9, 571], [571, 584.2], [584.2, 597.4], [597.4, 609.8], [609.8, 620.2], [620.2, 630.6], [630.6, 641.1], [641.1, 652.7], [652.7, 664.3], [664.3, 675.9], [675.9, 686.4], [686.4, 696.8], [696.8, 707.2], [707.2, 717.8], [717.8, 728.5], [728.5, 739.1], [739.1, 749.7], [749.7, 760.0], [760.0, 770.4], [770.4, 781], [781, 792], [792, 803.0], [803.0, 813.7], [813.7, 822.8], [822.8, 831.9], [831.9, 841]];
  const sonyPMT = [[350, 0.7], [400, 0.85], [500, 1.0], [600, 0.95], [700, 0.8], [800, 0.55], [850, 0.45]];
  function sonyLaser(name, wl, power, firstCh) {
    const det = [];
    for (let ch = firstCh; ch <= 35; ch++) {
      const [lo, hi] = SONY_GRID[ch - 1];
      det.push({ name: `${wl}-${ch}`, lo, hi, center: +((lo + hi) / 2).toFixed(1), bw: +(hi - lo).toFixed(1) });
    }
    return { name, wl, power, scale: 1, detectors: det };
  }
  const SONY_5L = {
    id: 'id7000-5l', name: 'Sony ID7000 (5-laser: 355/405/488/561/637)', vendor: 'Sony', editable: false,
    notes: 'Per-laser ranges and channel counts follow published specifications (147 fluorescence channels); channel boundaries are spread evenly across each range because exact boundaries are not published. Import your own reference controls or calibrate for best accuracy.',
    response: sonyPMT,
    lasers: [sonyLaser('UV', 355, 50, 1), sonyLaser('Violet', 405, 100, 1),
      sonyLaser('Blue', 488, 150, 4), sonyLaser('Yellow-green', 561, 100, 10), sonyLaser('Red', 637, 140, 17)]
  };
  const SONY_7L = JSON.parse(JSON.stringify(SONY_5L));
  SONY_7L.id = 'id7000-7l'; SONY_7L.name = 'Sony ID7000 (7-laser: +320/808)';
  SONY_7L.notes = 'As the 5-laser model plus 320 nm (35 ch) and 808 nm (2 IR channels; boundaries approximate).';
  SONY_7L.lasers.unshift(sonyLaser('Deep UV', 320, 20, 1));
  SONY_7L.lasers.push({ name: 'IR', wl: 808, power: 100, scale: 1, response: [[800, 1], [950, 1]],
    detectors: [{ name: '808-1', lo: 820, hi: 870, center: 845, bw: 50 }, { name: '808-2', lo: 870, hi: 920, center: 895, bw: 50 }] });

  /* ------------------------------------------------------- dye metadata */
  // b = relative brightness 1 (dim) … 5 (very bright); g = family. Editable in the app.
  const T = { pol: 'Polymer dye', sm: 'Small molecule', tan: 'Tandem', pbp: 'Phycobiliprotein', via: 'Viability', trk: 'Tracking / proliferation', dna: 'DNA dye', qd: 'Quantum dot', fp: 'Fluorescent protein', fn: 'Functional / organelle' };
  const META = {
    'BUV395': { b: 3, g: T.pol }, 'BUV496': { b: 3, g: T.pol }, 'BUV563': { b: 4, g: T.pol }, 'BUV615': { b: 4, g: T.pol }, 'BUV661': { b: 4, g: T.pol }, 'BUV737': { b: 4, g: T.pol }, 'BUV805': { b: 3, g: T.pol },
    'BV421': { b: 5, g: T.pol }, 'BV480': { b: 3, g: T.pol }, 'BV510': { b: 3, g: T.pol }, 'BV570': { b: 2, g: T.pol }, 'BV605': { b: 4, g: T.pol }, 'BV650': { b: 4, g: T.pol }, 'BV711': { b: 4, g: T.pol }, 'BV750': { b: 3, g: T.pol }, 'BV785': { b: 4, g: T.pol, aka: ['BV786'] },
    'BD Horizon V450': { b: 3, g: T.sm, aka: ['V450'] }, 'BD Horizon V500': { b: 2, g: T.sm, aka: ['V500'] },
    'BB515': { b: 5, g: T.pol }, 'BB630': { b: 4, g: T.pol }, 'BB660': { b: 4, g: T.pol }, 'BB700': { b: 4, g: T.pol }, 'BB755': { b: 3, g: T.pol }, 'BB790': { b: 3, g: T.pol },
    'Super Bright 436': { b: 3, g: T.pol, aka: ['SB436'] }, 'Super Bright 600': { b: 3, g: T.pol, aka: ['SB600'] }, 'Super Bright 645': { b: 3, g: T.pol, aka: ['SB645'] }, 'Super Bright 702': { b: 3, g: T.pol, aka: ['SB702'] }, 'Super Bright 780': { b: 3, g: T.pol, aka: ['SB780'] },
    'Pacific Blue': { b: 2, g: T.sm }, 'Pacific Green': { b: 2, g: T.sm }, 'Pacific Orange': { b: 1, g: T.sm }, 'eFluor 450': { b: 2, g: T.sm }, 'eFluor 506': { b: 2, g: T.sm }, 'eFluor 660': { b: 3, g: T.sm },
    'Spark UV 387': { b: 3, g: T.sm }, 'Spark Violet 500': { b: 3, g: T.sm }, 'Spark Violet 538': { b: 3, g: T.sm }, 'Spark Blue 550': { b: 3, g: T.sm }, 'Spark Blue 574': { b: 3, g: T.sm },
    'Spark YG 570': { b: 3, g: T.sm }, 'Spark YG 581': { b: 3, g: T.sm }, 'Spark YG 593': { b: 3, g: T.sm }, 'Spark NIR 685': { b: 3, g: T.sm }, 'Spark Red 718': { b: 3, g: T.sm },
    'RealBlue 670': { b: 4, g: T.pol, aka: ['RB670'] }, 'RB545': { b: 4, g: T.pol }, 'RB613': { b: 4, g: T.pol }, 'RB705': { b: 4, g: T.pol }, 'RB744': { b: 4, g: T.pol }, 'RB780': { b: 4, g: T.pol },
    'RY586': { b: 4, g: T.pol }, 'RY610': { b: 4, g: T.pol }, 'RY703': { b: 4, g: T.pol }, 'RY775': { b: 4, g: T.pol },
    'StarBright Yellow 665': { b: 4, g: T.pol }, 'Kiravia Blue 520': { b: 4, g: T.pol }, 'mFluor Violet 610': { b: 2, g: T.sm },
    'Alexa Fluor 405': { b: 1, g: T.sm, aka: ['AF405'] }, 'Alexa Fluor 430': { b: 1, g: T.sm, aka: ['AF430'] }, 'Alexa Fluor 488': { b: 3, g: T.sm, aka: ['AF488'] }, 'Alexa Fluor 532': { b: 3, g: T.sm, aka: ['AF532'] }, 'Alexa Fluor 546': { b: 3, g: T.sm, aka: ['AF546'] }, 'Alexa Fluor 555': { b: 3, g: T.sm, aka: ['AF555'] }, 'Alexa Fluor 568': { b: 3, g: T.sm, aka: ['AF568'] }, 'Alexa Fluor 594': { b: 3, g: T.sm, aka: ['AF594'] }, 'Alexa Fluor 610': { b: 3, g: T.sm, aka: ['AF610'] }, 'Alexa Fluor 633': { b: 3, g: T.sm, aka: ['AF633'] }, 'Alexa Fluor 647': { b: 4, g: T.sm, aka: ['AF647'] }, 'Alexa Fluor 660': { b: 2, g: T.sm, aka: ['AF660'] }, 'Alexa Fluor 680': { b: 2, g: T.sm, aka: ['AF680'] }, 'Alexa Fluor 700': { b: 1, g: T.sm, aka: ['AF700'] }, 'Alexa Fluor 750': { b: 2, g: T.sm, aka: ['AF750'] }, 'Alexa Fluor 790': { b: 1, g: T.sm, aka: ['AF790'] },
    'FITC': { b: 2, g: T.sm }, 'DyLight 405': { b: 1, g: T.sm }, 'DyLight 649': { b: 3, g: T.sm }, 'DyLight 755': { b: 2, g: T.sm }, 'iFluor 647': { b: 4, g: T.sm }, 'Cy3': { b: 3, g: T.sm }, 'Cy5': { b: 4, g: T.sm }, 'Cy5.5': { b: 2, g: T.sm }, 'Cy7': { b: 2, g: T.sm }, 'Texas Red': { b: 2, g: T.sm },
    'PE': { b: 5, g: T.pbp }, 'PE-Alexa Fluor 610': { b: 4, g: T.tan }, 'PE-Alexa Fluor 700': { b: 3, g: T.tan }, 'PE-CF594': { b: 5, g: T.tan }, 'PE-Dazzle 594': { b: 5, g: T.tan }, 'PE-eFluor 610': { b: 4, g: T.tan }, 'PE-Texas Red': { b: 3, g: T.tan },
    'PE-Cy5': { b: 5, g: T.tan }, 'PE-Cy5.5': { b: 4, g: T.tan }, 'PE-Cy7': { b: 4, g: T.tan }, 'PE-Fire 640': { b: 5, g: T.tan }, 'PE-Fire 700': { b: 4, g: T.tan }, 'PE-Fire 744': { b: 4, g: T.tan }, 'PE-Fire 780': { b: 4, g: T.tan }, 'PE-Fire 810': { b: 3, g: T.tan }, 'PE-Vio770': { b: 4, g: T.tan },
    'PerCP': { b: 2, g: T.pbp }, 'PerCP-Cy5.5': { b: 3, g: T.tan }, 'PerCP-eFluor 710': { b: 3, g: T.tan },
    'APC': { b: 4, g: T.pbp }, 'APC-Alexa Fluor 750': { b: 3, g: T.tan }, 'APC-Cy7': { b: 3, g: T.tan }, 'APC-eFluor 780': { b: 3, g: T.tan }, 'APC-Fire 750': { b: 4, g: T.tan }, 'APC-Fire 810': { b: 3, g: T.tan }, 'APC-H7': { b: 3, g: T.tan }, 'APC-Vio770': { b: 3, g: T.tan }, 'APC-R700': { b: 3, g: T.tan }, 'Alexa Fluor 680-APC': { b: 3, g: T.tan }, 'R718': { b: 3, g: T.sm },
    'Qdot 605': { b: 3, g: T.qd }, 'Qdot 655': { b: 3, g: T.qd }, 'Qdot 705': { b: 3, g: T.qd }, 'Qdot 800': { b: 2, g: T.qd },
    'DAPI': { b: 4, g: T.dna }, '7-AAD': { b: 3, g: T.dna }, 'Propidium Iodide': { b: 4, g: T.dna, aka: ['PI'] }, 'SYTOX Blue': { b: 4, g: T.dna }, 'SYTOX Green': { b: 4, g: T.dna }, 'SYTOX Red': { b: 4, g: T.dna }, 'SYTOX AADvanced': { b: 3, g: T.dna },
    'Calcein AM': { b: 4, g: T.trk }, 'Calcein Violet 450 AM': { b: 3, g: T.trk }, 'CFSE': { b: 5, g: T.trk }, 'CellTrace Violet': { b: 5, g: T.trk }, 'CellTrace Yellow': { b: 4, g: T.trk }, 'CellTrace Far Red': { b: 4, g: T.trk }, 'CPD eFluor 450': { b: 4, g: T.trk }, 'CPD eFluor 670': { b: 4, g: T.trk },
  };
  // v1.1 additions
  const set = (names, m) => names.forEach(n => { META[n] = Object.assign({}, m, META[n] || {}); });
  set(['Alexa Fluor 350', 'CF350', 'CF405S', 'CF405M', 'CF410', 'CF430', 'Cascade Blue', 'Marina Blue', 'iFluor 350', 'DyLight 488', 'Cascade Yellow'], { b: 1, g: T.sm });
  set(['CF405L', 'CF440', 'CF450', 'CF488A', 'CF500', 'CF503R', 'CF514', 'CF532', 'CF543', 'CF550R', 'CF555', 'CF568', 'CF570', 'CF583', 'CF583R', 'CF594', 'CF620R', 'CF633', 'CF640R', 'CF647', 'CF650', 'CF660C', 'CF660R', 'CF680', 'CF680R', 'CF700', 'CF750', 'CF770', 'CF790', 'CF800', 'CF820',
    'Oregon Green 488', 'eFluor 570', 'eFluor 615', 'eFluor 710', 'iFluor 450', 'iFluor 488', 'mFluor Blue 630', 'mFluor Blue 659', 'mFluor Green 620', 'Cy3.5', 'Cy3B', 'TRITC', 'DyLight 550', 'DyLight 633', 'DyLight 680',
    'ATTO 488', 'ATTO 532', 'ATTO 550', 'ATTO 565', 'ATTO 594', 'ATTO 633', 'ATTO 647N', 'ATTO 655', 'ATTO 680', 'ATTO 700'], { b: 3, g: T.sm });
  set(['NovaFluor Blue 510', 'NovaFluor Blue 530', 'NovaFluor Blue 555', 'NovaFluor Blue 585', 'NovaFluor Blue 610/30S', 'NovaFluor Blue 610/70S', 'NovaFluor Blue 660/40S', 'NovaFluor Blue 660/120S',
    'NovaFluor Red 660', 'NovaFluor Red 685', 'NovaFluor Red 700', 'NovaFluor Yellow 570', 'NovaFluor Yellow 610', 'NovaFluor Yellow 660', 'NovaFluor Yellow 690', 'NovaFluor Yellow 700'], { b: 4, g: T.tan });
  set(['Seta-APC-705', 'Seta-APC-780', 'Seta-PerCP-680', 'APC-Astral813', 'RPE-CF647T', 'PerCP-Fire 780'], { b: 3, g: T.tan });
  set(['StarBright UV 795'], { b: 3, g: T.pol, aka: ['SBUV795', 'StarBright UltraViolet 795'] });
  set(['MitoSpy Orange CMTMRos', 'MitoSpy Red CMXRos', 'MitoSpy Green FM', 'MitoSpy NIR DiIC1(5)', 'MitoTracker Green FM', 'MitoTracker Deep Red FM', 'MitoTracker Orange', 'MitoTracker Red', 'TMRE', 'Rhodamine 123'], { b: 4, g: T.fn });
  META['MitoTracker Orange'].aka = ['MitoTracker Orange CMTMRos']; META['MitoTracker Red'].aka = ['MitoTracker Red CMXRos'];
  set(['Hoechst 33342', 'Hoechst 33258', 'DRAQ5', 'DRAQ7', 'SYTOX Orange', 'DyeCycle Violet', 'FxCycle Violet'], { b: 4, g: T.dna });
  set(['Live-or-Dye 405/452', 'Live-or-Dye 405/545', 'Live-or-Dye 488/515', 'Live-or-Dye 640/662', 'Live-or-Dye 750/777',
    'Ghost Dye UV 450', 'Ghost Dye Violet 450', 'Ghost Dye Violet 510', 'Ghost Dye Violet 540', 'Ghost Dye Red 710', 'Ghost Dye Red 780'], { b: 4, g: T.via });
  set(['Calcein Blue AM', 'CellTrace Blue'], { b: 4, g: T.trk });
  set(['Qdot 525', 'Qdot 545', 'Qdot 565', 'Qdot 585', 'Qdot 625'], { b: 3, g: T.qd });
  ['Zombie UV', 'Zombie Violet', 'Zombie Aqua', 'Zombie Green', 'Zombie Yellow', 'Zombie Red', 'Zombie NIR', 'LIVE/DEAD Blue', 'LIVE/DEAD Violet', 'LIVE/DEAD Aqua', 'LIVE/DEAD Green', 'LIVE/DEAD Yellow', 'LIVE/DEAD Red', 'LIVE/DEAD Far Red', 'LIVE/DEAD Near-IR', 'FVD eFluor 455UV', 'FVD eFluor 450', 'FVD eFluor 506', 'FVD eFluor 520', 'FVD eFluor 660', 'FVD eFluor 780']
    .forEach(n => { META[n] = { b: 4, g: T.via }; });

  /* ---------------------------------------------- derived (approximate) dyes */
  // Built from FPbase templates: excitation of a related dye (optionally peak-shifted) and the
  // emission shape of a structurally similar acceptor shifted to the published emission maximum.
  const D = (name, exFrom, emFrom, emPeak, extra) => Object.assign({ name, ex: { from: exFrom }, em: { from: emFrom, peak: emPeak } }, extra || {});
  const polyTrim = (tpl, peak, donor, w, exFrom, name, exPeak) => ({ name, ex: Object.assign({ from: exFrom }, exPeak ? { peak: exPeak } : {}), em: Object.assign({ from: tpl, peak, trim: 0 }, donor ? { add: [{ from: donor, weight: w }] } : {}) });
  const DERIVED = [
    // polymer tandems: acceptor emission from the matching Brilliant Violet tandem, donor residual removed
    Object.assign(polyTrim('BV605', 615, 'BUV395', 0.08, 'BUV563', 'BUV615'), {}),
    polyTrim('BV605', 630, 'BB515', 0.05, 'BB700', 'BB630'),
    polyTrim('BV650', 660, 'BB515', 0.05, 'BB700', 'BB660'),
    polyTrim('BV750', 755, 'BB515', 0.05, 'BB700', 'BB755'),
    polyTrim('BV785', 790, 'BB515', 0.05, 'BB700', 'BB790'),
    polyTrim('BB515', 545, null, 0, 'RealBlue 670', 'RB545'),
    polyTrim('BV605', 613, null, 0, 'RealBlue 670', 'RB613'),
    polyTrim('BV711', 705, null, 0, 'RealBlue 670', 'RB705'),
    polyTrim('BV750', 744, null, 0, 'RealBlue 670', 'RB744'),
    polyTrim('BV785', 780, null, 0, 'RealBlue 670', 'RB780'),
    polyTrim('BV570', 586, null, 0, 'StarBright Yellow 665', 'RY586'),
    polyTrim('BV605', 610, null, 0, 'StarBright Yellow 665', 'RY610'),
    polyTrim('BV711', 703, null, 0, 'StarBright Yellow 665', 'RY703'),
    polyTrim('BV785', 775, null, 0, 'StarBright Yellow 665', 'RY775'),
    // small molecules: shape from a related dye, both maxima moved to published values
    { name: 'Spark UV 387', ex: { from: 'BUV395', peak: 349 }, em: { from: 'BUV395', peak: 387 } },
    { name: 'Spark Violet 500', ex: { from: 'Spark Violet 538' }, em: { from: 'Spark Violet 538', peak: 500 } },
    { name: 'Spark Blue 574', ex: { from: 'Spark Blue 550' }, em: { from: 'Spark Blue 550', peak: 574 } },
    { name: 'Spark YG 570', ex: { from: 'Alexa Fluor 555', peak: 554 }, em: { from: 'Alexa Fluor 555', peak: 570 } },
    { name: 'Spark YG 581', ex: { from: 'Alexa Fluor 555', peak: 571 }, em: { from: 'Alexa Fluor 555', peak: 581 } },
    { name: 'Spark YG 593', ex: { from: 'Alexa Fluor 568', peak: 583 }, em: { from: 'Alexa Fluor 568', peak: 593 } },
    { name: 'Spark NIR 685', ex: { from: 'Alexa Fluor 680', peak: 653 }, em: { from: 'Alexa Fluor 680', peak: 685 } },
    { name: 'Spark Red 718', ex: { from: 'Alexa Fluor 700', peak: 662 }, em: { from: 'Alexa Fluor 700', peak: 718 } },
    { name: 'R718', ex: { from: 'Alexa Fluor 700', peak: 676 }, em: { from: 'Alexa Fluor 700', peak: 718 } },
    // PE / APC tandems: acceptor band moved to the published maximum, donor residual added back
    { name: 'PE-Fire 640', ex: { from: 'PE' }, em: { from: 'Alexa Fluor 633', peak: 640, add: [{ from: 'PE', weight: 0.08 }] } },
    { name: 'PE-Fire 700', ex: { from: 'PE-Cy5.5' }, em: { from: 'PE-Cy5.5', peak: 700, trim: 640 } },
    { name: 'PE-Fire 744', ex: { from: 'PE-Cy7' }, em: { from: 'PE-Cy7', peak: 744, trim: 680, add: [{ from: 'PE', weight: 0.08 }] } },
    { name: 'PE-Fire 810', ex: { from: 'PE-Cy7' }, em: { from: 'PE-Cy7', peak: 810, trim: 680, add: [{ from: 'PE', weight: 0.08 }] } },
    { name: 'PE-Vio770', ex: { from: 'PE-Cy7' }, em: { from: 'PE-Cy7', peak: 775, trim: 680, add: [{ from: 'PE', weight: 0.1 }] } },
    { name: 'APC-Fire 810', ex: { from: 'APC-Cy7' }, em: { from: 'APC-Cy7', peak: 810, trim: 700, add: [{ from: 'APC', weight: 0.06 }] } },
    { name: 'APC-Vio770', ex: { from: 'APC-Cy7' }, em: { from: 'APC-Cy7', peak: 775, trim: 700, add: [{ from: 'APC', weight: 0.08 }] } },
    { name: 'APC-R700', ex: { from: 'APC' }, em: { from: 'Alexa Fluor 680-APC', peak: 704 } },
    // v1.1
    { name: 'NovaFluor Blue 585', ex: { from: 'NovaFluor Blue 555' }, em: { from: 'NovaFluor Blue 555', peak: 585 } },
    { name: 'PerCP-Fire 780', ex: { from: 'PerCP' }, em: { from: 'PE-Fire 780', peak: 780, trim: 700, add: [{ from: 'PerCP', weight: 0.08 }] } },
    { name: 'StarBright UV 795', ex: { from: 'BUV805' }, em: { from: 'BUV805', peak: 795, trim: 700, add: [{ from: 'BUV395', weight: 0.05 }] } },
    { name: 'Ghost Dye UV 450', ex: { from: 'Zombie UV' }, em: { from: 'Zombie UV', peak: 450 } },
    { name: 'Ghost Dye Violet 450', ex: { from: 'Zombie Violet' }, em: { from: 'Zombie Violet', peak: 450 } },
    { name: 'Ghost Dye Violet 510', ex: { from: 'Zombie Aqua' }, em: { from: 'Zombie Aqua', peak: 510 } },
    { name: 'Ghost Dye Violet 540', ex: { from: 'Zombie Aqua' }, em: { from: 'Zombie Aqua', peak: 540 } },
    { name: 'Ghost Dye Red 710', ex: { from: 'LIVE/DEAD Far Red' }, em: { from: 'LIVE/DEAD Far Red', peak: 710 } },
    { name: 'Ghost Dye Red 780', ex: { from: 'Zombie NIR' }, em: { from: 'Zombie NIR', peak: 780 } },
  ];
  // polyTrim used trim:0 as a placeholder; set trim to (template peak − 100 nm) at build time
  DERIVED.forEach(d => { if (d.em.trim === 0) d.em.trimRel = 100; });

  root.SPD_DATA = { INSTRUMENTS: [AURORA_5L, SONY_5L, SONY_7L], META, DERIVED };
})(typeof self !== 'undefined' ? self : this);
