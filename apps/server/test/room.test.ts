import { describe, expect, it } from "vitest";
import { GAME, destination, type ServerMsg } from "@mobilwar/shared";
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

  it("blaster hits enemy straight ahead (10 dmg) and kills after 10 hits", () => {
    const { room, pa, pb, b, advance, startPlaying } = setup();
    startPlaying();
    expect(room.phase).toBe("playing");
    room.updatePosition(pa, origin.lat, origin.lon, 5, 0);
    const north = destination(origin, 0, 20);
    room.updatePosition(pb, north.lat, north.lon, 5, 180);
    for (let i = 0; i < 10; i++) {
      room.shoot(pa, 0);
      advance(GAME.RIFLE_COOLDOWN_MS + 1);
    }
    expect(pb.alive).toBe(false);
    expect(pa.kills).toBe(1);
    expect(room.score.red).toBe(1);
    expect(b.inbox.some((m) => m.type === "hit")).toBe(true);
    expect(b.inbox.some((m) => m.type === "kill")).toBe(true);
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
    for (let i = 0; i < 10; i++) {
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
    for (let i = 0; i < 10; i++) {
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
    for (let i = 0; i < 10; i++) {
      room.shoot(zombie, 0);
      advance(GAME.RIFLE_COOLDOWN_MS + 1);
    }
    expect(human.team).toBe("red");
    room.tick();
    expect(room.phase).toBe("ended");
  });
});
