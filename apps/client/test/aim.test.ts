import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cameraAim } from "../src/sensors.js";

const DEG = Math.PI / 180;
/** The AR camera's own construction (ArScene.updateView), portrait screen. */
function threeAim(alpha: number, beta: number, gamma: number) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(beta * DEG, alpha * DEG, -gamma * DEG, "YXZ"));
  q.multiply(new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2));
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return { heading: (((Math.atan2(f.x, -f.z) / DEG) % 360) + 360) % 360, pitch: Math.asin(f.y) / DEG };
}
const wrap = (d: number) => ((d + 540) % 360) - 180;

describe("cameraAim", () => {
  it("matches the AR camera direction for any pose", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const a = rnd() * 360;
      const b = rnd() * 170 - 5;
      const g = rnd() * 120 - 60;
      const want = threeAim(a, b, g);
      const got = cameraAim(a, b, g);
      expect(Math.abs(got.pitch - want.pitch)).toBeLessThan(0.01);
      if (Math.abs(want.pitch) < 85) expect(Math.abs(wrap(got.heading - want.heading))).toBeLessThan(0.01);
    }
  });

  it("is steady at the horizon where 360-alpha goes haywire (gimbal lock)", () => {
    // Upright phone aimed level at heading 30°: at beta = 90 only alpha + gamma
    // is defined, so the sensor may report the same pose as any pair summing to
    // 330. The camera heading must not care.
    const poses = [
      [330, 90, 0],
      [300, 90, 30],
      [0, 90, -30],
      [345, 89.5, -15],
    ] as const;
    for (const [a, b, g] of poses) {
      expect(Math.abs(wrap(cameraAim(a, b, g).heading - 30))).toBeLessThan(1);
      // the old formula is off by up to the full roll
    }
    expect(Math.abs(wrap(360 - 300 - 30))).toBeGreaterThan(20);
  });
});
