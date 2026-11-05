import fs from 'node:fs';
import { MATERIALS, REFERENCE } from './materials.mjs';
import { verifyInert } from './run.mjs';
const R = JSON.parse(fs.readFileSync('results.json'));
const engine = fs.readFileSync('combustion.mjs', 'utf8').replace(/^export /gm, '');
const v = verifyInert(); const vmax = Math.max(...v.map(r => Math.abs(r.sim - r.analytic) / (r.analytic - 20))) * 100;
const c = (k, q) => R.cases.find(x => x.key === k && x.q === q);
const foam35 = c('foam', 35);
let fm = null; { const f = foam35.series; for (let i = 2; i < f.hrr.length - 2; i++) if (f.hrr[i] > 50 && f.hrr[i] >= f.hrr[i - 1] && f.hrr[i] > f.hrr[i + 1]) { fm = f.hrr[i]; break; } }
const fl = foam35.series.t.filter((_, i) => foam35.series.flaming[i]); const burn = fl[fl.length - 1] - fl[0];
const sp = R.extra;
const DATA = {
  date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  verifyMaxErr: vmax.toFixed(2) + '%', verifyMaxErrShort: vmax.toFixed(1) + '%',
  cases: R.cases.map(({ series, ...x }) => x),
  ref: REFERENCE, extra: R.extra, sweepAll: R.sweepAll,
  moisture: R.moisture.map(m => ({ mc: m.mc, tig: m.tig, peak: m.peak, series: { t: m.series.t, Ts: m.series.Ts } })),
  bottle: R.bottle.map(({ series, ...x }) => x),
  tuned: R.tuned, defaults: MATERIALS,
  chfRef: { pine: 'measured ≈ 10–12 (Spearpoint & Quintiere)', foam: 'FSRI: 5.5 s at 25 kW/m²', pet: 'FSRI 25 kW/m² replicates: 295–1102 s, near critical', cardboard: '', paper: 'free-hanging, cooled on both faces' },
  other: {
    pine: [
      { lab: 'ig', r: sp.southernPine50.tig / 28, note: 'southern pine @50 (W&D), density changed only' },
      { lab: 'pk', r: sp.southernPine50.peak / 154, note: 'same test' },
      { lab: 'ig', r: sp.southernPine35.tig / 87.5, note: 'timbers @35, measured 75–100 s' },
    ],
    foam: [
      { lab: 'ig', r: foam35.tig / 4, note: 'NIST TN 2043 @35' },
      { lab: 'pk1', r: fm / 255, note: `${fm.toFixed(0)} vs 255` },
      { lab: 'pk2', r: foam35.peak / 481, note: `${foam35.peak.toFixed(0)} vs 481` },
      { lab: 'burn', r: burn / 132, note: `${burn.toFixed(0)} vs 132 s` },
      { lab: 'THR', r: foam35.THR / 39.1, note: `${foam35.THR.toFixed(1)} vs 39.1 MJ/m²` },
    ],
  },
  tune: [
    { h: 'Low-flux ignition of wood', tag: 'highest priority', b: `The model needs ${sp.chf.pine.toFixed(1)} kW/m² to ignite pine, but wood ignites down to about 10–12 kW/m² given long enough. Inside a dumpster, burning neighbours irradiate each other in roughly that range, so this sets whether a fire spreads or fizzles. The missing physics is char oxidation: the glowing char surface makes its own heat and can carry smoldering over into flaming. The calibrator's request for a ${(R.calibration.pine['ignition.qFlame'] / 1000).toFixed(0)} kW/m² flame flux on pine, near the top of the range I allowed, points the same way: it's making up for heat the model never generates. Add a char + O₂ reaction, then refit.` },
    { h: 'PET at high heat flux', tag: 'medium', b: `At 75 kW/m² it ignites ${Math.round((1 - c('pet', 75).tig / 39.5) * 100)}% early and the end-of-burn peak runs ${Math.round((c('pet', 75).peak / 781.7 - 1) * 100)}% high. Two likely causes: clear PET absorbs radiation in depth, not only at the surface, which delays ignition at high flux, and that late peak is partly the cone's insulated backing. Bottles in a dumpster drip instead of sitting on board, as the drip test shows, so give in-depth absorption priority over the peak. Flame flux also hit the top of its range here (${(R.calibration.pet['ignition.qFlame'] / 1000).toFixed(0)} kW/m²).` },
    { h: 'Cardboard is not a uniform slab', tag: 'medium', b: `Treating corrugated board as a uniform slab ignites ${Math.round((1 - c('cardboard', 50).tig / 7.3) * 100)}–${Math.round((1 - c('cardboard', 75).tig / 3.7) * 100)}% early at 50–75 kW/m², and the activation energy pinned at the 250 kJ/mol bound. Real board is thin liners over air-filled flutes. Model it as liner / air gap / liner layers, which the node stack already supports, and the same stack covers boxes and pizza boxes.` },
    { h: 'Foam melt pool burns too hard', tag: 'medium', b: `At 75 kW/m² the peak runs ${Math.round((c('foam', 75).peak / 1291.6 - 1) * 100)}% high. Against NIST's 35 kW/m² test the second peak is ${Math.round((foam35.peak / 481 - 1) * 100)}% high and flaming ends ${Math.round((1 - burn / 132) * 100)}% early (${burn.toFixed(0)} vs 132 s), while total heat (${foam35.THR.toFixed(1)} vs 39.1 MJ/m²) and the first peak (${fm.toFixed(0)} vs 255) match. The pool burns too hard and too fast, because all the melt lands in one hot layer. Spreading or soaking the pool, and in 3‑D letting it flow across the dumpster floor, should fix both.` },
    { h: "Dense wood's first peak", tag: 'low', b: `Changing only density and thickness to match White & Dietenberger's southern pine gets ignition about right (${sp.southernPine50.tig.toFixed(1)} vs 28 s at 50 kW/m²), but the first peak comes out about ${(sp.southernPine50.peak / 154).toFixed(1)}× theirs (${sp.southernPine50.peak.toFixed(0)} vs 154). That could be char forming too slowly or a lab difference in retainer frame and ignition criterion. Worth one more dataset before trusting peaks for hardwoods.` },
    { h: 'Paper has no reference yet', tag: 'data gap', b: `The sheet is a prediction only: ${c('paper', 25).tig.toFixed(1)} s to ignite at 25 kW/m², under 3 s at 50 and above. It needs a free-hanging single-sheet test to check against. Paper is also mostly lit by direct flame contact, so the 3‑D layer should hand it the flame's local flux, not a fixed radiant level.` },
  ],
  solid: [
    `The heat conduction solver is within ${vmax.toFixed(1)}% of the analytic solution, and energy closes: each sample releases exactly its fuel load.`,
    `Thick-solid ignition holds across fluxes: pine at the held-out 75 kW/m² lands within ${Math.round((c('pine', 75).tig / 6.4 - 1) * 100)}% on ignition and ${Math.round((c('pine', 75).peak / 337.5 - 1) * 100)}% on peak, after fitting only at 25 and 50.`,
    `PET's late peak arrives ${c('pet', 50).tPeakAfterIg.toFixed(0)} s after ignition, against FSRI's 217 s, purely from heat reaching the insulated back. Nothing was fit to that timing.`,
    `The mechanisms come out right: moisture delays ignition (pine at 35 kW/m² goes from ${R.moisture[0].tig.toFixed(0)} s dry to ${R.moisture[3].tig.toFixed(0)} s at 30% water); PU foam collapses into a burning pool that gives two peaks; char insulates wood so its burning rate falls after the first peak; and molten PET drips away before it ignites.`,
  ],
};
let html = fs.readFileSync('template.html', 'utf8').replace('/*__ENGINE__*/', () => engine).replace('/*__DATA__*/', () => JSON.stringify(DATA));
fs.writeFileSync('../index.html', html);
console.log('wrote', html.length, 'bytes; verify max err', vmax.toFixed(3) + '%', 'foam pk1', fm, 'burn', burn);
