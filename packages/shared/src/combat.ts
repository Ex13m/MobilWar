import { GAME } from "./constants.js";
import { angleDiff, bearingLocal, distLocal, type Vec2 } from "./geo.js";

export interface Shooter extends Vec2 {
  acc: number; // GPS accuracy (m)
}
export interface Target extends Vec2 {
  id: string;
  acc: number;
}

export interface HitCandidate {
  id: string;
  dist: number;
  /** Angular error to target centre (deg), absolute. */
  angErr: number;
  /** Effective allowed half-angle for that target (deg). */
  allowed: number;
  /** Quality score in (0,1]; 1 = perfect centre. */
  score: number;
}

/**
 * Effective half-angle of the hit cone for a target at distance `dist`.
 * We treat the combined GPS uncertainty as a disc of radius R around the target;
 * the disc subtends atan(R/dist) — so close targets are "bigger".
 * R = base + 0.5*(shooterAcc + targetAcc), clamped so the cone never exceeds
 * GAME.MAX_HALF_ANGLE_DEG. The cap used to be 45°, which quietly shrank the hit
 * radius below R inside about seven metres — point blank was the least reliable
 * range in the game (docs/HEURISTICS.md §1).
 */
export function effectiveHalfAngle(dist: number, shooterAcc: number, targetAcc: number, weaponCone: number = GAME.CONE_HALF_ANGLE_DEG): number {
  const R = GAME.HIT_RADIUS_BASE_M + 0.5 * (clampAcc(shooterAcc) + clampAcc(targetAcc));
  const fromRadius = (Math.atan2(R, Math.max(dist, 0.5)) * 180) / Math.PI;
  return Math.min(GAME.MAX_HALF_ANGLE_DEG, Math.max(weaponCone, fromRadius));
}

export type ConeFn = number | ((dist: number) => number);

function clampAcc(a: number): number {
  if (!Number.isFinite(a) || a < 0) return GAME.MAX_ACCURACY_M;
  return Math.min(a, GAME.MAX_ACCURACY_M);
}

/**
 * Resolve a shot: find the best target in the cone within range.
 * Deterministic, 2D on the ground plane plus a vertical gate on the aim pitch;
 * used server-side (authoritative) and client-side (for immediate feedback).
 */
export function resolveShot(
  shooter: Shooter,
  heading: number,
  targets: Target[],
  rangeM: number = GAME.RIFLE_RANGE_M,
  cone: ConeFn = GAME.CONE_HALF_ANGLE_DEG,
  opts: { pitch?: number; vertHalfAngle?: number } = {},
): HitCandidate | null {
  let best: HitCandidate | null = null;
  // Vertical gate: everyone stands on the same ground plane, so a shot only
  // counts while the phone is aimed roughly level. Undefined pitch (older
  // clients, turrets, drones) skips the gate.
  const vAllowed = opts.vertHalfAngle ?? GAME.VERT_HALF_ANGLE_DEG;
  if (Number.isFinite(opts.pitch) && Math.abs(opts.pitch as number) > vAllowed) return null;
  for (const t of targets) {
    const dist = distLocal(shooter, t);
    if (dist > rangeM || dist < 0.3) continue;
    const brg = bearingLocal(shooter, t);
    const angErr = Math.abs(angleDiff(heading, brg));
    const allowed = effectiveHalfAngle(dist, shooter.acc, t.acc, typeof cone === "function" ? cone(dist) : cone);
    if (angErr > allowed) continue;
    // Prefer targets closer to the centre line, then nearer ones.
    const score = (1 - angErr / allowed) * 0.7 + (1 - dist / rangeM) * 0.3;
    if (!best || score > best.score) best = { id: t.id, dist, angErr, allowed, score };
  }
  return best;
}

/**
 * Distance from point p to segment a-b (2D ground plane).
 */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

/**
 * First barrier whose blocking disc intersects the shot line from `from` towards `to`.
 * Barriers within 1 m of the shooter don't block (you can shoot over your own cover).
 */
export function firstBarrierOnPath<T extends Vec2 & { id: string }>(from: Vec2, to: Vec2, barriers: T[], blockRadius: number = GAME.BARRIER_BLOCK_M): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const b of barriers) {
    const dShooter = distLocal(from, b);
    if (dShooter < 1.0) continue;
    if (distToSegment(b, from, to) > blockRadius) continue;
    if (dShooter < bestD) {
      best = b;
      bestD = dShooter;
    }
  }
  return best;
}

/** End point of a ray from `from` along `heading` at distance `len`. */
export function rayEnd(from: Vec2, heading: number, len: number): Vec2 {
  const h = (heading * Math.PI) / 180;
  return { x: from.x + Math.sin(h) * len, z: from.z - Math.cos(h) * len };
}

/**
 * Where a thrown grenade is along its flight, as a fraction of the throw.
 * Quake's grenade launcher does not drop its round on the aim point: it lands
 * short, bounces a few times with less height each hop, and rolls out the rest
 * of the fuse. `k` is the elapsed fraction of the flight, `d` the fraction of
 * the range covered, `y` the height as a fraction of the throw apex.
 */
export function grenadeHop(k: number): { d: number; y: number } {
  const hops = GAME.GRENADE.HOPS;
  const kk = Math.max(0, Math.min(1, k));
  let start = 0;
  let dist = 0;
  for (let i = 0; i < hops.length; i++) {
    const span = hops[i]!;
    const apex = GAME.GRENADE.BOUNCE_DECAY ** i;
    if (kk <= start + span || i === hops.length - 1) {
      const local = Math.max(0, Math.min(1, (kk - start) / span));
      return { d: Math.min(1, dist + span * local), y: apex * Math.sin(Math.PI * local) };
    }
    start += span;
    dist += span;
  }
  return { d: 1, y: 0 };
}

/**
 * How much of a weapon's damage a shot keeps, given how far off the centre of
 * its cone it landed. 1 dead centre, GAME.AIM.PRECISION_MIN at the edge.
 *
 * This is the whole answer to "GPS makes the cone so wide that aiming does not
 * matter": the cone stays wide, so a rough shot still connects and the game
 * stays playable with a sloppy compass, but a well-aimed one does more than
 * twice the damage of a grazing one.
 */
export function precisionMult(angErr: number, allowed: number): number {
  if (!(allowed > 0)) return 1;
  const off = Math.max(0, Math.min(1, Math.abs(angErr) / allowed));
  const k = GAME.AIM.PRECISION_K;
  const m = GAME.AIM.PRECISION_MIN;
  return m + (1 - m) * Math.pow(1 - off, k);
}

/** Splash damage: `center` at 0 m falling linearly to `edge` at `radius`; 0 beyond. */
export function splashDamage(dist: number, radius: number, center: number, edge: number): number {
  if (dist >= radius) return 0;
  return Math.round(center + (edge - center) * (dist / radius));
}

/**
 * Weapon half-angle (deg) before the GPS floor is applied.
 * pistol: precise to 10 m, then widens per metre; rifle: base + bloom; sniper: zoom-dependent.
 */
export function weaponCone(weapon: keyof typeof GAME.WEAPONS, dist: number, bloom = 0, zoomed = false): number {
  const W = GAME.WEAPONS[weapon];
  if (weapon === "pistol") return Math.min(W.CONE_MAX, W.CONE + Math.max(0, dist - 10) * W.CONE_PER_M);
  if (weapon === "blaster") return Math.min(W.CONE_MAX, W.CONE + bloom);
  if (weapon === "sniper") return zoomed ? W.CONE : GAME.SNIPER_HIP_CONE;
  return W.CONE;
}

/** Damage falloff: full up to 60% of range, then linear to 40% at max range. */
export function damageAtDistance(base: number, dist: number, rangeM: number): number {
  const knee = rangeM * 0.6;
  if (dist <= knee) return base;
  const f = 1 - ((dist - knee) / (rangeM - knee)) * 0.6;
  return Math.max(1, Math.round(base * f));
}
