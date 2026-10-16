// The living sea: schools of bait that form on the rips and the shoal edges, drift with the tide, feed in
// pulses, and sometimes have tuna underneath. Pure and seeded, so a run is a function of its seed and where
// the boat goes. Nothing here knows about rendering.
//
// What a captain can read, from far to near:
//   * boils      tuna crashing bait at the surface (a tuna school, feeding hard)
//   * birds      terns and gannets diving on bait (a tuna school, or just bait: a decoy)
//   * slicks     a calm, oily patch over bait that is not feeding right now
//   * sonar      directly overhead: the bait ball at its depth, and tuna arches under it
// A school that is charged at speed is spooked and goes quiet for a minute.

import { clamp, KNOTS, lerp, Rng, smoothstep } from '../../core/math';
import { rollSpecies, rollWeight, type Species } from './species';
import type { FishTier } from './tiers';

export interface Waters {
  depthAt(x: number, z: number): number;
  currentAt(x: number, z: number, out: { x: number; z: number }): void;
}

export interface Zone {
  x: number;
  z: number;
  r: number;
  weight: number;
  label?: string;
}

export interface Bounds {
  x: number;
  z: number;
}

export interface SchoolTuna {
  id: number;
  species: Species;
  kg: number;
  /** Wander state around the school centre. */
  ang: number;
  rad: number;
  spd: number;
  depth: number;
  /** Personal hunger, 0.5..1. */
  hunger: number;
  /** Willingness to strike right now, 0..1. */
  appetite: number;
  x: number;
  z: number;
  /** Hooked, or landed. */
  gone: boolean;
}

export interface School {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  /** Depth of the bait ball (m) and its thickness. */
  depth: number;
  thick: number;
  /** Visible density, 0..1 (a spooked school thins out). */
  density: number;
  baseDensity: number;
  age: number;
  life: number;
  /** Shows birds, boils and slicks at the surface. */
  surface: boolean;
  tuna: SchoolTuna[];
  phase: number;
  period: number;
  /** How hard the school is feeding right now, 0..1. */
  feeding: number;
  /** Seconds of scatter left after being spooked. */
  spooked: number;
  /** Builds while a fast boat is close; the school bolts at 1. */
  fright: number;
  label: string;
  wanderX: number;
  wanderZ: number;
  wanderT: number;
}

export type CueKind = 'boil' | 'birds' | 'slick';

export interface Cue {
  school: School;
  kind: CueKind;
  x: number;
  z: number;
  /** 0..1 how obvious it is. */
  strength: number;
  /** Fraction of the visibility range it can be seen from. */
  reach: number;
}

export interface WorldEvent {
  kind: 'spawned' | 'spooked' | 'dissolved';
  school: School;
}

/** What a fish finder sees directly under a point. */
export interface Echo {
  bottom: number;
  /** The bait ball under the boat, if any. */
  bait: { depth: number; thick: number; density: number } | null;
  /** Fish arches: depth and size. */
  marks: { depth: number; kg: number; id: number; d: number }[];
}

export interface Visitor {
  x: number;
  z: number;
  /** Speed of the hull through the water (m/s): what the fish hear and see. */
  sog: number;
}

const TUNA_COUNT = [1, 1, 1, 2, 2, 3];

export class FishWorld {
  readonly schools: School[] = [];
  readonly events: WorldEvent[] = [];
  time = 0;
  private rng: Rng;
  private nextId = 1;
  private nextTunaId = 1;
  private respawnIn = 0;
  private readonly cur = { x: 0, z: 0 };

  constructor(
    readonly waters: Waters,
    readonly zones: readonly Zone[],
    readonly bounds: Bounds,
    public tier: FishTier,
    seed = 1,
  ) {
    this.rng = new Rng(seed);
  }

  /** Start a day: a few schools, and always one tuna school a run away from `anchor`. */
  reset(seed: number, tier: FishTier, anchor: { x: number; z: number }): void {
    this.rng = new Rng(seed);
    this.tier = tier;
    this.schools.length = 0;
    this.events.length = 0;
    this.time = 0;
    this.nextId = 1;
    this.nextTunaId = 1;
    this.respawnIn = 0;
    const near = this.spawn(anchor, { tuna: true, ring: [900, 1900] });
    if (near) near.surface = this.rng.next() < Math.max(0.6, tier.surfaceOdds);
    while (this.schools.length < tier.schools) {
      if (!this.spawn(anchor, { ring: [600, 4200] })) break;
    }
    // the day opens with feeding already underway somewhere
    for (const s of this.schools) s.age = this.rng.range(0, 90);
    this.events.length = 0;
  }

  // ---- spawning ------------------------------------------------------------------------------------

  private spawn(
    from: { x: number; z: number },
    o: { tuna?: boolean; ring?: [number, number] } = {},
  ): School | null {
    const rng = this.rng;
    const zoneTotal = this.zones.reduce((a, z) => a + z.weight, 0);
    for (let attempt = 0; attempt < 60; attempt++) {
      let r = rng.next() * zoneTotal;
      let zone = this.zones[0] as Zone;
      for (const z of this.zones) {
        r -= z.weight;
        if (r <= 0) {
          zone = z;
          break;
        }
      }
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * zone.r;
      const x = zone.x + Math.cos(a) * d;
      const z = zone.z + Math.sin(a) * d;
      const water = this.waters.depthAt(x, z);
      if (water < 14 || Math.abs(x) > this.bounds.x * 0.92 || Math.abs(z) > this.bounds.z * 0.92) continue;
      const dist = Math.hypot(x - from.x, z - from.z);
      const [lo, hi] = o.ring ?? [500, 99999];
      if (dist < lo || dist > hi) continue;
      if (this.schools.some((s) => Math.hypot(s.x - x, s.z - z) < 380)) continue;
      return this.make(x, z, water, zone.label ?? '', o.tuna);
    }
    return null;
  }

  private make(x: number, z: number, water: number, label: string, forceTuna?: boolean): School {
    const rng = this.rng;
    const t = this.tier;
    const hasTuna = forceTuna ?? rng.next() < t.tunaOdds;
    const surface = hasTuna ? rng.next() < t.surfaceOdds : rng.next() < 0.9;
    const depth = surface ? rng.range(2, 11) : Math.min(rng.range(14, 36), water * 0.8);
    const base = rng.range(0.6, 1);
    const species = rollSpecies(rng, t.bigBias);
    const school: School = {
      id: this.nextId++,
      x,
      z,
      vx: 0,
      vz: 0,
      radius: rng.range(28, 62),
      depth,
      thick: rng.range(5, 14),
      density: 0,
      baseDensity: base,
      age: 0,
      life: rng.range(380, 800),
      surface,
      tuna: [],
      phase: rng.range(0, Math.PI * 2),
      period: rng.range(70, 130),
      feeding: 0,
      spooked: 0,
      fright: 0,
      label,
      wanderX: 0,
      wanderZ: 0,
      wanderT: 0,
    };
    if (hasTuna) {
      const n = rng.pick(TUNA_COUNT);
      for (let i = 0; i < n; i++) {
        const sp = rng.next() < 0.2 ? rollSpecies(rng, t.bigBias) : species;
        school.tuna.push({
          id: this.nextTunaId++,
          species: sp,
          kg: rollWeight(rng, sp),
          ang: rng.range(0, Math.PI * 2),
          rad: rng.range(0.1, 0.7) * school.radius,
          spd: rng.range(1.2, 2.6),
          depth: Math.min(depth + rng.range(2, 9), water - 2),
          hunger: rng.range(0.55, 1),
          appetite: 0,
          x,
          z,
          gone: false,
        });
      }
    }
    this.schools.push(school);
    this.events.push({ kind: 'spawned', school });
    return school;
  }

  // ---- per frame -----------------------------------------------------------------------------------

  step(dt: number, player: Visitor): void {
    this.time += dt;
    const rng = this.rng;
    const t = this.tier;
    for (let i = this.schools.length - 1; i >= 0; i--) {
      const s = this.schools[i] as School;
      s.age += dt;

      // drift with the tide, plus a slow wander of its own
      this.waters.currentAt(s.x, s.z, this.cur);
      s.wanderT -= dt;
      if (s.wanderT <= 0) {
        s.wanderT = rng.range(6, 14);
        s.wanderX = rng.range(-0.35, 0.35);
        s.wanderZ = rng.range(-0.35, 0.35);
      }
      const k = Math.min(1, dt * 0.6);
      s.vx += (this.cur.x * 0.82 + s.wanderX - s.vx) * k;
      s.vz += (this.cur.z * 0.82 + s.wanderZ - s.vz) * k;
      s.x += s.vx * dt;
      s.z += s.vz * dt;

      // feeding comes in pulses; a spooked school goes quiet
      const wave = 0.5 + 0.5 * Math.sin((s.age / s.period) * Math.PI * 2 + s.phase);
      const pulse = smoothstep(0.2, 0.85, wave);
      s.spooked = Math.max(0, s.spooked - dt);
      const quiet = s.spooked > 0 ? 0.08 : 1;
      s.feeding += (pulse * quiet - s.feeding) * Math.min(1, dt * 1.4);

      // density: forms, holds, thins out at the end, and shrinks when spooked
      const fadeIn = smoothstep(0, 24, s.age);
      const fadeOut = 1 - smoothstep(s.life - 70, s.life, s.age);
      const target = s.baseDensity * fadeIn * fadeOut * (s.spooked > 0 ? 0.25 : 1);
      s.density += (target - s.density) * Math.min(1, dt * (s.spooked > 0 ? 0.6 : 0.25));

      // a fast boat close by makes it nervous; a charge bolts it
      const d = Math.hypot(player.x - s.x, player.z - s.z);
      const sogKn = player.sog * KNOTS;
      if (d < s.radius + 170 && sogKn > t.spookKn && s.spooked <= 0) {
        s.fright += ((sogKn - t.spookKn) / 4 + 0.35) * dt;
        if (s.fright >= 1) this.spook(s, 55);
      } else s.fright = Math.max(0, s.fright - dt * 0.4);

      // the tuna circle under the bait and strike when the school is feeding
      for (const f of s.tuna) {
        if (f.gone) continue;
        f.ang += (f.spd / Math.max(8, f.rad)) * dt;
        f.x = s.x + Math.cos(f.ang) * f.rad;
        f.z = s.z + Math.sin(f.ang) * f.rad;
        const want = f.hunger * smoothstep(0.3, 0.7, s.feeding) * (s.spooked > 0 ? 0 : 1);
        f.appetite += (want - f.appetite) * Math.min(1, dt * 1.2);
      }

      // gone: old, thinned out, or carried off the grounds
      const outside = Math.abs(s.x) > this.bounds.x || Math.abs(s.z) > this.bounds.z;
      const shallow = this.waters.depthAt(s.x, s.z) < 10;
      if (s.age > s.life || outside || shallow) {
        this.schools.splice(i, 1);
        this.events.push({ kind: 'dissolved', school: s });
      }
    }

    // keep the sea stocked, a little at a time and out of sight of the boat
    this.respawnIn -= dt;
    if (this.schools.length < t.schools && this.respawnIn <= 0) {
      this.respawnIn = rng.range(15, 45);
      this.spawn(player, { ring: [900, 5200] });
    }
  }

  /** Scatter a school (a fast boat, or a fish lost at the boat). */
  spook(s: School, seconds: number): void {
    if (s.spooked > 0) return;
    s.spooked = seconds;
    s.fright = 0;
    this.events.push({ kind: 'spooked', school: s });
  }

  // ---- what can be seen and heard --------------------------------------------------------------------

  /** Every sign the surface gives away right now. */
  cues(): Cue[] {
    const out: Cue[] = [];
    for (const s of this.schools) {
      if (!s.surface || s.density < 0.18) continue;
      if (s.density > 0.3) {
        out.push({ school: s, kind: 'slick', x: s.x, z: s.z, strength: s.density, reach: 0.3 });
      }
      const alive = s.tuna.some((f) => !f.gone);
      if (s.feeding > 0.28 && s.spooked <= 0) {
        out.push({ school: s, kind: 'birds', x: s.x, z: s.z, strength: s.feeding * s.density, reach: 0.9 });
        if (alive && s.feeding > 0.6) {
          out.push({ school: s, kind: 'boil', x: s.x, z: s.z, strength: s.feeding * s.density, reach: 1 });
        }
      }
    }
    return out;
  }

  /** Birds working a school (for the flock renderer). */
  birdCount(s: School): number {
    if (!s.surface || s.spooked > 0 || s.feeding < 0.28) return 0;
    return Math.round(4 + 10 * s.feeding * s.density);
  }

  /** The fish finder: what is under a point. */
  echo(x: number, z: number): Echo {
    const bottom = this.waters.depthAt(x, z);
    let bait: Echo['bait'] = null;
    const marks: Echo['marks'] = [];
    for (const s of this.schools) {
      const d = Math.hypot(x - s.x, z - s.z);
      const reach = s.radius + 6;
      if (d > reach) continue;
      const cover = 1 - smoothstep(0.55, 1, d / reach);
      const dens = s.density * cover;
      if (dens > 0.05 && (!bait || dens > bait.density))
        bait = { depth: s.depth, thick: s.thick, density: dens };
      for (const f of s.tuna) {
        if (f.gone || s.spooked > 0) continue;
        const fd = Math.hypot(x - f.x, z - f.z);
        if (fd < 15) marks.push({ depth: f.depth, kg: f.kg, id: f.id, d: fd });
      }
    }
    return { bottom, bait, marks };
  }

  /** The tuna in the world, for bite rolls and rendering. */
  tunaNear(x: number, z: number, r: number): SchoolTuna[] {
    const out: SchoolTuna[] = [];
    for (const s of this.schools) {
      if (Math.hypot(x - s.x, z - s.z) > r + s.radius) continue;
      for (const f of s.tuna) if (!f.gone && Math.hypot(x - f.x, z - f.z) < r) out.push(f);
    }
    return out;
  }

  schoolOf(f: SchoolTuna): School | undefined {
    return this.schools.find((s) => s.tuna.includes(f));
  }

  /** Total tuna still free in the world. */
  tunaLeft(): number {
    let n = 0;
    for (const s of this.schools) for (const f of s.tuna) if (!f.gone) n++;
    return n;
  }
}

/** How far you can see a cue (m): the haze decides, binoculars double it. */
export function visibilityRange(haze: number, binoculars: boolean): number {
  const clear = clamp(2.6 / Math.max(0.0001, haze), 700, 3600);
  return clear * (binoculars ? 2 : 1);
}

/** Is a cue seen from a boat at (px, pz) looking along `look`, with half field of view `half`? */
export function cueSeen(
  c: Cue,
  px: number,
  pz: number,
  look: number,
  half: number,
  range: number,
): { seen: boolean; dist: number; bearing: number } {
  const dx = c.x - px;
  const dz = c.z - pz;
  const dist = Math.hypot(dx, dz);
  let bearing = Math.atan2(dz, dx) - look;
  bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
  const reach = range * c.reach * lerp(0.6, 1, clamp(c.strength, 0, 1));
  return { seen: dist < reach && Math.abs(bearing) < half, dist, bearing };
}
