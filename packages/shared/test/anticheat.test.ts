import { describe, expect, it } from "vitest";
import { checkPlausible, TokenBucket } from "../src/anticheat.js";
import { destination } from "../src/geo.js";

const o = { lat: 55.75, lon: 37.61 };
describe("anticheat", () => {
  it("rejects bad accuracy", () => {
    expect(checkPlausible(null, { ...o, acc: 100, t: 0 })).toEqual({ ok: false, reason: "accuracy" });
  });
  it("accepts walking", () => {
    const p = destination(o, 0, 5);
    expect(checkPlausible({ ...o, acc: 5, t: 0 }, { ...p, acc: 5, t: 2000 })).toEqual({ ok: true });
  });
  it("rejects teleport", () => {
    const p = destination(o, 0, 2000);
    expect(checkPlausible({ ...o, acc: 5, t: 0 }, { ...p, acc: 5, t: 2000 }).ok).toBe(false);
  });
  it("token bucket", () => {
    const b = new TokenBucket(2, 1, 0);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.take(1000)).toBe(true);
  });
});
