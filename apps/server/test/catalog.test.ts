import { describe, expect, it } from "vitest";
import { GAME, SLOTS, WEAPON_CATALOG, destination, type ServerMsg, type WeaponDef } from "@mobilwar/shared";
import { Room, type Client } from "../src/room.js";

const origin = { lat: 55.75, lon: 37.61 };
function mkClient(id: string): Client & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { id, inbox, send: (m) => inbox.push(m) };
}

/** Distance at which each slot is tested (inside effective range, GPS acc 1 m). */
const DIST: Record<string, number> = { pistol: 8, blaster: 20, sniper: 30, rocket: 20 };

function arena(w: WeaponDef) {
  let now = 1_000_000;
  const room = new Room({ id: "C", name: "cat", mode: "tdm", origin, radiusM: 150 }, {}, () => now);
  const a = mkClient("a");
  const b = mkClient("b");
  const c = mkClient("c");
  const pa = room.join(a, { nick: "A", avatar: "scout", playMode: "ar", deviceId: "da", team: "red", loadout: { [w.slot]: w.id } });
  const pb = room.join(b, { nick: "B", avatar: "heavy", playMode: "ar", deviceId: "db", team: "blue" });
  const pc = room.join(c, { nick: "C", avatar: "medic", playMode: "ar", deviceId: "dc", team: "red" });
  room.start();
  now += 10_001;
  room.tick();
  const d = w.trait === "pellets" ? Math.min(DIST[w.slot]!, w.rangeM * 0.6) : DIST[w.slot]!;
  room.updatePosition(pa, origin.lat, origin.lon, 1, 0);
  const north = destination(origin, 0, d);
  room.updatePosition(pb, north.lat, north.lon, 1, 180);
  const ally = destination(origin, 0, d + 1.5);
  room.updatePosition(pc, ally.lat, ally.lon, 1, 180);
  return { room, pa, pb, pc, a, b, advance: (ms: number) => (now += ms), tick: () => room.tick() };
}

describe("weapon catalog: every weapon works in the simulation", () => {
  for (const slot of SLOTS) {
    for (const w of WEAPON_CATALOG[slot]) {
      it(`${w.id} ${w.name} (${w.trait})`, () => {
        const { room, pa, pb, pc, advance, tick } = arena(w);
        expect(pa.loadout[slot]).toBe(w.id);
        expect(pa.mag[slot]).toBe(w.mag);
        room.selectWeapon(pa, slot);
        if (slot === "sniper") room.setZoom(pa, true);
        const heal = w.trait === "heal";
        if (heal) {
          pc.hp = 40;
          // move enemy away so the healing bolt aims at the ally (direct set: bypasses plausibility)
          pb.x = 100;
          pb.z = 0;
        }
        const hp0 = pb.hp;
        let triggers = 0;
        for (let i = 0; i < 80 && pb.alive && triggers < 60; i++) {
          room.shoot(pa, 0, slot, { chargeMs: w.chargeMs + 50, zoomed: true });
          triggers++;
          advance(Math.max(w.cooldownMs, 100) + 1);
          tick();
          if (pa.reloadUntil) {
            advance(w.reloadMs + 1);
            tick();
          }
          if (pa.lockUntil) {
            advance(3001);
            tick();
          }
          if (slot === "rocket") {
            for (let k = 0; k < 40 && room.projectiles.size; k++) {
              advance(100);
              tick();
            }
            if (pa.mag.rocket === 0) {
              pa.mag.rocket = w.mag; // simulate ammo pickups
              pa.ammo = w.mag;
            }
          }
        }
        if (heal) {
          expect(pc.hp).toBeGreaterThan(40);
          return;
        }
        if (w.trait === "emp") {
          expect(pb.hp).toBeLessThan(hp0);
          return;
        }
        if (w.name.startsWith("Ноль")) {
          expect(pb.hp).toBeLessThan(hp0);
          return;
        }
        expect(pb.alive, `${w.name}: enemy hp ${pb.hp} after ${triggers} triggers`).toBe(false);
        // magazine accounting never goes negative
        for (const s of SLOTS) expect(pa.mag[s]).toBeGreaterThanOrEqual(0);
      });
    }
  }

  it("traits: pierce ignores shield, stun blocks fire, burn ticks, chain hits neighbour, emp strips shields and disables turrets", () => {
    const pierce = WEAPON_CATALOG.pistol.find((w) => w.trait === "pierce")!;
    const t1 = arena(pierce);
    t1.pb.shield = 50;
    t1.room.selectWeapon(t1.pa, "pistol");
    t1.room.shoot(t1.pa, 0);
    expect(t1.pb.shield).toBe(50);
    expect(t1.pb.hp).toBe(GAME.MAX_HP - pierce.damage);

    const stun = WEAPON_CATALOG.pistol.find((w) => w.trait === "stun")!;
    const t2 = arena(stun);
    t2.room.selectWeapon(t2.pa, "pistol");
    t2.room.shoot(t2.pa, 0);
    expect(t2.pb.stunnedUntil).toBeGreaterThan(0);
    const hpA = t2.pa.hp;
    t2.room.shoot(t2.pb, 180);
    expect(t2.pa.hp).toBe(hpA); // stunned player cannot fire

    const burn = WEAPON_CATALOG.pistol.find((w) => w.trait === "burn")!;
    const t3 = arena(burn);
    t3.room.selectWeapon(t3.pa, "pistol");
    t3.room.shoot(t3.pa, 0);
    const afterHit = t3.pb.hp;
    t3.advance(1000);
    t3.tick();
    t3.advance(1000);
    t3.tick();
    expect(t3.pb.hp).toBeLessThan(afterHit);

    const chain = WEAPON_CATALOG.blaster.find((w) => w.trait === "chain")!;
    const t4 = arena(chain);
    const d = mkClient("d");
    const pd = t4.room.join(d, { nick: "D", avatar: "ninja", playMode: "ar", deviceId: "dd", team: "blue" });
    const near = destination(destination(origin, 0, 20), 90, 4);
    t4.room.updatePosition(pd, near.lat, near.lon, 1, 180);
    t4.room.selectWeapon(t4.pa, "blaster");
    t4.room.shoot(t4.pa, 0);
    expect(pd.hp).toBeLessThan(GAME.MAX_HP);

    const emp = WEAPON_CATALOG.rocket.find((w) => w.trait === "emp")!;
    const t5 = arena(emp);
    t5.pb.shield = 50;
    const tur = t5.room.placeObject(t5.pb, "turret")!;
    t5.room.selectWeapon(t5.pa, "rocket");
    t5.room.shoot(t5.pa, 0, "rocket");
    for (let k = 0; k < 40 && t5.room.projectiles.size; k++) {
      t5.advance(100);
      t5.tick();
    }
    expect(t5.pb.shield).toBe(0);
    expect(t5.room.objects.get(tur.id)?.disabledUntil ?? 0).toBeGreaterThan(0);
  });

  it("equip mid-game swaps the magazine and validates slot", () => {
    const t = arena(WEAPON_CATALOG.pistol[0]!);
    expect(t.room.equip(t.pa, "pistol", "pistol_05")).toBe(true);
    expect(t.pa.mag.pistol).toBe(WEAPON_CATALOG.pistol[4]!.mag);
    expect(t.room.equip(t.pa, "pistol", "sniper_02")).toBe(false);
    expect(t.room.equip(t.pa, "rocket", "rocket_09")).toBe(true);
    expect(t.pa.ammo).toBe(3);
  });
});
