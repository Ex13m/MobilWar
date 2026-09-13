import { GAME } from "./constants";
import { angleDiff, bearingLocal, distLocal, type Vec2 } from "./geo";

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
 * R = base + 0.5*(shooterAcc + targetAcc), clamped so the cone never exceeds 45°.
 */
export function effectiveHalfAngle(dist: number, shooterAcc: number, targetAcc: number): number {
  const R = GAME.HIT_RADIUS_BASE_M + 0.5 * (clampAcc(shooterAcc) + clampAcc(targetAcc));
  const fromRadius = (Math.atan2(R, Math.max(dist, 0.5)) * 180) / Math.PI;
  return Math.min(45, Math.max(GAME.CONE_HALF_ANGLE_DEG, fromRadius));
}

function clampAcc(a: number): number {
  if (!Number.isFinite(a) || a < 0) return GAME.MAX_ACCURACY_M;
  return Math.min(a, GAME.MAX_ACCURACY_M);
}

/**
 * Resolve a shot: find the best target in the cone within range.
 * Deterministic, 2D (ground plane), used server-side (authoritative) and
 * client-side (for immediate feedback).
 */
export function resolveShot(
  shooter: Shooter,
  heading: number,
  targets: Target[],
  rangeM: number = GAME.RIFLE_RANGE_M,
): HitCandidate | null {
  let best: HitCandidate | null = null;
  for (const t of targets) {
    const dist = distLocal(shooter, t);
    if (dist > rangeM || dist < 0.3) continue;
    const brg = bearingLocal(shooter, t);
    const angErr = Math.abs(angleDiff(heading, brg));
    const allowed = effectiveHalfAngle(dist, shooter.acc, t.acc);
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

/** Splash damage: `center` at 0 m falling linearly to `edge` at `radius`; 0 beyond. */
export function splashDamage(dist: number, radius: number, center: number, edge: number): number {
  if (dist >= radius) return 0;
  return Math.round(center + (edge - center) * (dist / radius));
}

/** Damage falloff: full up to 60% of range, then linear to 40% at max range. */
export function damageAtDistance(base: number, dist: number, rangeM: number): number {
  const knee = rangeM * 0.6;
  if (dist <= knee) return base;
  const f = 1 - ((dist - knee) / (rangeM - knee)) * 0.6;
  return Math.max(1, Math.round(base * f));
}
