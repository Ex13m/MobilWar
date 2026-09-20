import { describe, expect, it } from "vitest";
import { WorldState } from "../src/state.js";
import type { Snapshot } from "@mobilwar/shared";

function snap(t: number, x: number): Snapshot {
  return {
    t,
    room: { id: "R", name: "r", mode: "tdm", origin: { lat: 0, lon: 0 }, radiusM: 100, doom: false, phase: "playing", phaseEndsAt: 0, score: { red: 0, blue: 0 }, playerCount: 1, bases: { red: { x: 0, z: -55 }, blue: { x: 0, z: 55 } } },
    players: [{ id: "a", nick: "A", team: "red", avatar: "scout", playMode: "ar", x, z: 0, heading: 0, hp: 100, alive: true, kills: 0, deaths: 0, supply: 3, acc: 5, t, shield: 0, ammo: 2, weapon: "blaster", overchargeUntil: 0, protectedUntil: 0, respawnAt: 0, mag: { pistol: 12, blaster: 30, sniper: 5, rocket: 2 }, grenades: { plasma: 2, emp: 1 }, reserve: { pistol: -1, blaster: 120, sniper: 20, rocket: 0 }, reloadUntil: 0, bloom: 0, zoomed: false, loadout: { pistol: "pistol_01", blaster: "blaster_01", sniper: "sniper_01", rocket: "rocket_01" }, stunnedUntil: 0, burnUntil: 0 }],
    objects: [],
    projectiles: [],
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
