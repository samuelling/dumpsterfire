// final.mjs — apply calibration, run training + held-out cases, write results.json
import { runCone } from './combustion.mjs';
import { MATERIALS, REFERENCE } from './materials.mjs';
import fs from 'node:fs';

const clone = o => JSON.parse(JSON.stringify(o));
function set(o, path, v) {
  const p = path.split('.');
  const rec = (x, i) => {
    if (i === p.length - 1) { if (p[i] === '*') x.forEach((_, j) => x[j] = v); else x[p[i]] = v; return; }
    if (p[i] === '*') x.forEach(y => rec(y, i + 1)); else rec(x[p[i]], i + 1);
  };
  rec(o, 0);
}
const CAL = {};
for (const k of ['pine', 'cardboard', 'foam', 'pet']) CAL[k] = JSON.parse(fs.readFileSync(`calib_${k}.json`)).tuned;
CAL.paper = { 'ignition.mCrit': CAL.cardboard['ignition.mCrit'], 'ignition.qFlame': CAL.cardboard['ignition.qFlame'], 'reactions.0.E': CAL.cardboard['reactions.0.E'], 'reactions.0.Tp': CAL.cardboard['reactions.0.Tp'] };

const tuned = {};
for (const k in MATERIALS) { tuned[k] = clone(MATERIALS[k]); for (const p in CAL[k] || {}) set(tuned[k], p, CAL[k][p]); }

const ds = (s, n = 400) => { // downsample series for the page
  const step = Math.max(1, Math.ceil(s.t.length / n)); const o = {};
  for (const key in s) o[key] = s[key].filter((_, i) => i % step === 0).map(v => +(+v).toFixed(3));
  return o;
};
const opt = k => k === 'paper' ? { back: 'exposed', tEnd: 120, dt: 0.005, every: 0.05 } : { tEnd: k === 'pet' ? 2400 : 1500, dt: 0.05, every: 0.5 };

const out = { cases: [], scenarios: [], calibration: CAL, defaults: JSON.parse(fs.readFileSync('defaults_rows.json')) };
for (const k of ['pine', 'foam', 'pet', 'cardboard', 'paper']) {
  for (const q of [25, 35, 50, 75]) {
    const r = runCone(tuned[k], q, opt(k));
    const ref = REFERENCE[k];
    out.cases.push({ key: k, q, split: ref && ref.tig[q] ? (q === 75 ? 'held-out' : 'train') : (q === 35 && ref ? 'held-out (other lab)' : 'prediction'),
      tig: r.tig, peak: r.peakHRR, tPeakAfterIg: r.tPeakAfterIg, THR: r.THR, burnout: r.burnout, series: ds(r.series) });
  }
}
// scenarios: thin-vs-thick ignition sweep (pine block vs paper) and moisture / drip effects
const sweep = [];
for (const q of [15, 20, 25, 30, 40, 50, 60, 75]) {
  const rp = runCone(tuned.pine, q, { tEnd: 1500, dt: 0.1, every: 5 });
  const rs = runCone(tuned.paper, q, { back: 'exposed', tEnd: 200, dt: 0.005, every: 1 });
  sweep.push({ q, pine: rp.tig, paper: rs.tig });
}
out.sweep = sweep;
// moisture: pine at 35 kW/m², 0 / 9 / 20 / 30 % moisture
out.moisture = [0, 0.09, 0.2, 0.3].map(mc => { const r = runCone(tuned.pine, 35, { moisture: mc, tEnd: 1200, dt: 0.1, every: 1 }); return { mc, tig: r.tig, peak: r.peakHRR, series: ds(r.series, 300) }; });
// PET bottle wall (0.3 mm), vertical: drip on vs off
out.bottle = [25, 50].flatMap(q => [false, true].map(drip => {
  const r = runCone(tuned.pet, q, { thickness: 3e-4, drip, back: 'exposed', tEnd: 300, dt: 0.01, every: 0.1, nodes: 30 });
  return { q, drip, tig: r.tig, peak: r.peakHRR, THR: r.THR, dripped: r.dripped, series: ds(r.series, 300) };
}));
out.tuned = tuned;
fs.writeFileSync('results.json', JSON.stringify(out));

// console report
const f = (x, d = 1) => x == null ? '—' : (+x).toFixed(d);
console.log('mat        q  split                 tig  ref   ratio |  peak   ref  ratio');
for (const c of out.cases) {
  const ref = REFERENCE[c.key]; const rt = ref?.tig[c.q]?.[0], rp = ref?.peak[c.q]?.[0];
  console.log(`${c.key.padEnd(10)} ${c.q}  ${c.split.padEnd(20)} ${f(c.tig).padStart(6)} ${f(rt).padStart(6)} ${rt ? f(c.tig / rt, 2).padStart(5) : '     '} | ${f(c.peak, 0).padStart(5)} ${f(rp, 0).padStart(5)} ${rp ? f(c.peak / rp, 2).padStart(5) : ''}  THR ${f(c.THR)} tPk ${f(c.tPeakAfterIg)}`);
}
console.log('sweep', JSON.stringify(sweep));
console.log('moisture', JSON.stringify(out.moisture.map(m => ({ mc: m.mc, tig: m.tig, peak: m.peak }))));
console.log('bottle', JSON.stringify(out.bottle.map(b => ({ q: b.q, drip: b.drip, tig: b.tig, peak: b.peak, THR: b.THR, dripped: b.dripped }))));
// NIST foam @35 check: find PHRR1 (first local max) and burn duration
const foam35 = out.cases.find(c => c.key === 'foam' && c.q === 35).series;
let firstMax = null; for (let i = 2; i < foam35.hrr.length - 2; i++) if (foam35.hrr[i] > 50 && foam35.hrr[i] >= foam35.hrr[i - 1] && foam35.hrr[i] > foam35.hrr[i + 1]) { firstMax = [foam35.t[i], foam35.hrr[i]]; break; }
const flam = foam35.t.filter((_, i) => foam35.flaming[i]); console.log('foam35 first max', firstMax, 'flaming duration', flam.length ? (flam[flam.length - 1] - flam[0]).toFixed(0) : null);
