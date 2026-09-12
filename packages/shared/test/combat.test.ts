import { describe, expect, it } from "vitest";
import { resolveShot, effectiveHalfAngle, damageAtDistance } from "../src/combat.js";

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
