import { GAME } from "./constants.js";
import type { Vec2 } from "./geo.js";

/** Cover block placed by the arena generator (local coords, heading in compass degrees). */
export interface CoverSpec extends Vec2 {
  heading: number;
}

/** Deterministic PRNG so server and tests agree on a layout for a given seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Generate cover for a virtual arena: blocks scattered inside 85 % of the radius,
 * never closer than 7 m to a base, 4 m to the centre or 4.5 m to each other.
 * Symmetric-ish: every block is mirrored through the centre so both teams get the same cover.
 */
export function generateCover(seed: number, radiusM: number, bases: Vec2[]): CoverSpec[] {
  const rng = mulberry32(seed);
  const want = Math.round(Math.min(40, Math.max(6, (radiusM / 100) * GAME.FPS.COVER_PER_100M)));
  const out: CoverSpec[] = [];
  let guard = 0;
  while (out.length < want && guard++ < want * 60) {
    const a = rng() * Math.PI * 2;
    const r = 4 + Math.sqrt(rng()) * (radiusM * 0.85 - 4);
    const c: CoverSpec = { x: Math.cos(a) * r, z: Math.sin(a) * r, heading: Math.round(rng() * 4) * 45 };
    if (bases.some((b) => Math.hypot(b.x - c.x, b.z - c.z) < 7)) continue;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 4.5)) continue;
    out.push(c);
    const m: CoverSpec = { x: -c.x, z: -c.z, heading: c.heading };
    if (out.length < want && !out.some((o) => Math.hypot(o.x - m.x, o.z - m.z) < 4.5) && !bases.some((b) => Math.hypot(b.x - m.x, b.z - m.z) < 7)) out.push(m);
  }
  return out;
}

/**
 * Slide a move from `from` to `to` around circular obstacles and inside the arena circle.
 * Returns the resolved position. Pure 2D; used by the FPS client and by server bots.
 */
export function resolveMove(from: Vec2, to: Vec2, obstacles: Vec2[], radiusM: number, obstacleR: number = GAME.FPS.COVER_COLLIDE_M, playerR: number = GAME.FPS.PLAYER_RADIUS_M): Vec2 {
  let x = to.x;
  let z = to.z;
  const minD = obstacleR + playerR;
  for (let iter = 0; iter < 3; iter++) {
    for (const o of obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      if (d >= minD) continue;
      if (d < 1e-4) {
        // exactly on centre: push back toward where we came from
        const bx = from.x - o.x;
        const bz = from.z - o.z;
        const bl = Math.hypot(bx, bz) || 1;
        x = o.x + (bx / bl) * minD;
        z = o.z + (bz / bl) * minD;
      } else {
        x = o.x + (dx / d) * minD;
        z = o.z + (dz / d) * minD;
      }
    }
  }
  const lim = radiusM - playerR;
  const dc = Math.hypot(x, z);
  if (dc > lim) {
    x = (x / dc) * lim;
    z = (z / dc) * lim;
  }
  return { x, z };
}
