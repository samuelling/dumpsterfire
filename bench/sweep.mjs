import { runCone } from './combustion.mjs';
import fs from 'node:fs';
const R = JSON.parse(fs.readFileSync('results.json'));
const T = R.tuned; const qs = [10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 50, 60, 75, 90];
const sw = {};
for (const k of ['pine', 'foam', 'pet', 'cardboard', 'paper']) {
  sw[k] = qs.map(q => { const o = k === 'paper' ? { back: 'exposed', dt: 0.005, tEnd: 300, every: 5 } : { dt: 0.1, tEnd: 2400, every: 10 };
    const r = runCone(T[k], q, o); return { q, tig: r.tig, peak: r.peakHRR }; });
  console.log(k, sw[k].map(x => `${x.q}:${x.tig ? x.tig.toFixed(1) : '—'}/${x.peak.toFixed(0)}`).join(' '));
}
R.sweepAll = sw; fs.writeFileSync('results.json', JSON.stringify(R));
console.log('size', fs.statSync('results.json').size);
