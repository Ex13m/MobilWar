import { GAME } from "./constants";
import { haversine, type LatLon } from "./geo";

export interface PosSample extends LatLon {
  acc: number;
  /** Server receive time (ms). */
  t: number;
}

export type PlausibilityVerdict =
  | { ok: true }
  | { ok: false; reason: "accuracy" | "speed" | "teleport" | "nan" };

/**
 * Check if a new GPS sample is plausible given the previous accepted one.
 * Speed threshold is relaxed by the GPS error budget so noisy phones aren't punished.
 */
export function checkPlausible(prev: PosSample | null, next: PosSample): PlausibilityVerdict {
  if (![next.lat, next.lon, next.acc].every(Number.isFinite)) return { ok: false, reason: "nan" };
  if (Math.abs(next.lat) > 90 || Math.abs(next.lon) > 180) return { ok: false, reason: "nan" };
  if (next.acc > GAME.MAX_ACCURACY_M) return { ok: false, reason: "accuracy" };
  if (!prev) return { ok: true };
  const dt = Math.max(0.001, (next.t - prev.t) / 1000);
  const d = haversine(prev, next);
  const errBudget = prev.acc + next.acc;
  if (d > 500 && dt < 30) return { ok: false, reason: "teleport" };
  const maxD = GAME.MAX_SPEED_MPS * dt + errBudget;
  if (d > maxD) return { ok: false, reason: "speed" };
  return { ok: true };
}

/** Simple token bucket for per-connection rate limiting. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private capacity: number,
    private refillPerSec: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }
  take(now = Date.now(), n = 1): boolean {
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + dt * this.refillPerSec);
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}
