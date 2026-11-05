// combustion.mjs — 1D solid-phase fire model for the dumpster-fire test bench
// ---------------------------------------------------------------------------
// One object (or one face of an object) = a stack of thin nodes, surface first.
// Each node holds masses (kg/m²) of components (virgin solid, water, melt, char, …)
// and a temperature. Per time step:
//   1. implicit 1-D conduction, with a nonlinear radiating/convecting surface
//   2. phase changes at fixed temperatures (water boils, PET melts) — enthalpy clamp
//   3. Arrhenius pyrolysis reactions → fuel gas + char/liquid residues
//   4. bookkeeping: foam-collapse liquid drains to a pool, molten surface can drip,
//      empty nodes are merged, a thick surface node is split for resolution
// Gas leaves instantly. Piloted ignition when fuel mass flux ≥ m''crit;
// once flaming, the flame adds q''fl to the surface. HRR = m'' · ΔHc.
// No game-engine dependencies: runs in Node and the browser.

export const SIGMA = 5.670374e-8;
export const RGAS = 8.314;
export const T_AMB = 293.15;
const BETA_TGA = 10 / 60; // K/s — reference heating rate for quoting TGA peak temps

// Arrhenius A from activation energy E and the TGA peak temperature Tp (K) at 10 K/min.
// For a first-order reaction the peak of the rate satisfies E·β/(R·Tp²) = A·exp(−E/(R·Tp)).
export function arrheniusA(E, Tp, beta = BETA_TGA) {
  return (E * beta) / (RGAS * Tp * Tp) * Math.exp(E / (RGAS * Tp));
}

function cpOf(c, T) { return c.cp + (c.cpSlope || 0) * (T - T_AMB); }
function kOf(c, T) {
  let k = c.k + (c.kSlope || 0) * (T - T_AMB) + (c.kRad || 0) * T * T * T;
  if (c.kMax) k = Math.min(k, c.kMax);
  return Math.max(k, 1e-3);
}

export class Slab {
  /**
   * @param {object} mat     material definition (see materials.mjs)
   * @param {object} opts    { thickness (m), back: 'insulated'|'exposed', drip: bool,
   *                           moisture (override, kg water / kg dry solid), nodes }
   */
  constructor(mat, opts = {}) {
    this.mat = mat;
    this.comps = mat.components;
    this.opts = Object.assign({ back: 'insulated', drip: false, h: 10 }, opts);
    const L = opts.thickness ?? mat.thickness;
    this.L0 = L;
    // reactions: precompute A
    this.reactions = (mat.reactions || []).map(r => ({ ...r, A: r.A ?? arrheniusA(r.E, r.Tp) }));
    this.phase = mat.phase || [];
    // initial composition per unit volume
    const mc = opts.moisture ?? mat.moisture ?? 0;
    const solid = mat.solid; // virgin component name
    const rhoDry = this.comps[solid].rho;
    // geometric grid, fine at the surface
    const n = opts.nodes ?? 60;
    const d0 = Math.min(L / n, 5e-5);
    let g = 1.0;
    if (L / n > d0) { // find growth factor so that sum = L
      let lo = 1.0, hi = 2.0;
      for (let it = 0; it < 80; it++) {
        const mid = 0.5 * (lo + hi);
        const s = d0 * (Math.pow(mid, n) - 1) / (mid - 1);
        if (s > L) hi = mid; else lo = mid;
      }
      g = 0.5 * (lo + hi);
    }
    this.nodes = [];
    let used = 0;
    for (let i = 0; i < n; i++) {
      let d = (g === 1.0) ? L / n : d0 * Math.pow(g, i);
      if (i === n - 1) d = L - used;
      used += d;
      const m = {};
      for (const k in this.comps) m[k] = 0;
      m[solid] = rhoDry * d;
      // water occupies pore space: count its mass, not its volume
      m.water = (this.comps.water ? mc * rhoDry * d : 0);
      this.nodes.push({ m, T: T_AMB, dPore: this.comps.water ? d : 0 });
    }
    this.t = 0;
    this.flaming = false;
    this.ignitedAt = null;
    this.dripped = 0;
    this.pooled = 0;
    this.everIgnited = false;
    this.m0 = this.totalMass();
  }

  // thickness of a node: volumes of solids/liquids; water lives in pores (no volume)
  thick(nd) {
    let v = 0;
    for (const k in nd.m) { const c = this.comps[k]; if (c && !c.inPores) v += nd.m[k] / c.rho; }
    return v;
  }
  heatCap(nd) {
    let C = 0;
    for (const k in nd.m) if (nd.m[k] > 0) C += nd.m[k] * cpOf(this.comps[k], nd.T);
    return C;
  }
  cond(nd) {
    let v = 0, kv = 0;
    for (const k in nd.m) {
      const c = this.comps[k]; if (!c || c.inPores || nd.m[k] <= 0) continue;
      const vi = nd.m[k] / c.rho; v += vi; kv += vi * kOf(c, nd.T);
    }
    return v > 0 ? kv / v : 0.05;
  }
  surfProp(nd, key) { // volume-weighted surface radiative property
    let v = 0, s = 0;
    for (const k in nd.m) {
      const c = this.comps[k]; if (!c || c.inPores || nd.m[k] <= 0) continue;
      const vi = nd.m[k] / c.rho; v += vi; s += vi * (c[key] ?? 0.9);
    }
    return v > 0 ? s / v : 0.9;
  }
  totalMass() { let s = 0; for (const nd of this.nodes) for (const k in nd.m) s += nd.m[k]; return s + this.pooledMassInNodes(); }
  pooledMassInNodes() { return 0; }
  fuelLeft() {
    let s = 0;
    for (const nd of this.nodes) for (const k in nd.m) if (this.comps[k] && this.comps[k].fuel) s += nd.m[k];
    return s;
  }

  // ---- one time step --------------------------------------------------------------
  step(dt, qExt, Tamb = T_AMB) {
    const N = this.nodes.length;
    if (N === 0) return { mdot: 0, hrr: 0, Ts: Tamb };
    const mat = this.mat;
    const h = this.opts.h;
    const qFl = this.flaming ? mat.ignition.qFlame : 0;

    // conductances
    const C = new Float64Array(N), G = new Float64Array(N), dd = new Float64Array(N), kk = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const nd = this.nodes[i];
      C[i] = Math.max(this.heatCap(nd), 1e-6);
      dd[i] = Math.max(this.thick(nd), 1e-9);
      kk[i] = this.cond(nd);
    }
    for (let i = 0; i < N - 1; i++) G[i] = 1 / (dd[i] / (2 * kk[i]) + dd[i + 1] / (2 * kk[i + 1]));

    // surface energy balance (zero-capacity surface between gas and node 0)
    const top = this.nodes[0];
    const alpha = this.surfProp(top, 'absorb');
    const eps = this.surfProp(top, 'eps');
    const Gs = 2 * kk[0] / dd[0];
    const T0 = top.T;
    let Ts = T0;
    const qIn = alpha * qExt + qFl; // flame flux assumed fully absorbed
    for (let it = 0; it < 30; it++) {
      const f = qIn - eps * SIGMA * (Ts ** 4 - Tamb ** 4) - h * (Ts - Tamb) - Gs * (Ts - T0);
      const df = -4 * eps * SIGMA * Ts ** 3 - h - Gs;
      const dT = -f / df; Ts += dT;
      if (Math.abs(dT) < 1e-6) break;
    }
    const hrTop = 4 * eps * SIGMA * Ts ** 3 + h;
    const qStar = Gs * (Ts - T0);
    const sTop = -Gs * hrTop / (Gs + hrTop);

    // back boundary
    let qBack = 0, sBack = 0;
    if (this.opts.back === 'exposed') {
      const nb = this.nodes[N - 1];
      const epsb = this.surfProp(nb, 'eps');
      const Tb = nb.T;
      qBack = -(epsb * SIGMA * (Tb ** 4 - Tamb ** 4) + h * (Tb - Tamb));
      sBack = -(4 * epsb * SIGMA * Tb ** 3 + h);
    }

    // tridiagonal: a_i T_{i-1} + b_i T_i + c_i T_{i+1} = r_i
    const a = new Float64Array(N), b = new Float64Array(N), c = new Float64Array(N), r = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const Ti = this.nodes[i].T;
      b[i] = C[i] / dt; r[i] = C[i] / dt * Ti;
      if (i > 0) { a[i] = -G[i - 1]; b[i] += G[i - 1]; }
      if (i < N - 1) { c[i] = -G[i]; b[i] += G[i]; }
    }
    // top: q = qStar + sTop (T0' − T0)
    b[0] -= sTop; r[0] += qStar - sTop * T0;
    // bottom
    if (N === 1) { b[0] -= sBack; r[0] += qBack - sBack * this.nodes[0].T; }
    else { b[N - 1] -= sBack; r[N - 1] += qBack - sBack * this.nodes[N - 1].T; }
    // Thomas
    for (let i = 1; i < N; i++) { const w = a[i] / b[i - 1]; b[i] -= w * c[i - 1]; r[i] -= w * r[i - 1]; }
    const Tn = new Float64Array(N);
    Tn[N - 1] = r[N - 1] / b[N - 1];
    for (let i = N - 2; i >= 0; i--) Tn[i] = (r[i] - c[i] * Tn[i + 1]) / b[i];
    for (let i = 0; i < N; i++) this.nodes[i].T = Tn[i];

    // phase changes (enthalpy clamp): water → vapour, solid → melt
    for (const nd of this.nodes) {
      for (const p of this.phase) {
        if (nd.m[p.from] > 0 && nd.T > p.T) {
          const Cn = this.heatCap(nd);
          const excess = (nd.T - p.T) * Cn;
          const dm = Math.min(nd.m[p.from], excess / p.L);
          nd.m[p.from] -= dm;
          if (p.to) nd.m[p.to] = (nd.m[p.to] || 0) + dm;
          nd.T = p.T + (excess - dm * p.L) / Math.max(this.heatCap(nd), 1e-9);
        }
      }
    }

    // pyrolysis
    let gas = 0;
    for (const nd of this.nodes) {
      for (const rx of this.reactions) {
        const m = nd.m[rx.from]; if (!(m > 0)) continue;
        const kr = rx.A * Math.exp(-rx.E / (RGAS * nd.T));
        if (kr * dt < 1e-14) continue;
        let dm = m * (1 - Math.exp(-kr * dt));
        if (rx.dH > 0) { // energy-limited: an endothermic step cannot cool its node below ~Tp − 150 K
          const room = this.heatCap(nd) * (nd.T - (rx.Tp - 150));
          dm = Math.max(0, Math.min(dm, room / rx.dH));
        }
        nd.m[rx.from] -= dm;
        for (const prod in rx.products) {
          const y = rx.products[prod] * dm;
          if (prod === 'gas') gas += y; else nd.m[prod] = (nd.m[prod] || 0) + y;
        }
        const Cn = this.heatCap(nd);
        nd.T -= dm * (rx.dH || 0) / Math.max(Cn, 1e-9);
      }
    }
    const mdot = gas / dt; // kg/m²/s of fuel gas

    // drainage of foam-collapse liquid to a pool at the bottom
    const drainKeys = Object.keys(this.comps).filter(k => this.comps[k].drains);
    if (drainKeys.length) {
      let last = this.nodes[this.nodes.length - 1];
      if (!last.pool) { last = { m: Object.fromEntries(Object.keys(this.comps).map(k => [k, 0])), T: last.T, pool: true }; this.nodes.push(last); }
      for (let i = 0; i < this.nodes.length - 1; i++) {
        const nd = this.nodes[i];
        for (const k of drainKeys) {
          const dm = nd.m[k]; if (!(dm > 0)) continue;
          const cl = dm * cpOf(this.comps[k], nd.T), cp0 = this.heatCap(last);
          last.T = (cp0 * last.T + cl * nd.T) / (cp0 + cl);
          last.m[k] += dm; nd.m[k] = 0; this.pooled += dm;
        }
      }
    }

    // dripping of molten surface material (vertical objects)
    if (this.opts.drip) {
      while (this.nodes.length > 1) {
        const nd = this.nodes[0];
        let vMol = 0, v = 0;
        for (const k in nd.m) { const c = this.comps[k]; if (!c || c.inPores) continue; const vi = nd.m[k] / c.rho; v += vi; if (c.molten) vMol += vi; }
        if (v > 0 && vMol / v > 0.5) { for (const k in nd.m) if (this.comps[k] && !this.comps[k].inPores) this.dripped += nd.m[k]; this.nodes.shift(); }
        else break;
      }
    }

    this.remesh();

    // ignition / extinction (piloted)
    const ig = mat.ignition;
    if (!this.flaming) {
      if (mdot >= ig.mCrit) {
        this.aboveFor = (this.aboveFor || 0) + dt;
        if (this.aboveFor >= (ig.tDelay ?? 0.5)) { this.flaming = true; if (this.ignitedAt === null) this.ignitedAt = this.t + dt; this.everIgnited = true; }
      } else this.aboveFor = 0;
    } else if (mdot < ig.mCrit * (ig.extFrac ?? 0.5)) { this.flaming = false; this.aboveFor = 0; }
    const hrr = this.flaming ? mdot * mat.dHc : 0;
    this.t += dt;
    this.lastTs = Ts;
    return { mdot, hrr, Ts };
  }

  remesh() {
    // merge vanishing nodes
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i];
      if (this.nodes.length > 1 && this.thick(nd) < 2e-7 && !(nd.pool && this.thick(nd) > 0)) {
        const j = (i === 0) ? 1 : i - 1;
        const nb = this.nodes[j];
        const C1 = this.heatCap(nd), C2 = this.heatCap(nb);
        for (const k in nd.m) nb.m[k] = (nb.m[k] || 0) + nd.m[k];
        if (C1 + C2 > 0) nb.T = (C1 * nd.T + C2 * nb.T) / (C1 + C2);
        if (nd.pool) nb.pool = true;
        this.nodes.splice(i, 1); i--;
      }
    }
    // keep the surface node thin so the surface temperature stays resolved
    const dMax = 1e-4;
    let guard = 0;
    while (this.nodes.length && this.thick(this.nodes[0]) > dMax && guard++ < 8) {
      const nd = this.nodes[0];
      const half = { m: {}, T: nd.T, pool: nd.pool };
      for (const k in nd.m) { half.m[k] = nd.m[k] / 2; nd.m[k] /= 2; }
      this.nodes.unshift(half);
    }
    if (this.nodes.length > 400) { // coarsen deep nodes if needed
      const a = this.nodes[this.nodes.length - 2], b = this.nodes[this.nodes.length - 1];
      if (!b.pool) { const C1 = this.heatCap(a), C2 = this.heatCap(b); for (const k in b.m) a.m[k] += b.m[k]; a.T = (C1 * a.T + C2 * b.T) / (C1 + C2); this.nodes.pop(); }
    }
  }

  // depth (m) from current surface to where virgin solid is still >50% of the solid volume
  charDepth() {
    let depth = 0;
    for (const nd of this.nodes) {
      const tk = this.thick(nd); let vs = 0;
      for (const k in nd.m) { const c = this.comps[k]; if (c && c.fuel && !c.drains && !c.inPores) vs += nd.m[k] / c.rho; }
      if (tk > 0 && vs / tk > 0.5) break; depth += tk;
    }
    return depth;
  }
  thickness() { let s = 0; for (const nd of this.nodes) s += this.thick(nd); return s; }
  sum(key) { let s = 0; for (const nd of this.nodes) s += nd.m[key] || 0; return s; }
}

// Run a cone-calorimeter-style exposure and return a time series + summary.
export function runCone(mat, qExtKW, opts = {}) {
  const dt = opts.dt ?? 0.05;
  const tEnd = opts.tEnd ?? 1800;
  const every = opts.every ?? 0.5;
  const s = new Slab(mat, opts);
  const series = { t: [], hrr: [], mdot: [], Ts: [], Tback: [], massFrac: [], charDepth: [], thick: [], water: [], melt: [], dripped: [], flaming: [] };
  let nextRec = 0, peak = 0, tPeak = null, thr = 0, burnout = null;
  const water0 = s.sum('water');
  const qExt = qExtKW * 1000;
  let lastFlameT = null;
  while (s.t < tEnd) {
    const out = s.step(dt, qExt);
    thr += out.hrr * dt;
    if (out.hrr > peak) { peak = out.hrr; tPeak = s.t; }
    if (s.flaming) lastFlameT = s.t;
    if (s.t + 1e-9 >= nextRec) {
      series.t.push(+s.t.toFixed(2));
      series.hrr.push(out.hrr / 1000);
      series.mdot.push(out.mdot * 1000);
      series.Ts.push(out.Ts - 273.15);
      series.Tback.push((s.nodes.length ? s.nodes[s.nodes.length - 1].T : T_AMB) - 273.15);
      series.massFrac.push(s.totalMass() / s.m0);
      series.charDepth.push(s.charDepth() * 1000);
      series.thick.push(s.thickness() * 1000);
      series.water.push(water0 > 0 ? s.sum('water') / water0 : 0);
      series.melt.push(mat.meltKey ? s.sum(mat.meltKey) : 0);
      series.dripped.push(s.dripped);
      series.flaming.push(s.flaming ? 1 : 0);
      nextRec += every;
    }
    if (s.fuelLeft() < 1e-4 * s.m0 && !s.flaming) { burnout = s.t; break; }
    if (s.everIgnited && !s.flaming && lastFlameT !== null && s.t - lastFlameT > 120 && s.fuelLeft() < 0.05 * s.m0) { burnout = s.t; break; }
  }
  return {
    material: mat.key, flux: qExtKW,
    tig: s.ignitedAt, peakHRR: peak / 1000, tPeakAfterIg: (tPeak !== null && s.ignitedAt !== null) ? tPeak - s.ignitedAt : null,
    THR: thr / 1e6, burnout, dripped: s.dripped, series,
  };
}
