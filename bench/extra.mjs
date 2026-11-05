import { runCone } from './combustion.mjs';
import fs from 'node:fs';
const R = JSON.parse(fs.readFileSync('results.json'));
const T = R.tuned;
function chf(mat, opts, tEnd) { let lo = 5, hi = 30; for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; const r = runCone(mat, m, { ...opts, tEnd, dt: opts.dt ?? 0.1, every: 10 }); if (r.tig) hi = m; else lo = m; } return hi; }
const out = {};
out.chf = { pine: chf(T.pine, {}, 1800), cardboard: chf(T.cardboard, {}, 1800), foam: chf(T.foam, {}, 1200), pet: chf(T.pet, {}, 1800), paper: chf(T.paper, { back: 'exposed', dt: 0.005 }, 300) };
// southern pine (denser) — change density/thickness only
const sp = JSON.parse(JSON.stringify(T.pine)); sp.components.wood.rho = 510; sp.components.char.rho = 0.22 * 510; sp.thickness = 0.016;
const r = runCone(sp, 50, { tEnd: 900 }); out.southernPine50 = { tig: r.tig, peak: r.peakHRR };
const r35 = runCone(sp, 35, { tEnd: 900 }); out.southernPine35 = { tig: r35.tig, peak: r35.peakHRR };
console.log(JSON.stringify(out, null, 1));
R.extra = out; fs.writeFileSync('results.json', JSON.stringify(R));
