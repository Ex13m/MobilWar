import { describe, expect, it } from "vitest";
import { haversine, bearing, toLocal, fromLocal, destination, angleDiff, bearingLocal, insidePolygon } from "../src/geo.js";

const moscow = { lat: 55.7558, lon: 37.6173 };

describe("geo", () => {
  it("haversine 100 m north", () => {
    const p = destination(moscow, 0, 100);
    expect(haversine(moscow, p)).toBeCloseTo(100, 3);
  });
  it("bearing east ≈ 90", () => {
    const p = destination(moscow, 90, 50);
    expect(bearing(moscow, p)).toBeCloseTo(90, 1);
  });
  it("toLocal/fromLocal round trip", () => {
    const p = destination(moscow, 45, 120);
    const v = toLocal(moscow, p);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(120, 1);
    expect(v.x).toBeGreaterThan(0);
    expect(v.z).toBeLessThan(0); // north => -z
    const back = fromLocal(moscow, v);
    expect(haversine(p, back)).toBeLessThan(0.05);
  });
  it("angleDiff wraps", () => {
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(180, 0)).toBe(180);
  });
  it("bearingLocal north is 0, east is 90", () => {
    expect(bearingLocal({ x: 0, z: 0 }, { x: 0, z: -10 })).toBeCloseTo(0);
    expect(bearingLocal({ x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(90);
  });
  it("insidePolygon", () => {
    const sq = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
    ];
    expect(insidePolygon(sq, { lat: 0.5, lon: 0.5 })).toBe(true);
    expect(insidePolygon(sq, { lat: 1.5, lon: 0.5 })).toBe(false);
  });
});
