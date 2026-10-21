// Writes signatures of a 27-fluor Aurora panel (simulated, uncalibrated) for the numpy reference.
const { SPD, DATA, lib } = require('../../tools/lib_node.cjs');
const fs = require('node:fs'), path = require('node:path');
const inst = DATA.INSTRUMENTS.find(i => i.id === 'aurora-5l'), dets = SPD.detectors(inst);
const panel = ['BUV395','BUV496','BUV563','BUV615','BUV661','BUV737','BUV805','BV421','BV480','BV510','BV570','BV605','BV650','BV711','BV750','BV785','BB515','PE','PE-Dazzle 594','PE-Cy5','PE-Cy7','APC','APC-Fire 750','Alexa Fluor 700','PerCP-Cy5.5','Spark NIR 685','Zombie NIR'];
const cols = panel.map(n => [...SPD.simulateSignature(lib.get(n), inst, dets).sig].map(v => +v.toFixed(10)));
fs.writeFileSync(path.join(__dirname, 'panel27_signatures.json'), JSON.stringify({ panel, detectors: dets.map(d => d.name), cols }));
