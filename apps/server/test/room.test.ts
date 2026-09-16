import { describe, expect, it } from "vitest";
import { GAME, destination, weaponById, WEAPON_CATALOG, SLOTS, type ServerMsg } from "@mobilwar/shared";
import { Room, type Client } from "../src/room.js";

const origin = { lat: 55.75, lon: 37.61 };

function mkClient(id: string): Client & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { id, inbox, send: (m) => inbox.push(m) };
}

function setup(mode: "tdm" | "ctf" | "koth" | "infection" | "turret_defense" = "tdm") {
  let now = 1_000_000;
  const clock = () => now;
  const room = new Room({ id: "T", name: "test", mode, origin, radiusM: 150 }, {}, clock);
  const a = mkClient("a");
  const b = mkClient("b");
  const pa = room.join(a, { nick: "A", avatar: "scout", playMode: "ar", deviceId: "da", team: "red" });
  const pb = room.join(b, { nick: "B", avatar: "heavy", playMode: "screenless", deviceId: "db", team: "blue" });
  const advance = (ms: number) => {
    now += ms;
  };
  const startPlaying = () => {
    room.start();
    advance(10_001);
    room.tick();
  };
  return { room, a, b, pa, pb, advance, startPlaying, clock };
}

describe("Room", () => {
  it("balances teams", () => {
    const { room } = setup();
    const c = room.join(mkClient("c"), { nick: "C", avatar: "scout", playMode: "ar", deviceId: "dc", team: "red" });
    const d = room.join(mkClient("d"), { nick: "D", avatar: "scout", playMode: "ar", deviceId: "dd", team: "red" });
    expect(c.team).toBe("red");
    expect(d.team).toBe("blue");
  });

  it("blaster hits enemy straight ahead (9 dmg) and kills after 12 hits", () => {
    const { room, pa, pb, b, advance, startPlaying } = setup();
    startPlaying();
    expect(room.phase).toBe("playing");
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    for (let i = 0; i < 12; i++) {
      room.shoot(pa, 0);
      // Rounds have a flight time now, so the tick is what lands them.
      advance(GAME.RIFLE_COOLDOWN_MS + 1);
      room.tick();
    }
    expect(pb.alive).toBe(false);
    expect(pa.kills).toBe(1);
    expect(room.score.red).toBe(1);
    expect(b.inbox.some((m) => m.type === "hit")).toBe(true);
    expect(b.inbox.some((m) => m.type === "kill")).toBe(true);
  });

  it("shot misses when the phone is aimed at the sky or at the ground", () => {
    const { room, pa, pb, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    room.shoot(pa, 0, "blaster", { pitch: GAME.VERT_HALF_ANGLE_DEG + 15 });
    expect(pb.hp).toBe(GAME.MAX_HP);
    room.shoot(pa, 0, "blaster", { pitch: -(GAME.VERT_HALF_ANGLE_DEG + 15) });
    expect(pb.hp).toBe(GAME.MAX_HP);
  });

  it("shot still lands while the phone is held roughly level", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    room.shoot(pa, 0, "blaster", { pitch: GAME.VERT_HALF_ANGLE_DEG - 5 });
    advance(300);
    room.tick();
    expect(pb.hp).toBeLessThan(GAME.MAX_HP);
  });

  it("shot event carries the aim pitch so other clients draw the right tracer", () => {
    const { room, pa, pb, b, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    b.inbox.length = 0;
    room.shoot(pa, 0, "blaster", { pitch: 7 });
    const evt = b.inbox.find((m) => m.type === "shot");
    expect(evt && evt.type === "shot" && evt.pitch).toBe(7);
  });

  it("grenade flies farther the more the phone is tilted up", () => {
    const { room, pa, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const G = GAME.GRENADE;
    room.throwGrenade(pa, "plasma", 0, G.MIN_PITCH_DEG);
    const short = [...room.projectiles.values()][0]!;
    expect(short.maxDist).toBeCloseTo(G.MIN_RANGE_M + G.ROLL_M, 5);
    room.projectiles.clear();
    pa.lastGrenadeAt = 0;
    room.throwGrenade(pa, "plasma", 0, G.MAX_PITCH_DEG);
    const long = [...room.projectiles.values()][0]!;
    expect(long.maxDist).toBeCloseTo(G.MAX_RANGE_M + G.ROLL_M, 5);
  });

  it("plasma grenade blows up on its fuse and damages by distance", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    // Stand the victim where a fully tilted throw lands.
    const G = GAME.GRENADE;
    const target = destination(origin, 0, G.MAX_RANGE_M + G.ROLL_M);
    room.updatePosition(pb, target.lat, target.lon, 5, 180);
    room.throwGrenade(pa, "plasma", 0, G.MAX_PITCH_DEG);
    expect(pa.grenades.plasma).toBe(G.TYPES.plasma.perLife - 1);
    // Still ticking, not yet detonated.
    advance(G.FUSE_MS - 300);
    room.tick();
    expect(pb.hp).toBe(GAME.MAX_HP);
    advance(400);
    room.tick();
    expect(pb.hp).toBeLessThan(GAME.MAX_HP);
    expect(room.projectiles.size).toBe(0);
  });

  it("fragments reach past the blast core for lighter damage", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const G = GAME.GRENADE;
    const land = G.MIN_RANGE_M + G.ROLL_M;
    // Just outside the 5 m core but inside the fragment ring.
    const out = destination(origin, 0, land + G.TYPES.plasma.splashM + 1.5);
    room.updatePosition(pb, out.lat, out.lon, 5, 180);
    room.throwGrenade(pa, "plasma", 0, G.MIN_PITCH_DEG);
    advance(G.FUSE_MS + 100);
    room.tick();
    expect(GAME.MAX_HP - pb.hp).toBe(G.TYPES.plasma.fragDamage);
  });

  it("EMP grenade strips shields without dealing damage", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const G = GAME.GRENADE;
    const target = destination(origin, 0, G.MIN_RANGE_M + G.ROLL_M);
    room.updatePosition(pb, target.lat, target.lon, 5, 180);
    pb.shield = GAME.SHIELD_MAX;
    room.throwGrenade(pa, "emp", 0, G.MIN_PITCH_DEG);
    advance(G.FUSE_MS + 100);
    room.tick();
    expect(pb.shield).toBe(0);
    expect(pb.hp).toBe(GAME.MAX_HP);
  });

  it("throwables are limited per life and come back on respawn", () => {
    const { room, pa, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const G = GAME.GRENADE;
    for (let i = 0; i < G.TYPES.plasma.perLife + 2; i++) {
      room.throwGrenade(pa, "plasma", 0, G.MIN_PITCH_DEG);
      advance(G.COOLDOWN_MS + 1);
    }
    expect(pa.grenades.plasma).toBe(0);
  });

  it("ammo economy: harder-hitting weapons carry fewer rounds", () => {
    for (const slot of SLOTS) {
      const list = WEAPON_CATALOG[slot].filter((w) => w.reserve > 0 && w.pellets <= 1);
      if (list.length < 2) continue;
      // The rule: the harder a weapon hits, the less of it you carry.
      const strongest = [...list].sort((a, b) => b.damage - a.damage)[0]!;
      const weakest = [...list].sort((a, b) => a.damage - b.damage)[0]!;
      expect(strongest.mag + strongest.reserve).toBeLessThan(weakest.mag + weakest.reserve);
      // Spares stay between one and six magazines, so nothing is either a
      // single-magazine trap or an effectively infinite gun.
      for (const w of list) {
        expect(w.reserve).toBeGreaterThanOrEqual(w.mag);
        expect(w.reserve).toBeLessThanOrEqual(w.mag * 6);
      }
    }
  });

  it("every weapon in a slot reloads in its own time", () => {
    for (const slot of SLOTS) {
      const times = WEAPON_CATALOG[slot].map((w) => w.reloadMs);
      expect(new Set(times).size).toBe(times.length);
      for (const t of times) expect(t).toBeGreaterThanOrEqual(200);
    }
  });

  it("a round takes time to arrive: damage lands only after the flight", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    // 50 m out, so even a fast round needs a measurable moment to get there.
    const far = destination(origin, 0, 50);
    room.updatePosition(pb, far.lat, far.lon, 5, 180);
    // Pick a weapon that is slow enough for the delay to be unambiguous.
    const slow = WEAPON_CATALOG.blaster.filter((w) => w.speedMps < 200).sort((a, b) => a.speedMps - b.speedMps)[0]!;
    expect(room.equip(pa, "blaster", slow.id)).toBe(true);
    room.selectWeapon(pa, "blaster");
    room.shoot(pa, 0, "blaster");
    room.tick();
    expect(pb.hp, "the round is still in the air").toBe(GAME.MAX_HP);
    advance((50 / slow.speedMps) * 1000 + 50);
    room.tick();
    expect(pb.hp, "the round has arrived").toBeLessThan(GAME.MAX_HP);
  });

  it("a rail slug is instant and goes through shield and cover", () => {
    const { room, pa, pb, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const far = destination(origin, 0, 30);
    room.updatePosition(pb, far.lat, far.lon, 5, 180);
    const rail = WEAPON_CATALOG.sniper.find((w) => w.ammo === "rail")!;
    expect(rail.piercesShield).toBe(true);
    expect(rail.piercesCover).toBe(true);
    expect(room.equip(pa, "sniper", rail.id)).toBe(true);
    room.selectWeapon(pa, "sniper");
    pb.shield = GAME.SHIELD_MAX;
    room.shoot(pa, 0, "sniper", { zoomed: true });
    // No tick, no advance: a rail shot arrives the moment it is fired.
    expect(pb.shield).toBe(GAME.SHIELD_MAX);
    expect(pb.hp).toBeLessThan(GAME.MAX_HP);
  });

  it("every weapon carries an ammunition class with a sane speed", () => {
    for (const slot of SLOTS) {
      for (const w of WEAPON_CATALOG[slot]) {
        expect(w.speedMps).toBeGreaterThan(0);
        if (w.ammo === "rail") expect(w.speedMps).toBeGreaterThan(10000);
        else expect(w.speedMps).toBeLessThan(600);
        expect(w.piercesCover ? w.piercesShield : true, `${w.id}: cover-piercing implies shield-piercing`).toBe(true);
      }
      // A slot should not be a single ammunition class: variety is the point.
      const kinds = new Set(WEAPON_CATALOG[slot].map((w) => w.ammo));
      if (slot !== "rocket") expect(kinds.size).toBeGreaterThan(1);
    }
  });

  it("lag compensation: the shot is resolved against where the target was on screen", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 1, 0);
    // The target walks east across the shooter's front at 20 m out.
    const track = (east: number) => destination(destination(origin, 0, 20), 90, east);
    let p0 = track(0);
    room.updatePosition(pb, p0.lat, p0.lon, 1, 90);
    // Four position updates over a second: the client is rendering the oldest
    // of them, a quarter second behind.
    for (let e = 2; e <= 8; e += 2) {
      advance(250);
      const q = track(e);
      room.updatePosition(pb, q.lat, q.lon, 1, 90);
    }
    // Aim at where the screen still shows them, not at where they now are.
    const shown = room.positionAtForTest(pb, room.nowForTest() - GAME.INTERP_DELAY_MS);
    const brg = (Math.atan2(shown.x, -shown.z) * 180) / Math.PI;
    room.shoot(pa, brg, "sniper", { zoomed: true });
    advance(400);
    room.tick();
    expect(pb.hp, "the round lands where the shooter saw them").toBeLessThan(GAME.MAX_HP);
  });

  it("a drone empties its magazine, flies home, reloads and resumes", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const drone = room.placeObject(pa, "drone")!;
    // Enemy stands inside the drone's reach so it keeps firing.
    const near = destination(origin, 0, 6);
    room.updatePosition(pb, near.lat, near.lon, 5, 180);
    const D = GAME.DRONE;
    for (let i = 0; i < D.MAG + 4; i++) {
      advance(D.COOLDOWN_MS + 1);
      room.tick();
      pb.hp = GAME.MAX_HP; // keep the target alive so the drone keeps shooting
    }
    const d = room.objects.get(drone.id) as { ammo: number; returning: boolean };
    expect(d.ammo).toBe(0);
    expect(d.returning).toBe(true);
    // Take the target away, otherwise it reloads and immediately empties again.
    pb.alive = false;
    // Give it time to reach the anchor and sit out the reload.
    for (let i = 0; i < Math.ceil(D.RELOAD_MS / 500) + 6; i++) {
      advance(500);
      room.tick();
    }
    const after = room.objects.get(drone.id) as { ammo: number; returning: boolean };
    expect(after.ammo).toBe(D.MAG);
    expect(after.returning).toBe(false);
  });

  it("a drone chews through enemy cover when no player is in reach", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    // Blue places cover; red's drone goes to work on it.
    const spot = destination(origin, 0, 5);
    room.updatePosition(pb, spot.lat, spot.lon, 5, 0);
    const wall = room.placeObject(pb, "barrier")!;
    const hp0 = wall.hp;
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    room.placeObject(pa, "drone");
    // Move the enemy far away so the drone has no player to prefer.
    const far = destination(origin, 180, 80);
    pb.x = 0;
    pb.z = 80;
    pb.lastSample = { lat: far.lat, lon: far.lon, acc: 5, t: room.nowForTest() };
    for (let i = 0; i < 6; i++) {
      advance(GAME.DRONE.COOLDOWN_MS + 1);
      room.tick();
    }
    expect(room.objects.get(wall.id)?.hp ?? 0).toBeLessThan(hp0);
  });

  it("a held rocket locks on and the shell steers after its target", () => {
    const { room, pa, pb, a, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 30);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    room.selectWeapon(pa, "rocket");
    a.inbox.length = 0;
    // Hold the aim on the target until the lock completes.
    for (let i = 0; i < 12; i++) {
      advance(100);
      room.tick();
    }
    expect(a.inbox.some((m) => m.type === "event" && m.kind === "lock_on")).toBe(true);
    room.shoot(pa, 0, "rocket");
    const pr = [...room.projectiles.values()][0]!;
    expect(pr.lockedTargetId).toBe(pb.id);
    // The target sidesteps; the shell should turn after it rather than fly on.
    const east = destination(destination(origin, 0, 30), 90, 10);
    room.updatePosition(pb, east.lat, east.lon, 5, 180);
    const h0 = pr.heading;
    advance(200);
    room.tick();
    expect(Math.abs(pr.heading - h0)).toBeGreaterThan(0);
  });

  it("shot misses when aiming away", () => {
    const { room, pa, pb, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    room.shoot(pa, 90);
    expect(pb.hp).toBe(GAME.MAX_HP);
  });

  it("respawns after delay", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 10);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    for (let i = 0; i < 12; i++) {
      room.shoot(pa, 0);
      advance(GAME.RIFLE_COOLDOWN_MS + 1);
    }
    expect(pb.alive).toBe(false);
    advance(GAME.RESPAWN_MS + 1);
    room.tick();
    // Not at base yet → still dead
    expect(pb.alive).toBe(false);
    // Walk to blue base (south, 55 % of radius) in plausible steps
    const base = room.bases().blue;
    let cur = destination(origin, 0, 10);
    for (let i = 0; i < 30 && !pb.alive; i++) {
      cur = destination(cur, 180, 8);
      advance(1000);
      room.updatePosition(pb, cur.lat, cur.lon, 3, 0);
      room.tick();
    }
    expect(pb.alive).toBe(true);
    expect(pb.hp).toBe(GAME.MAX_HP);
    expect(pb.protectedUntil).toBeGreaterThan(0);
    expect(Math.hypot(pb.x - base.x, pb.z - base.z)).toBeLessThanOrEqual(GAME.BASE_RADIUS_M + 8);
  });

  it("auto-respawns after RESPAWN_MS + RESPAWN_AUTO_MS without reaching base", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 10);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    for (let i = 0; i < 12; i++) {
      room.shoot(pa, 0);
      advance(GAME.RIFLE_COOLDOWN_MS + 1);
    }
    expect(pb.alive).toBe(false);
    advance(GAME.RESPAWN_MS + GAME.RESPAWN_AUTO_MS + 1);
    room.tick();
    expect(pb.alive).toBe(true);
  });

  it("rocket flies, explodes near enemy with splash, consumes ammo", () => {
    const { room, pa, pb, b, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 3, 180);
    room.shoot(pa, 0, "rocket");
    expect(pa.ammo).toBe(GAME.WEAPONS.rocket.AMMO - 1);
    expect(room.projectiles.size).toBe(1);
    for (let i = 0; i < 30 && room.projectiles.size; i++) {
      advance(100);
      room.tick();
    }
    expect(room.projectiles.size).toBe(0);
    expect(pb.hp).toBeLessThanOrEqual(GAME.MAX_HP - 30);
    expect(b.inbox.some((m) => m.type === "event" && m.kind === "explosion")).toBe(true);
  });

  it("rocket without ammo does nothing", () => {
    const { room, pa, startPlaying, advance } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    pa.mag.rocket = 0;
    pa.ammo = 0;
    room.shoot(pa, 0, "rocket");
    advance(GAME.WEAPONS.rocket.COOLDOWN_MS + 1);
    expect(room.projectiles.size).toBe(0);
  });

  it("barrier blocks blaster shots and takes damage; rocket explodes on it", () => {
    const { room, pa, pb, a, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    // B stands 20 m north, places a barrier 2 m in front (south of B), facing A
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 3, 180);
    const bar = room.placeObject(pb, "barrier")!;
    expect(bar.kind).toBe("barrier");
    room.shoot(pa, 0);
    expect(pb.hp).toBe(GAME.MAX_HP);
    const shot = a.inbox.filter((m) => m.type === "shot").pop();
    expect(shot && shot.type === "shot" ? shot.blockedBy : undefined).toBe(bar.id);
    expect(bar.hp).toBeLessThan(GAME.BARRIER_HP);
    advance(GAME.RIFLE_COOLDOWN_MS + 1);
    room.shoot(pa, 0, "rocket");
    for (let i = 0; i < 30 && room.projectiles.size; i++) {
      advance(100);
      room.tick();
    }
    // exploded at the barrier: barrier damaged heavily, B (2 m behind) within splash
    expect(room.objects.get(bar.id)?.hp ?? 0).toBeLessThan(GAME.BARRIER_HP - 30);
    expect(pb.hp).toBeLessThan(GAME.MAX_HP);
  });

  it("drone orbits and shoots enemies in range, not allies", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    const d = room.placeObject(pa, "drone")!;
    expect(d.kind).toBe("drone");
    const near = destination(origin, 90, 6);
    room.updatePosition(pb, near.lat, near.lon, 3, 0);
    const x0 = d.x;
    for (let i = 0; i < 15; i++) {
      advance(100);
      room.tick();
    }
    expect(d.x).not.toBe(x0);
    expect(d.y).toBe(GAME.DRONE.ALT_M);
    expect(pb.hp).toBeLessThan(GAME.MAX_HP);
    expect(pa.hp).toBe(GAME.MAX_HP);
  });

  it("pickups: shield absorbs damage, ammo refills, medkit heals", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    const north = destination(origin, 0, 10);
    room.updatePosition(pb, north.lat, north.lon, 3, 180);
    const sh = room.spawnPickup(room["now"](), "shield");
    sh.x = pb.x;
    sh.z = pb.z;
    room.tick();
    expect(pb.shield).toBe(GAME.SHIELD_MAX);
    expect(room.objects.has(sh.id)).toBe(false);
    room.shoot(pa, 0);
    expect(pb.hp).toBe(GAME.MAX_HP);
    expect(pb.shield).toBe(GAME.SHIELD_MAX - GAME.WEAPONS.blaster.DAMAGE);
    pa.mag.rocket = 0;
    pa.ammo = 0;
    const am = room.spawnPickup(room["now"](), "ammo");
    am.x = pa.x;
    am.z = pa.z;
    room.tick();
    expect(pa.ammo).toBe(2);
    pb.hp = 30;
    pb.shield = 0;
    const mk = room.spawnPickup(room["now"](), "medkit");
    mk.x = pb.x;
    mk.z = pb.z;
    room.tick();
    expect(pb.hp).toBe(80);
    advance(1);
  });

  it("pickups spawn over time inside the zone", () => {
    const { room, advance, startPlaying } = setup();
    startPlaying();
    advance(GAME.PICKUP_INTERVAL_MS * 0.3 + 1);
    room.tick();
    const pk = [...room.objects.values()].filter((o) => o.team === null);
    expect(pk.length).toBe(1);
    expect(Math.hypot(pk[0]!.x, pk[0]!.z)).toBeLessThanOrEqual(room.radiusM * 0.8 + 0.01);
  });

  it("spawn protection blocks damage", () => {
    const { room, pa, pb, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    const north = destination(origin, 0, 10);
    room.updatePosition(pb, north.lat, north.lon, 3, 180);
    pb.protectedUntil = room["now"]() + 5000;
    room.shoot(pa, 0);
    expect(pb.hp).toBe(GAME.MAX_HP);
  });

  it("out of bounds player cannot shoot", () => {
    const { room, pa, pb, a, startPlaying } = setup();
    startPlaying();
    const far = destination(origin, 0, 400);
    room.updatePosition(pa, far.lat, far.lon, 5, 180);
    expect(a.inbox.some((m) => m.type === "warn" && m.code === "out_of_bounds")).toBe(true);
    const near = destination(origin, 0, 380);
    room.updatePosition(pb, near.lat, near.lon, 5, 0);
    room.shoot(pa, 180);
    expect(pb.hp).toBe(GAME.MAX_HP);
  });

  it("turret auto-fires at enemies in range", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const obj = room.placeObject(pa, "turret");
    expect(obj?.kind).toBe("turret");
    expect(pa.supply).toBe(GAME.SUPPLY_PER_PLAYER - GAME.TURRET.COST);
    const near = destination(origin, 90, 10);
    room.updatePosition(pb, near.lat, near.lon, 5, 0);
    advance(GAME.TURRET.COOLDOWN_MS + 1);
    room.tick();
    expect(pb.hp).toBeLessThan(GAME.MAX_HP);
    // Own team not targeted
    expect(pa.hp).toBe(GAME.MAX_HP);
  });

  it("enemy can destroy turret", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const obj = room.placeObject(pa, "turret")!;
    // B stands 40 m south of origin (outside turret range 25 m), aims north.
    const south = destination(origin, 180, 40);
    room.updatePosition(pb, south.lat, south.lon, 3, 0);
    for (let i = 0; i < 60 && room.objects.has(obj.id); i++) {
      room.shoot(pb, 0);
      advance(GAME.RIFLE_COOLDOWN_MS + 1);
      room.tick();
    }
    expect(room.objects.has(obj.id)).toBe(false);
  });

  it("rejects implausible teleport", () => {
    const { room, pa, a } = setup();
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const far = destination(origin, 0, 5000);
    room.updatePosition(pa, far.lat, far.lon, 5, 0);
    expect(pa.x).toBeCloseTo(0, 1);
    expect(a.inbox.some((m) => m.type === "warn" && m.code === "speed")).toBe(true);
  });

  it("round ends on timer and calls onRoundEnd", () => {
    let ended = false;
    let now = 0;
    const room = new Room({ name: "t", mode: "tdm", origin, radiusM: 100 }, { onRoundEnd: () => (ended = true) }, () => now);
    room.join(mkClient("x"), { nick: "X", avatar: "scout", playMode: "ar", deviceId: "d" });
    room.start();
    now += 10_001;
    room.tick();
    expect(room.phase).toBe("playing");
    now += GAME.ROUND_MS + 1;
    room.tick();
    expect(room.phase).toBe("ended");
    expect(ended).toBe(true);
  });

  it("CTF: take enemy flag and capture at home", () => {
    const { room, pa, advance, startPlaying } = setup("ctf");
    startPlaying();
    // Red flag at z=-90 (north), blue flag at z=+90 (south). Red player A takes blue flag.
    const blueFlagPos = destination(origin, 180, 90);
    room.updatePosition(pa, blueFlagPos.lat, blueFlagPos.lon, 3, 0);
    room.tick();
    expect(pa.hasFlag).toBe(true);
    // walk home in plausible steps
    let cur = blueFlagPos;
    for (let i = 0; i < 20; i++) {
      cur = destination(cur, 0, 9);
      advance(1000);
      room.updatePosition(pa, cur.lat, cur.lon, 3, 0);
      room.tick();
    }
    expect(room.score.red).toBe(1);
    expect(pa.hasFlag).toBe(false);
  });

  it("KOTH: scores while alone on the hill", () => {
    const { room, pa, advance, startPlaying } = setup("koth");
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    advance(1000);
    room.tick();
    advance(1000);
    room.tick();
    expect(room.score.red).toBeGreaterThanOrEqual(1);
    expect(room.score.blue).toBe(0);
  });

  it("infection converts victims", () => {
    const { room, pa, pb, advance, startPlaying } = setup("infection");
    startPlaying();
    const zombie = pa.infected ? pa : pb;
    const human = zombie === pa ? pb : pa;
    expect(zombie.team).toBe("red");
    expect(human.team).toBe("blue");
    room.updatePosition(zombie, origin.lat, origin.lon, 3, 0);
    const n = destination(origin, 0, 10);
    room.updatePosition(human, n.lat, n.lon, 3, 180);
    for (let i = 0; i < 12; i++) {
      room.shoot(zombie, 0);
      advance(GAME.RIFLE_COOLDOWN_MS + 1);
    }
    expect(human.team).toBe("red");
    room.tick();
    expect(room.phase).toBe("ended");
  });

  it("magazine empties and reloads; switching cancels reload", () => {
    const { room, pa, pb, a, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 3, 180);
    room.selectWeapon(pa, "pistol");
    for (let i = 0; i < GAME.WEAPONS.pistol.MAG; i++) {
      room.shoot(pa, 0);
      advance(GAME.WEAPONS.pistol.COOLDOWN_MS + 1);
    }
    expect(pa.mag.pistol).toBe(0);
    room.shoot(pa, 0); // empty → auto reload starts
    expect(a.inbox.some((m) => m.type === "event" && m.kind === "empty")).toBe(true);
    expect(pa.reloadUntil).toBeGreaterThan(0);
    advance(GAME.WEAPONS.pistol.RELOAD_MS + 1);
    room.tick();
    expect(pa.mag.pistol).toBe(GAME.WEAPONS.pistol.MAG);
    // Pistols used to carry infinite spares; every slot now has a real economy.
    const pistolDef = weaponById(pa.loadout.pistol)!;
    expect(pa.reserve.pistol).toBe(pistolDef.reserve - pistolDef.mag);
    // rifle: reserve decreases; switching cancels
    room.selectWeapon(pa, "blaster");
    pa.mag.blaster = 3;
    expect(room.reload(pa)).toBe(true);
    room.selectWeapon(pa, "pistol");
    expect(pa.reloadUntil).toBe(0);
    expect(pa.mag.blaster).toBe(3);
    room.selectWeapon(pa, "blaster");
    room.reload(pa);
    advance(GAME.WEAPONS.blaster.RELOAD_MS + 1);
    room.tick();
    expect(pa.mag.blaster).toBe(GAME.WEAPONS.blaster.MAG);
    expect(pa.reserve.blaster).toBe(GAME.WEAPONS.blaster.RESERVE - (GAME.WEAPONS.blaster.MAG - 3));
  });

  it("rifle bloom grows with continuous fire and decays", () => {
    const { room, pa, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 3, 0);
    for (let i = 0; i < 8; i++) {
      room.shoot(pa, 0);
      advance(GAME.WEAPONS.blaster.COOLDOWN_MS + 1);
    }
    expect(pa.bloom).toBeGreaterThan(4);
    advance(2000);
    room.shoot(pa, 0);
    expect(pa.bloom).toBeLessThanOrEqual(GAME.WEAPONS.blaster.BLOOM + 0.01);
  });

  it("pistol is precise to 10 m then widens; sniper charged shot one-shots", () => {
    const { room, pa, pb, advance, startPlaying } = setup();
    startPlaying();
    room.updatePosition(pa, origin.lat, origin.lon, 1, 0);
    // target 30 m north, 9° off axis (~4.75 m east): pistol cone at 30 m = min(14, 5 + 20*0.9) = 14 → hit;
    // GPS floor at acc 1 m is atan(4/30) ≈ 7.6°, so the zoomed sniper (3°) misses at 9°.
    const far = destination(destination(origin, 0, 30), 90, 4.75);
    room.updatePosition(pb, far.lat, far.lon, 1, 180);
    room.selectWeapon(pa, "pistol");
    room.shoot(pa, 0);
    advance(400);
    room.tick();
    expect(pb.hp).toBeLessThan(GAME.MAX_HP);
    // sniper zoomed cone 3°: same target is off-axis → miss; then aim exactly and charge → 100
    pb.hp = GAME.MAX_HP;
    room.selectWeapon(pa, "sniper");
    room.setZoom(pa, true);
    advance(GAME.WEAPONS.sniper.COOLDOWN_MS + 1);
    room.shoot(pa, 0, "sniper", { zoomed: true });
    advance(400);
    room.tick();
    expect(pb.hp).toBe(GAME.MAX_HP);
    const straight = destination(origin, 0, 30);
    advance(1000);
    room.updatePosition(pb, straight.lat, straight.lon, 1, 180);
    advance(GAME.WEAPONS.sniper.COOLDOWN_MS + 1);
    room.shoot(pa, 0, "sniper", { zoomed: true, chargeMs: 1000 });
    advance(400);
    room.tick();
    expect(pb.alive).toBe(false);
  });
});
