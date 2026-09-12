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

/** Damage falloff: full up to 60% of range, then linear to 40% at max range. */
export function damageAtDistance(base: number, dist: number, rangeM: number): number {
  const knee = rangeM * 0.6;
  if (dist <= knee) return base;
  const f = 1 - ((dist - knee) / (rangeM - knee)) * 0.6;
  return Math.max(1, Math.round(base * f));
}
