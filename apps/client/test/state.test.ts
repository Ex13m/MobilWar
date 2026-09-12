import { describe, expect, it } from "vitest";
import { WorldState } from "../src/state.js";
import type { Snapshot } from "@mobilwar/shared";

function snap(t: number, x: number): Snapshot {
  return {
    t,
    room: { id: "R", name: "r", mode: "tdm", origin: { lat: 0, lon: 0 }, radiusM: 100, phase: "playing", phaseEndsAt: 0, score: { red: 0, blue: 0 }, playerCount: 1 },
    players: [{ id: "a", nick: "A", team: "red", avatar: "scout", playMode: "ar", x, z: 0, heading: 0, hp: 100, alive: true, kills: 0, deaths: 0, supply: 3, acc: 5, t }],
    objects: [],
  };
}

describe("WorldState interpolation", () => {
  it("interpolates between snapshots with delay", () => {
    const w = new WorldState();
    w.myId = "me";
    w.applySnapshot(snap(1000, 0));
    w.applySnapshot(snap(1100, 10));
    w.interpolate(1100 + 250 - 50); // render time = 1300-250 = 1050 -> halfway
    expect(w.players.get("a")!.rx).toBeCloseTo(5, 5);
  });
  it("clamps to latest when render time is past", () => {
    const w = new WorldState();
    w.applySnapshot(snap(1000, 0));
    w.applySnapshot(snap(1100, 10));
    w.interpolate(5000);
    expect(w.players.get("a")!.rx).toBe(10);
  });
});
