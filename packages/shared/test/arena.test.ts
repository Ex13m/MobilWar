import { describe, expect, it } from "vitest";
import { GAME, generateCover, resolveMove, seedFromString } from "../src/index.js";

describe("arena", () => {
  it("cover is deterministic, away from bases and not overlapping", () => {
    const bases = [
      { x: 0, z: -33 },
      { x: 0, z: 33 },
    ];
    const a = generateCover(seedFromString("ROOM"), 60, bases);
    const b = generateCover(seedFromString("ROOM"), 60, bases);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(6);
    for (const c of a) {
      expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(60 * 0.85 + 0.01);
      for (const base of bases) expect(Math.hypot(c.x - base.x, c.z - base.z)).toBeGreaterThanOrEqual(7);
    }
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i]!.x - a[j]!.x, a[i]!.z - a[j]!.z)).toBeGreaterThanOrEqual(4.5);
  });

  it("resolveMove slides around cover and stays inside the arena", () => {
    const cover = [{ x: 5, z: 0 }];
    const r = resolveMove({ x: 0, z: 0 }, { x: 5, z: 0.2 }, cover, 60);
    expect(Math.hypot(r.x - 5, r.z)).toBeGreaterThanOrEqual(GAME.FPS.COVER_COLLIDE_M + GAME.FPS.PLAYER_RADIUS_M - 1e-6);
    const edge = resolveMove({ x: 0, z: 0 }, { x: 100, z: 0 }, [], 60);
    expect(Math.hypot(edge.x, edge.z)).toBeCloseTo(60 - GAME.FPS.PLAYER_RADIUS_M, 5);
    const free = resolveMove({ x: 0, z: 0 }, { x: 1, z: 1 }, cover, 60);
    expect(free).toEqual({ x: 1, z: 1 });
  });
});
