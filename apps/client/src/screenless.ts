import { GAME, angleDiff, bearingLocal, distLocal, effectiveHalfAngle } from "@mobilwar/shared";
import type { GameAudio } from "./audio.js";
import type { WorldState } from "./state.js";

export interface RadarReading {
  /** Nearest enemy id, or null. */
  targetId: string | null;
  distance: number;
  /** Relative bearing (deg): 0 = ahead, + = right. */
  rel: number;
  /** Whether the target is inside the hit cone. */
  locked: boolean;
  /** Progress toward lock (0..1) for UI. */
  closeness: number;
}

/**
 * Screenless ("stealth") mode: the phone is a pointing device.
 * Compute nearest enemy relative to the phone heading and drive audio cues.
 */
export class Screenless {
  private wasLocked = false;
  private lastSpoken = 0;
  private lastTargetId: string | null = null;

  constructor(
    private world: WorldState,
    private audio: GameAudio,
  ) {}

  update(heading: number, now: number): RadarReading {
    const me = this.world.me;
    let best: RadarReading = { targetId: null, distance: Infinity, rel: 0, locked: false, closeness: 0 };
    for (const e of this.world.enemies()) {
      const d = distLocal(me, { x: e.rx, z: e.rz });
      if (d > GAME.RIFLE_RANGE_M * 1.5) continue;
      const brg = bearingLocal(me, { x: e.rx, z: e.rz });
      const rel = angleDiff(brg, heading);
      const allowed = effectiveHalfAngle(d, me.acc, e.acc);
      const locked = Math.abs(rel) <= allowed && d <= GAME.RIFLE_RANGE_M;
      // prioritise locked, then nearest
      const better = locked && !best.locked ? true : locked === best.locked ? d < best.distance : false;
      if (better) best = { targetId: e.id, distance: d, rel, locked, closeness: Math.max(0, 1 - Math.abs(rel) / 90) };
    }
    if (best.targetId) {
      this.audio.radar(best.rel, best.distance, now);
      if (best.locked && !this.wasLocked) this.audio.lockOn();
      if (best.targetId !== this.lastTargetId || now - this.lastSpoken > 6000) {
        const p = this.world.players.get(best.targetId);
        if (p && now - this.lastSpoken > 2500) {
          this.audio.say(`${p.nick}, ${Math.round(best.distance)} метров, ${clock(best.rel)}`);
          this.lastSpoken = now;
        }
      }
    }
    this.wasLocked = best.locked;
    this.lastTargetId = best.targetId;
    return best;
  }
}

/** Convert relative bearing to a clock direction ("на 2 часа"). */
export function clock(rel: number): string {
  const h = Math.round(((rel + 360) % 360) / 30) || 12;
  if (h === 12) return "прямо";
  if (h === 6) return "сзади";
  return `на ${h} ${h === 1 ? "час" : h < 5 ? "часа" : "часов"}`;
}
