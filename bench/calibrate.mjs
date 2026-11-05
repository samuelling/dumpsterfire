// calibrate.mjs <material> — bounded coordinate search on 25 & 50 kW/m² only.
// 75 kW/m² (FSRI) and the independent 35 kW/m² sources stay held out for validation.
import { runCone } from './combustion.mjs';
import { MATERIALS, REFERENCE } from './materials.mjs';
import fs from 'node:fs';

const KNOBS = {
  pine: [
    ['ignition.mCrit', 1.0e-3, 5e-3], ['ignition.qFlame', 10e3, 40e3],
    ['reactions.0.E', 80e3, 250e3], ['reactions.0.Tp', 590, 680],
  ],
  cardboard: [
    ['ignition.mCrit', 1.0e-3, 5e-3], ['ignition.qFlame', 10e3, 40e3],
    ['reactions.0.E', 80e3, 250e3], ['reactions.0.Tp', 590, 680],
  ],
  foam: [
    ['ignition.mCrit', 0.5e-3, 5e-3], ['ignition.qFlame', 10e3, 40e3],
    ['reactions.1.dH', 0.2e6, 2.5e6], ['ignition.tDelay', 0.2, 3.0],
  ],
  pet: [
    ['ignition.mCrit', 0.5e-3, 5e-3], ['ignition.qFlame', 10e3, 40e3],
    ['reactions.*.dH', 0.2e6, 2.0e6], ['reactions.*.E', 150e3, 280e3],
  ],
};

const clone = o => JSON.parse(JSON.stringify(o));
function get(o, path) { const p = path.split('.'); let x = o; for (const k of p) x = x[k === '*' ? 0 : k]; return x; }
function set(o, path, v) {
  const p = path.split('.');
  const rec = (x, i) => {
    if (i === p.length - 1) { if (p[i] === '*') x.forEach((_, j) => x[j] = v); else x[p[i]] = v; return; }
    if (p[i] === '*') x.forEach(y => rec(y, i + 1)); else rec(x[p[i]], i + 1);
  };
  rec(o, 0);
}

function loss(mat, key, fluxes = [25, 50]) {
  const ref = REFERENCE[key]; let L = 0; const detail = [];
  for (const q of fluxes) {
    const r = runCone(mat, q, { dt: 0.1, every: 2, tEnd: key === 'pet' ? 2000 : 900 });
    const tig = r.tig ?? 3000;
    const wT = (key === 'pet' && q === 25) ? 0.4 : 1.0; // PET@25 replicates span 295–1102 s
    L += wT * Math.log(tig / ref.tig[q][0]) ** 2 + Math.log(Math.max(r.peakHRR, 1) / ref.peak[q][0]) ** 2;
    detail.push({ q, tig: r.tig, peak: r.peakHRR });
  }
  return { L, detail };
}

const key = process.argv[2];
let mat = clone(MATERIALS[key]);
let best = loss(mat, key);
console.log(key, 'start', best.L.toFixed(3), JSON.stringify(best.detail));
const knobs = KNOBS[key];
const steps = knobs.map(() => 0.25);
let evals = 0;
for (let pass = 0; pass < 12 && evals < 140; pass++) {
  let improved = false;
  knobs.forEach(([path, lo, hi], i) => {
    for (const dir of [+1, -1]) {
      const cur = get(mat, path);
      const isTemp = path.endsWith('Tp');
      let v = isTemp ? cur + dir * steps[i] * 40 : cur * (1 + dir * steps[i]);
      v = Math.min(hi, Math.max(lo, v));
      if (v === cur) continue;
      const trial = clone(mat); set(trial, path, v);
      const res = loss(trial, key); evals++;
      if (res.L < best.L - 1e-4) { mat = trial; best = res; improved = true; break; }
    }
  });
  if (!improved) steps.forEach((s, i) => steps[i] = s * 0.5);
  console.log(key, 'pass', pass, 'L', best.L.toFixed(4), knobs.map(([p]) => `${p}=${(+get(mat, p)).toPrecision(3)}`).join(' '));
  if (Math.max(...steps) < 0.02) break;
}
const tuned = {};
for (const [p] of knobs) tuned[p] = get(mat, p);
fs.writeFileSync(`calib_${key}.json`, JSON.stringify({ key, loss: best.L, tuned, detail: best.detail, evals }, null, 1));
console.log(key, 'done', JSON.stringify(tuned));
