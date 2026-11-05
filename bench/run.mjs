import { runCone, Slab, SIGMA, T_AMB } from './combustion.mjs';
import { MATERIALS, REFERENCE } from './materials.mjs';
import fs from 'node:fs';

export function summarize(mats, fluxes = [25, 35, 50, 75], tag = '') {
  const rows = [];
  for (const key of Object.keys(mats)) {
    const mat = mats[key];
    const opts = key === 'paper' ? { back: 'exposed', tEnd: 300, dt: 0.005, every: 0.05 } : { tEnd: key === 'pet' ? 2400 : 1800 };
    for (const q of fluxes) {
      const r = runCone(mat, q, opts);
      const ref = REFERENCE[key];
      const rt = ref?.tig?.[q]?.[0] ?? null, rp = ref?.peak?.[q]?.[0] ?? null;
      rows.push({ key, q, tig: r.tig, refTig: rt, peak: r.peakHRR, refPeak: rp, tPk: r.tPeakAfterIg, THR: r.THR, burnout: r.burnout, dripped: r.dripped });
    }
  }
  const f = (x, d = 1) => (x === null || x === undefined) ? '—' : (+x).toFixed(d);
  console.log(`\n=== ${tag} ===`);
  console.log('mat        q   tig_sim  tig_ref   ratio | peak_sim peak_ref ratio | tPk  THR(MJ/m2) burnout');
  for (const r of rows) {
    const rt = r.refTig ? f(r.tig / r.refTig, 2) : '';
    const rp = r.refPeak ? f(r.peak / r.refPeak, 2) : '';
    console.log(`${r.key.padEnd(10)} ${String(r.q).padStart(2)}  ${f(r.tig).padStart(7)}  ${f(r.refTig).padStart(7)}  ${rt.padStart(6)} | ${f(r.peak, 0).padStart(7)} ${f(r.refPeak, 0).padStart(7)}  ${rp.padStart(5)} | ${f(r.tPk).padStart(5)} ${f(r.THR, 1).padStart(6)} ${f(r.burnout, 0).padStart(6)}`);
  }
  return rows;
}

// --- verification: inert semi-infinite solid, constant absorbed flux, no losses ---
export function verifyInert() {
  const inert = {
    key: 'inert', solid: 's', thickness: 0.1, components: { s: { rho: 500, k: 0.1, cp: 1500, absorb: 1, eps: 1e-9 } },
    reactions: [], phase: [], dHc: 0, ignition: { mCrit: 1e9, qFlame: 0 },
  };
  const s = new Slab(inert, { nodes: 120, h: 0 });
  const q = 20e3; const kpc = 0.1 * 500 * 1500;
  const out = [];
  for (let i = 1; i <= 1200; i++) {
    s.step(0.05, q);
    if (i % 200 === 0) {
      const t = s.t;
      const analytic = T_AMB + 2 * q * Math.sqrt(t / (Math.PI * kpc));
      out.push({ t, sim: s.lastTs - 273.15, analytic: analytic - 273.15 });
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Verification (inert semi-infinite, 20 kW/m², no losses): surface °C');
  for (const r of verifyInert()) console.log(`  t=${r.t.toFixed(0)}s sim=${r.sim.toFixed(1)} analytic=${r.analytic.toFixed(1)} err=${(100 * (r.sim - r.analytic) / (r.analytic - 20)).toFixed(2)}%`);
  const rows = summarize(MATERIALS, [25, 35, 50, 75], 'physics defaults (untuned)');
  fs.writeFileSync('defaults_rows.json', JSON.stringify(rows, null, 1));
}
