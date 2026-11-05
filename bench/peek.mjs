import { runCone } from './combustion.mjs';
import { MATERIALS } from './materials.mjs';
const [key, q] = [process.argv[2], +process.argv[3]];
const r = runCone(MATERIALS[key], q, { tEnd: +process.argv[4] || 900 });
const s = r.series; const step = Math.max(1, Math.floor(s.t.length / 30));
console.log(key, q, 'tig', r.tig, 'peak', r.peakHRR.toFixed(0));
for (let i = 0; i < s.t.length; i += step) console.log(`t=${s.t[i].toFixed(0).padStart(4)} hrr=${s.hrr[i].toFixed(0).padStart(5)} mdot=${s.mdot[i].toFixed(2).padStart(6)} Ts=${s.Ts[i].toFixed(0).padStart(4)} Tb=${s.Tback[i].toFixed(0).padStart(4)} m=${s.massFrac[i].toFixed(3)} char=${s.charDepth[i].toFixed(1)} L=${s.thick[i].toFixed(2)} fl=${s.flaming[i]}`);
