import { describe, expect, it } from "vitest";
import { resolveShot, effectiveHalfAngle, damageAtDistance, grenadeHop } from "../src/combat.js";

describe("combat", () => {
  const shooter = { x: 0, z: 0, acc: 5 };
  it("hits target straight ahead (north)", () => {
    const hit = resolveShot(shooter, 0, [{ id: "a", x: 0, z: -20, acc: 5 }]);
    expect(hit?.id).toBe("a");
    expect(hit?.angErr).toBeCloseTo(0);
  });
  it("misses target behind", () => {
    const hit = resolveShot(shooter, 0, [{ id: "a", x: 0, z: 20, acc: 5 }]);
    expect(hit).toBeNull();
  });
  it("cone widens with GPS error at close range", () => {
    expect(effectiveHalfAngle(5, 10, 10)).toBeGreaterThan(effectiveHalfAngle(50, 10, 10));
    expect(effectiveHalfAngle(200, 0, 0)).toBe(10);
  });
  it("picks the most centred target", () => {
    const hit = resolveShot(shooter, 90, [
      { id: "far_centred", x: 40, z: 0, acc: 3 },
      { id: "near_offset", x: 10, z: -1.5, acc: 3 },
    ]);
    expect(hit).not.toBeNull();
    // both inside cone; scoring prefers centred; near_offset ~8.5° off at 10m; far_centred 0° -> far wins on angle
    expect(hit?.id).toBe("far_centred");
  });
  it("out of range", () => {
    expect(resolveShot(shooter, 0, [{ id: "a", x: 0, z: -100, acc: 5 }])).toBeNull();
  });
  it("damage falloff", () => {
    expect(damageAtDistance(25, 10, 60)).toBe(25);
    expect(damageAtDistance(25, 60, 60)).toBe(10);
  });
});

describe("grenadeHop", () => {
  it("covers the whole throw, bouncing lower each time", () => {
    expect(grenadeHop(0).d).toBe(0);
    expect(grenadeHop(1).d).toBeCloseTo(1, 5);
    // distance never goes backwards
    let prev = -1;
    for (let k = 0; k <= 1.0001; k += 0.02) {
      const d = grenadeHop(k).d;
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    // each bounce is lower than the one before it
    const apexes = [0.25, 0.64, 0.85, 0.96].map((k) => grenadeHop(k).y);
    for (let i = 1; i < apexes.length; i++) expect(apexes[i]!).toBeLessThan(apexes[i - 1]!);
    // it is on the ground when it leaves the hand and when it stops
    expect(grenadeHop(0).y).toBeCloseTo(0, 5);
    expect(grenadeHop(1).y).toBeCloseTo(0, 5);
  });
});
