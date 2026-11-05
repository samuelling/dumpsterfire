// materials.mjs — curated material library for the test bench.
// Values are literature-guided physics defaults ("untuned"). The calibrated set lives in
// calibrated.json and only overrides a few knobs per material (see calibrate.mjs).
//
// Units: rho kg/m³, k W/m/K, cp J/kg/K, E J/mol, Tp K (TGA peak at 10 K/min),
// dH J/kg (+ = endothermic), dHc J/kg of fuel gas, mCrit kg/m²/s, qFlame W/m².

const WATER = { rho: 1000, k: 0.6, cp: 4180, inPores: true };
const WATER_PHASE = { from: 'water', to: null, T: 373.15, L: 2.257e6 };

export const MATERIALS = {
  pine: {
    key: 'pine', label: 'Pine block (2×6 stud)', solid: 'wood', thickness: 0.038,
    moisture: 0.09, // kg water / kg dry wood at 20 °C, 50 % RH
    components: {
      // dry density = 355 / 1.09; cp(T) ≈ 0.1031 + 0.003867·T kJ/kg/K (dry wood)
      wood: { rho: 326, k: 0.088, kSlope: 2.0e-4, cp: 1236, cpSlope: 3.87, absorb: 0.80, eps: 0.80, fuel: true },
      char: { rho: 326, k: 0.07, kRad: 1.0e-10, cp: 1000, cpSlope: 1.0, absorb: 0.95, eps: 0.95 },
      // char keeps the wood's volume: its rho is listed per unit original volume × yield below
      water: WATER,
    },
    reactions: [
      { from: 'wood', products: { gas: 0.78, char: 0.22 }, E: 120e3, Tp: 633, dH: 0.3e6 },
    ],
    phase: [WATER_PHASE],
    dHc: 12.34e6,
    ignition: { mCrit: 3.0e-3, qFlame: 20e3, extFrac: 0.5, tDelay: 0.5 },
  },

  foam: {
    key: 'foam', label: 'PU foam cube (cushion)', solid: 'foam', thickness: 0.05,
    moisture: 0.0,
    components: {
      // k(T) fitted to FSRI 0.038→0.042 over 25→45 °C (radiation-dominated, ∝T³)
      foam: { rho: 31.7, k: 0.0195, kRad: 7.0e-10, kMax: 0.25, cp: 1400, cpSlope: 2.0, absorb: 0.90, eps: 0.90, fuel: true },
      polyol: { rho: 1000, k: 0.20, cp: 1900, absorb: 0.92, eps: 0.92, drains: true, fuel: true },
      char: { rho: 200, k: 0.08, cp: 1000, absorb: 0.95, eps: 0.95 },
    },
    reactions: [
      // stage 1: urethane scission releases isocyanate-rich gas; the polyol melts and collapses
      { from: 'foam', products: { gas: 0.35, polyol: 0.65 }, E: 150e3, Tp: 563, dH: 0.3e6 },
      // stage 2: the liquid polyol pool gasifies
      { from: 'polyol', products: { gas: 0.97, char: 0.03 }, E: 180e3, Tp: 663, dH: 0.8e6 },
    ],
    phase: [],
    dHc: 25.42e6,
    ignition: { mCrit: 1.5e-3, qFlame: 25e3, extFrac: 0.5, tDelay: 0.5 },
  },

  pet: {
    key: 'pet', label: 'PET (cast sheet / bottle wall)', solid: 'pet', thickness: 0.0069,
    moisture: 0.0, meltKey: 'petMelt',
    components: {
      pet: { rho: 1401, k: 0.181, kSlope: 1.5e-4, kMax: 0.30, cp: 1105, cpSlope: 3.3, absorb: 0.94, eps: 0.94, fuel: true },
      petMelt: { rho: 1300, k: 0.22, cp: 1900, absorb: 0.94, eps: 0.94, molten: true, fuel: true },
      char: { rho: 1400, k: 0.15, cp: 1000, absorb: 0.95, eps: 0.95 }, // residue dispersed in the melt, not a crust
    },
    reactions: [
      { from: 'petMelt', products: { gas: 0.94, char: 0.06 }, E: 220e3, Tp: 713, dH: 0.4e6 },
      { from: 'pet', products: { gas: 0.94, char: 0.06 }, E: 220e3, Tp: 713, dH: 0.4e6 },
    ],
    phase: [{ from: 'pet', to: 'petMelt', T: 523, L: 30e3 }],
    dHc: 21.62e6,
    ignition: { mCrit: 3.0e-3, qFlame: 25e3, extFrac: 0.5, tDelay: 0.5 },
  },

  cardboard: {
    key: 'cardboard', label: 'Corrugated cardboard (paper stock)', solid: 'cell', thickness: 0.0095,
    moisture: 0.07,
    components: {
      // 320 kg/m³ conditioned board; corrugation traps air → low effective k
      cell: { rho: 299, k: 0.060, kSlope: 1.0e-4, cp: 1236, cpSlope: 3.87, absorb: 0.85, eps: 0.85, fuel: true },
      char: { rho: 299, k: 0.06, kRad: 1.0e-10, cp: 1000, cpSlope: 1.0, absorb: 0.95, eps: 0.95 },
      water: WATER,
    },
    reactions: [
      { from: 'cell', products: { gas: 0.82, char: 0.18 }, E: 180e3, Tp: 633, dH: 0.3e6 },
    ],
    phase: [WATER_PHASE],
    dHc: 14.03e6,
    ignition: { mCrit: 3.0e-3, qFlame: 20e3, extFrac: 0.5, tDelay: 0.5 },
  },

  paper: {
    key: 'paper', label: 'Paper sheet (80 g/m², hanging)', solid: 'cell', thickness: 1.0e-4,
    moisture: 0.06,
    components: {
      cell: { rho: 800, k: 0.07, kSlope: 1.0e-4, cp: 1236, cpSlope: 3.87, absorb: 0.85, eps: 0.85, fuel: true },
      char: { rho: 800, k: 0.06, cp: 1000, absorb: 0.95, eps: 0.95 },
      water: WATER,
    },
    reactions: [
      { from: 'cell', products: { gas: 0.82, char: 0.18 }, E: 180e3, Tp: 633, dH: 0.3e6 },
    ],
    phase: [WATER_PHASE],
    dHc: 14.03e6,
    ignition: { mCrit: 3.0e-3, qFlame: 20e3, extFrac: 0.5, tDelay: 0.5 },
  },
};

// char density is defined per unit of ORIGINAL volume: char_rho = yield × virgin rho,
// so a fully charred node keeps the wood's thickness (wood chars in place).
for (const key of ['pine', 'cardboard', 'paper']) {
  const m = MATERIALS[key];
  const y = m.reactions[0].products.char;
  m.components.char.rho = y * m.components[m.solid].rho;
}

// Reference data (cone calorimeter). Times in s, HRR in kW/m².
// FSRI Materials & Products Database (materials.fsri.org): replicate means [min, max].
export const REFERENCE = {
  pine: {
    source: 'FSRI — Wood Stud (2×6 softwood, 355 kg/m³)',
    tig: { 25: [132.3, 112.5, 151.5], 50: [16.6, 14.25, 18.0], 75: [6.4, 5.75, 7.25] },
    peak: { 25: [295.4, 282.6, 303.4], 50: [275.5, 249.5, 296.4], 75: [337.5, 309.4, 369.7] },
    tPeak: { 25: [9.6, 9.5, 9.75], 50: [11.0, 10.25, 12.0], 75: [10.4, 9.0, 13.25] },
    extra: [
      { label: 'Southern pine @50 (White & Dietenberger)', flux: 50, tig: 28, peak: 154 },
      { label: 'Pine siding @25/50/75 (FSRI, 19 mm)', flux: 25, tig: 66.9, peak: 259.4 },
      { label: 'Pine siding @50 (FSRI)', flux: 50, tig: 10.9, peak: 312.8 },
      { label: 'Timbers @35 (WIT, 75–100 s)', flux: 35, tig: 87.5, tigRange: [75, 100] },
    ],
  },
  foam: {
    source: 'FSRI — Overstuffed chair PU foam (31.7 kg/m³)',
    tig: { 25: [5.5, 5.25, 5.75], 50: [1.75, 1.75, 1.75], 75: [1.33, 1.0, 1.5] },
    peak: { 25: [458.6, 444.9, 479.9], 50: [976.3, 870.9, 1139.2], 75: [1291.6, 1185.5, 1411.1] },
    tPeak: { 25: [43.3, 43.0, 43.75], 50: [29.5, 29.0, 30.25], 75: [24.3, 24.25, 24.5] },
    extra: [
      { label: 'NIST TN 2043 FPUF @35 (50 mm, 29.6 kg/m³): PHRR1 255, PHRR2 481, burn 132 s, THR 39.1 MJ/m²', flux: 35, tig: 4, tigRange: [3, 5], peak: 481, peakRange: [432, 530], phrr1: 255, burn: 132, THR: 39.1 },
    ],
  },
  pet: {
    source: 'FSRI — PET cast sheet (6.9 mm, 1401 kg/m³)',
    tig: { 25: [556.1, 295.0, 1102.5], 50: [84.8, 81.75, 88.5], 75: [39.5, 36.5, 42.25] },
    peak: { 25: [716.4, 550.7, 876.0], 50: [899.4, 880.2, 911.8], 75: [781.7, 716.8, 831.8] },
    tPeak: { 25: null, 50: [217.2, 207.25, 224.25], 75: null },
    extra: [],
  },
  cardboard: {
    source: 'FSRI — Corrugated cardboard (9.5 mm, 320 kg/m³)',
    tig: { 25: [31.0, 30.0, 32.5], 50: [7.3, 6.75, 8.0], 75: [3.7, 3.0, 4.25] },
    peak: { 25: [198.1, 186.2, 206.9], 50: [298.0, 281.3, 312.8], 75: [364.4, 343.6, 380.7] },
    tPeak: { 25: [19.75, 19.0, 20.5], 50: [18.4, 18.0, 19.0], 75: [18.0, 17.5, 18.5] },
    extra: [],
  },
  paper: null, // no cone data for a free-hanging sheet: prediction only
};
