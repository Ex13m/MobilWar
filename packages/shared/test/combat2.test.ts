import { describe, expect, it } from "vitest";
import { distToSegment, firstBarrierOnPath, rayEnd, splashDamage } from "../src/combat.js";

describe("cover & splash", () => {
  it("distToSegment", () => {
    expect(distToSegment({ x: 0, z: -5 }, { x: 0, z: 0 }, { x: 0, z: -10 })).toBeCloseTo(0);
    expect(distToSegment({ x: 3, z: -5 }, { x: 0, z: 0 }, { x: 0, z: -10 })).toBeCloseTo(3);
    expect(distToSegment({ x: 0, z: 5 }, { x: 0, z: 0 }, { x: 0, z: -10 })).toBeCloseTo(5);
  });
  it("barrier between shooter and target blocks", () => {
    const b = firstBarrierOnPath({ x: 0, z: 0 }, { x: 0, z: -20 }, [{ id: "b1", x: 0.5, z: -10 }]);
    expect(b?.id).toBe("b1");
  });
  it("barrier off the line does not block; barrier hugging the shooter does not block", () => {
    expect(firstBarrierOnPath({ x: 0, z: 0 }, { x: 0, z: -20 }, [{ id: "b1", x: 4, z: -10 }])).toBeNull();
    expect(firstBarrierOnPath({ x: 0, z: 0 }, { x: 0, z: -20 }, [{ id: "b1", x: 0, z: -0.5 }])).toBeNull();
  });
  it("rayEnd north", () => {
    const e = rayEnd({ x: 0, z: 0 }, 0, 10);
    expect(e.x).toBeCloseTo(0);
    expect(e.z).toBeCloseTo(-10);
  });
  it("splash falloff", () => {
    expect(splashDamage(0, 6, 50, 15)).toBe(50);
    expect(splashDamage(3, 6, 50, 15)).toBe(33);
    expect(splashDamage(6, 6, 50, 15)).toBe(0);
  });
});
