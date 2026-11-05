# dumpsterfire

Throw stuff in a dumpster and set it on virtual fire. Companion to Shred Hole.

The physics come first. This repo currently holds the **solid-phase combustion test bench**: a 1‑D pyrolysis and ignition model that heats materials like cone calorimeter samples and scores them against published lab data. The 3‑D fluid and rendering layers come after it.

`index.html` is the bench page: a scorecard, a live in-browser simulator, validation plots and the tuning list. Turn on GitHub Pages for `main` and that page becomes the site.

## Model (`bench/combustion.mjs`)

Each object face is a stack of thin layers, surface first. Every time step it:

1. Solves implicit 1‑D conduction, with a radiating and convecting surface and an insulated or exposed back face.
2. Applies phase changes by enthalpy clamp: water boils off at 100 °C, and PET melts at 250 °C.
3. Runs Arrhenius pyrolysis, with A derived from each material's TGA peak temperature, to make fuel gas plus char or liquid residue. Reaction is energy-limited.
4. Moves material around: foam-collapse liquid drains to a pool, the molten surface can drip off a vertical object, and layers are merged or split.

Piloted ignition happens when fuel-vapour flux holds above m″crit for a short delay. After that, the flame adds q″fl to the surface, and HRR = m″ · ΔHc.

The engine has no dependencies and runs in Node and the browser.

## Materials (`bench/materials.mjs`, `bench/calibrated.json`)

Pine (2×6 stud), PU foam, PET, corrugated cardboard, and a paper sheet. `materials.mjs` holds the literature-guided defaults. `calibrated.json` overrides four knobs per material, fit on FSRI's 25 and 50 kW/m² cone data only.

## Results (Nov 2026)

| | Fit (25, 50 kW/m²) | Held out (75 kW/m²) |
|---|---|---|
| Points within 25 % | 15 / 16 | 3 / 8 (7 / 8 within 50 %) |

- **Strong:** thick-solid ignition (pine within 10 % at 75 kW/m²), energy closure, solver within 0.3 % of the analytic solution, PET's back-face peak timing, moisture delay, foam collapse into a pool, and PET bottle walls dripping before they ignite.
- **Needs work, in priority order:**
  1. Wood ignition at low heat flux. The model needs 21.6 kW/m² against ≈10–12 measured, because char oxidation is missing.
  2. PET at high flux. The model lacks in-depth radiation absorption.
  3. Cardboard as liner, air gap and liner layers instead of a uniform slab.
  4. Foam pool burns too intensely.

## Run it

```bash
cd bench
node run.mjs              # solver verification + untuned defaults
node calibrate.mjs pine   # refit one material (pine | foam | pet | cardboard)
node final.mjs            # calibrated runs → results.json
node extra.mjs            # critical heat flux + southern-pine check
node sweep.mjs            # ignition / peak sweeps across flux
node build.mjs            # rebuilds ../index.html from template.html
```

## Reference data

- FSRI Materials & Products Database (materials.fsri.org): Wood Stud, Pine Siding, Overstuffed Chair PU Foam, PET, Corrugated Cardboard
- NIST TN 2043: flexible PU foam at 35 kW/m²
- White & Dietenberger: southern pine; WIT Transactions: timbers at 35 kW/m²
- Spearpoint & Quintiere (2001): piloted ignition of wood
