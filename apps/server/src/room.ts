import {
  GAME,
  TEAMS,
  checkPlausible,
  damageAtDistance,
  destination,
  fromLocal,
  haversine,
  insideCircle,
  insidePolygon,
  resolveShot,
  toLocal,
  uid,
  distLocal,
  bearingLocal,
  firstBarrierOnPath,
  rayEnd,
  splashDamage,
  weaponCone,
  WEAPON_IDS,
  PICKUP_KINDS,
  type WeaponId,
  type Projectile,
  type PickupKind,
  type BaseInfo,
  type AvatarId,
  type GameMode,
  type LatLon,
  type ObjectKind,
  type PlayMode,
  type PlayerPublic,
  type PosSample,
  type RoomInfo,
  type ServerMsg,
  type Snapshot,
  type Team,
  type WorldObject,
} from "@mobilwar/shared";

export interface Client {
  id: string;
  send(msg: ServerMsg): void;
}

export interface Player extends PlayerPublic {
  client: Client;
  deviceId: string;
  lastSample: PosSample | null;
  lastShotAt: number;
  respawnAt: number;
  outOfBoundsSince: number;
  lastWarnAt: number;
  isReferee: boolean;
  infected?: boolean;
  /** Per-weapon last shot time. */
  lastShotByWeapon: Record<WeaponId, number>;
  /** Server time when rifle bloom was last updated. */
  bloomAt: number;
}

interface Turret extends WorldObject {
  kind: "turret";
  lastShotAt: number;
}

interface Drone extends WorldObject {
  kind: "drone";
  lastShotAt: number;
  /** Orbit centre and phase. */
  cx: number;
  cz: number;
  phase: number;
}

interface ServerProjectile extends Projectile {
  lastT: number;
  /** Where the projectile will self-detonate (aimed distance). */
  maxDist: number;
  travelled: number;
}

type KillWeapon = WeaponId | "turret" | "drone";

export interface RoomEvents {
  onKill?(room: Room, killerId: string, victimId: string, weapon: KillWeapon): void;
  onRoundEnd?(room: Room, snap: Snapshot): void;
}

/**
 * Authoritative game room. One per geo-zone. Pure logic — no sockets;
 * networking happens through Client.send.
 */
export class Room {
  readonly id: string;
  name: string;
  mode: GameMode;
  origin: LatLon;
  radiusM: number;
  polygon?: LatLon[];
  phase: RoomInfo["phase"] = "lobby";
  phaseEndsAt = 0;
  score: Record<Team, number> = { red: 0, blue: 0 };
  players = new Map<string, Player>();
  objects = new Map<string, WorldObject>();
  createdAt = Date.now();
  lastActiveAt = Date.now();
  /** KOTH hill (local coords). */
  hill: { x: number; z: number; r: number } | null = null;
  private kothLastTick = 0;
  projectiles = new Map<string, ServerProjectile>();
  private lastPickupSpawn = 0;
  private lastTickAt = 0;
  private rng = mulberry32(Date.now() & 0xffffffff);

  constructor(
    opts: { id?: string; name: string; mode: GameMode; origin: LatLon; radiusM: number; polygon?: LatLon[] },
    private events: RoomEvents = {},
    private now: () => number = Date.now,
  ) {
    this.id = opts.id ?? uid("room");
    this.name = opts.name;
    this.mode = opts.mode;
    this.origin = opts.origin;
    this.radiusM = Math.min(1000, Math.max(20, opts.radiusM));
    this.polygon = opts.polygon;
  }

  /* ---------------- info ---------------- */

  info(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      mode: this.mode,
      origin: this.origin,
      radiusM: this.radiusM,
      polygon: this.polygon,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      score: { ...this.score },
      playerCount: [...this.players.values()].filter((p) => !p.isReferee).length,
      bases: this.bases(),
    };
  }

  /** Team bases: red north, blue south, at 55 % of the zone radius. */
  bases(): Record<Team, BaseInfo> {
    const r = this.radiusM * 0.55;
    return { red: { x: 0, z: -r }, blue: { x: 0, z: r } };
  }

  snapshot(): Snapshot {
    return {
      t: this.now(),
      room: this.info(),
      players: [...this.players.values()].filter((p) => !p.isReferee).map(publicView),
      objects: [...this.objects.values()].map((o) => publicObject(o)),
      projectiles: [...this.projectiles.values()].map((p) => ({ id: p.id, kind: p.kind, ownerId: p.ownerId, team: p.team, x: p.x, z: p.z, y: p.y, heading: p.heading, t0: p.t0 })),
    };
  }

  broadcast(msg: ServerMsg): void {
    for (const p of this.players.values()) p.client.send(msg);
  }

  /* ---------------- membership ---------------- */

  join(
    client: Client,
    opts: { nick: string; avatar: AvatarId; playMode: PlayMode; deviceId: string; team?: Team; isReferee?: boolean },
  ): Player {
    if (this.players.has(client.id)) return this.players.get(client.id)!;
    const nonRef = [...this.players.values()].filter((p) => !p.isReferee).length;
    if (!opts.isReferee && nonRef >= GAME.MAX_PLAYERS_PER_ROOM) throw new Error("room_full");
    const team = opts.isReferee ? "red" : this.pickTeam(opts.team);
    const p: Player = {
      id: client.id,
      client,
      deviceId: opts.deviceId,
      nick: sanitizeNick(opts.nick),
      team,
      avatar: opts.avatar,
      playMode: opts.playMode,
      x: 0,
      z: 0,
      heading: 0,
      hp: GAME.MAX_HP,
      alive: true,
      kills: 0,
      deaths: 0,
      supply: GAME.SUPPLY_PER_PLAYER,
      acc: 999,
      t: 0,
      lastSample: null,
      lastShotAt: 0,
      respawnAt: 0,
      outOfBoundsSince: 0,
      lastWarnAt: 0,
      isReferee: !!opts.isReferee,
      shield: 0,
      ammo: GAME.WEAPONS.rocket.AMMO,
      weapon: "blaster",
      overchargeUntil: 0,
      protectedUntil: 0,
      lastShotByWeapon: { pistol: 0, blaster: 0, sniper: 0, rocket: 0 },
      mag: fullMags(),
      reserve: fullReserve(),
      reloadUntil: 0,
      bloom: 0,
      zoomed: false,
      bloomAt: 0,
    };
    this.players.set(p.id, p);
    this.lastActiveAt = this.now();
    return p;
  }

  leave(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    if (p.hasFlag) this.dropFlag(p);
    this.players.delete(clientId);
    this.lastActiveAt = this.now();
  }

  private pickTeam(pref?: Team): Team {
    const counts: Record<Team, number> = { red: 0, blue: 0 };
    for (const p of this.players.values()) if (!p.isReferee) counts[p.team]++;
    if (pref && counts[pref] <= counts[other(pref)]) return pref;
    return counts.red <= counts.blue ? "red" : "blue";
  }

  /* ---------------- input ---------------- */

  updatePosition(p: Player, lat: number, lon: number, acc: number, heading: number): void {
    const t = this.now();
    const sample: PosSample = { lat, lon, acc, t };
    const verdict = checkPlausible(p.lastSample, sample);
    if (!verdict.ok) {
      if (verdict.reason === "accuracy") this.warn(p, "gps_poor", `GPS точность ${Math.round(acc)} м — подойди на открытое место`);
      else if (verdict.reason !== "nan") this.warn(p, "speed", "Подозрительное перемещение — позиция отклонена");
      // Still accept heading so aiming works while stationary.
      if (Number.isFinite(heading)) p.heading = ((heading % 360) + 360) % 360;
      return;
    }
    p.lastSample = sample;
    const v = toLocal(this.origin, sample);
    p.x = v.x;
    p.z = v.z;
    p.acc = acc;
    p.heading = ((heading % 360) + 360) % 360;
    p.t = t;
    this.lastActiveAt = t;
    this.checkBounds(p, sample);
  }

  private checkBounds(p: Player, s: LatLon): void {
    const inside = this.polygon && this.polygon.length >= 3 ? insidePolygon(this.polygon, s) : insideCircle(this.origin, this.radiusM, s);
    const t = this.now();
    if (!inside) {
      if (!p.outOfBoundsSince) p.outOfBoundsSince = t;
      this.warn(p, "out_of_bounds", "Ты за границей зоны! Вернись — иначе не сможешь стрелять");
    } else {
      p.outOfBoundsSince = 0;
      if (!this.polygon) {
        const d = this.radiusM - haversine(this.origin, s);
        if (d < GAME.GEOFENCE_WARN_M) this.warn(p, "near_border", "Граница зоны рядом");
      }
    }
  }

  private warn(p: Player, code: Parameters<Room["warnMsg"]>[0], text: string): void {
    const t = this.now();
    if (t - p.lastWarnAt < 2000) return;
    p.lastWarnAt = t;
    p.client.send(this.warnMsg(code, text));
  }
  private warnMsg(code: "out_of_bounds" | "near_border" | "gps_poor" | "speed" | "rate_limit", text: string): ServerMsg {
    return { type: "warn", code, text };
  }

  selectWeapon(p: Player, w: WeaponId): void {
    if (!WEAPON_IDS.includes(w) || p.weapon === w) return;
    p.weapon = w;
    p.reloadUntil = 0; // switching cancels a reload
    if (w !== "sniper") p.zoomed = false;
  }

  setZoom(p: Player, on: boolean): void {
    p.zoomed = on && p.weapon === "sniper";
  }

  /** Start reloading the current weapon (no-op if full / nothing spare / already reloading). */
  reload(p: Player, weapon: WeaponId = p.weapon): boolean {
    const t = this.now();
    this.settleReload(p, t);
    if (p.reloadUntil > t || !p.alive) return false;
    const W = GAME.WEAPONS[weapon];
    if (weapon === "rocket") return false; // rockets have no magazine; ammo comes from pickups
    if (p.mag[weapon] >= W.MAG) return false;
    if (p.reserve[weapon] === 0) return false;
    p.reloadUntil = t + W.RELOAD_MS;
    p.weapon = weapon;
    this.broadcast({ type: "event", kind: "reload", data: { id: p.id, weapon, ms: W.RELOAD_MS } });
    return true;
  }

  /** Complete a finished reload: move rounds from reserve into the magazine. */
  private settleReload(p: Player, t: number): void {
    if (!p.reloadUntil || t < p.reloadUntil) return;
    p.reloadUntil = 0;
    const w = p.weapon;
    if (w === "rocket") return;
    const W = GAME.WEAPONS[w];
    const need = W.MAG - p.mag[w];
    const take = p.reserve[w] < 0 ? need : Math.min(need, p.reserve[w]);
    p.mag[w] += take;
    if (p.reserve[w] >= 0) p.reserve[w] -= take;
  }

  /** Rifle bloom decays once the trigger has been released for a moment (grace 250 ms). */
  private settleBloom(p: Player, t: number): void {
    const since = t - (p.bloomAt || t);
    const dt = Math.max(0, (since - 250) / 1000);
    if (dt > 0) p.bloom = Math.max(0, p.bloom - GAME.WEAPONS.blaster.BLOOM_DECAY * dt);
  }

  shoot(p: Player, heading: number, weapon: WeaponId = p.weapon, opts: { chargeMs?: number; zoomed?: boolean } = {}): void {
    const t = this.now();
    if (this.phase !== "playing" || !p.alive || p.isReferee) return;
    if (p.outOfBoundsSince) return;
    if (!p.lastSample) return;
    if (!WEAPON_IDS.includes(weapon)) weapon = "blaster";
    const W = GAME.WEAPONS[weapon];
    this.settleReload(p, t);
    this.settleBloom(p, t);
    if (p.reloadUntil > t) return;
    if (t - p.lastShotByWeapon[weapon] < W.COOLDOWN_MS) return;
    if (p.mag[weapon] <= 0) {
      p.client.send({ type: "event", kind: "empty", data: { weapon } });
      if (weapon !== "rocket") this.reload(p, weapon); // auto-reload when spare rounds exist
      return;
    }
    const prevShot = p.lastShotByWeapon[weapon];
    p.lastShotByWeapon[weapon] = t;
    p.lastShotAt = t;
    p.weapon = weapon;
    p.mag[weapon]--;
    if (weapon === "rocket") p.ammo = p.mag.rocket;
    const h = Number.isFinite(heading) ? heading : p.heading;
    p.heading = ((h % 360) + 360) % 360;

    if (weapon === "rocket") {
      this.launchRocket(p, t);
      return;
    }

    // ---- hitscan weapons: GPS-tolerant cone, blocked by barriers
    const zoomed = weapon === "sniper" && (opts.zoomed ?? p.zoomed);
    const bloomNow = p.bloom;
    const cone = (dist: number) => weaponCone(weapon, dist, bloomNow, zoomed);
    if (weapon === "blaster") {
      p.bloom = Math.min(W.CONE_MAX - W.CONE, p.bloom + W.BLOOM);
      p.bloomAt = t;
    }
    // Sniper charge: the client reports hold time; the server clamps it to the time since the previous shot.
    const charge = weapon === "sniper" ? Math.min(opts.chargeMs ?? 0, t - prevShot) : 0;
    const charged = weapon === "sniper" && charge >= W.CHARGE_MS;
    const targets = [
      ...[...this.players.values()]
        .filter((q) => q.id !== p.id && q.alive && !q.isReferee && this.isEnemy(p, q) && q.lastSample && q.protectedUntil <= t)
        .map((q) => ({ id: q.id, x: q.x, z: q.z, acc: q.acc })),
      ...[...this.objects.values()]
        .filter((o) => o.hp > 0 && o.team !== null && o.team !== p.team && (o.kind === "turret" || o.kind === "drone"))
        .map((o) => ({ id: o.id, x: o.x, z: o.z, acc: 0 })),
    ];
    const hit = resolveShot({ x: p.x, z: p.z, acc: p.acc }, p.heading, targets, W.RANGE_M, cone);
    const evt: ServerMsg = { type: "shot", weapon, shooterId: p.id, x: p.x, z: p.z, heading: p.heading };
    if (hit) {
      const tgt = this.players.get(hit.id) ?? this.objects.get(hit.id);
      const barrier = tgt ? this.barrierBetween(p, tgt) : null;
      if (barrier) {
        evt.blockedBy = barrier.id;
        this.damageObject(barrier, Math.round(W.DAMAGE / 2));
      } else {
        let dmg = charged ? W.CHARGED_DAMAGE : weapon === "sniper" ? W.DAMAGE : damageAtDistance(W.DAMAGE, hit.dist, W.RANGE_M);
        if (p.overchargeUntil > t && weapon !== "sniper") dmg *= GAME.OVERCHARGE_MULT;
        const victim = this.players.get(hit.id);
        evt.targetId = hit.id;
        evt.damage = dmg;
        if (victim) {
          evt.targetKind = "player";
          this.damagePlayer(victim, dmg, p, weapon);
        } else {
          const obj = this.objects.get(hit.id);
          if (obj) {
            evt.targetKind = "object";
            this.damageObject(obj, dmg);
          }
        }
      }
    } else {
      const wall = this.barrierBetween(p, rayEnd(p, p.heading, W.RANGE_M));
      if (wall) {
        evt.blockedBy = wall.id;
        this.damageObject(wall, Math.round(W.DAMAGE / 2));
      }
    }
    this.broadcast(evt);
  }

  private barriers(): Array<WorldObject & { id: string }> {
    return [...this.objects.values()].filter((o) => o.kind === "barrier" && o.hp > 0);
  }

  private barrierBetween(from: { x: number; z: number }, to: { x: number; z: number }): WorldObject | null {
    return firstBarrierOnPath(from, to, this.barriers());
  }

  private launchRocket(p: Player, t: number): void {
    const R = GAME.WEAPONS.rocket;
    // Aim assist: if an enemy is inside the cone, fly exactly to them; otherwise fly max range.
    const targets = [...this.players.values()]
      .filter((q) => q.id !== p.id && q.alive && !q.isReferee && this.isEnemy(p, q) && q.lastSample)
      .map((q) => ({ id: q.id, x: q.x, z: q.z, acc: q.acc }));
    const aimed = resolveShot({ x: p.x, z: p.z, acc: p.acc }, p.heading, targets, R.RANGE_M);
    const proj: ServerProjectile = {
      id: uid("rk"),
      kind: "rocket",
      ownerId: p.id,
      team: p.team,
      x: p.x,
      z: p.z,
      y: 1.4,
      heading: p.heading,
      t0: t,
      lastT: t,
      maxDist: aimed ? Math.min(R.RANGE_M, aimed.dist) : R.RANGE_M,
      travelled: 0,
    };
    this.projectiles.set(proj.id, proj);
    this.broadcast({ type: "shot", weapon: "rocket", shooterId: p.id, x: p.x, z: p.z, heading: p.heading });
  }

  private tickProjectiles(t: number): void {
    const R = GAME.WEAPONS.rocket;
    for (const pr of this.projectiles.values()) {
      const dt = Math.min(0.5, (t - pr.lastT) / 1000);
      pr.lastT = t;
      const step = R.SPEED_MPS * dt;
      const from = { x: pr.x, z: pr.z };
      const to = rayEnd(from, pr.heading, step);
      // barrier on the way → explode there
      const barrier = firstBarrierOnPath(from, to, this.barriers(), GAME.BARRIER_BLOCK_M);
      if (barrier) {
        this.explode(pr, barrier.x, barrier.z, t);
        continue;
      }
      pr.x = to.x;
      pr.z = to.z;
      pr.travelled += step;
      // proximity fuse on enemies / enemy objects
      let fuse = false;
      for (const q of this.players.values()) {
        if (!q.alive || q.isReferee || q.team === pr.team || !q.lastSample) continue;
        if (distLocal(pr, q) <= R.FUSE_M) {
          fuse = true;
          break;
        }
      }
      if (!fuse) {
        for (const o of this.objects.values()) {
          if (o.hp <= 0 || o.team === null || o.team === pr.team) continue;
          if (distLocal(pr, o) <= R.FUSE_M) {
            fuse = true;
            break;
          }
        }
      }
      if (fuse || pr.travelled >= pr.maxDist) this.explode(pr, pr.x, pr.z, t);
    }
  }

  private explode(pr: ServerProjectile, x: number, z: number, t: number): void {
    this.projectiles.delete(pr.id);
    const R = GAME.WEAPONS.rocket;
    const owner = this.players.get(pr.ownerId) ?? null;
    const victims: Array<{ id: string; damage: number }> = [];
    for (const q of this.players.values()) {
      if (!q.alive || q.isReferee || !q.lastSample || q.protectedUntil > t) continue;
      if (q.team === pr.team && q.id !== pr.ownerId) continue; // no team damage; self-damage allowed
      const d = distLocal({ x, z }, q);
      const dmg = splashDamage(d, R.SPLASH_M, q.id === pr.ownerId ? Math.round(R.DAMAGE / 2) : R.DAMAGE, R.DAMAGE_EDGE);
      if (dmg > 0) {
        victims.push({ id: q.id, damage: dmg });
        this.damagePlayer(q, dmg, owner, "rocket");
      }
    }
    for (const o of [...this.objects.values()]) {
      if (o.hp <= 0 || o.team === null || o.team === pr.team) continue;
      if (o.kind !== "turret" && o.kind !== "barrier" && o.kind !== "drone") continue;
      const dmg = splashDamage(distLocal({ x, z }, o), R.SPLASH_M, R.DAMAGE * 2, R.DAMAGE_EDGE);
      if (dmg > 0) {
        victims.push({ id: o.id, damage: dmg });
        this.damageObject(o, dmg);
      }
    }
    this.broadcast({ type: "event", kind: "explosion", data: { x, z, r: R.SPLASH_M, by: pr.ownerId, victims } });
  }

  placeObject(p: Player, kind: ObjectKind, at?: LatLon): WorldObject | null {
    if (this.phase === "ended" || p.isReferee) return null;
    if (kind !== "turret" && kind !== "barrier" && kind !== "drone" && kind !== "medkit") return null;
    const cost = kind === "turret" ? GAME.TURRET.COST : kind === "drone" ? GAME.DRONE.COST : 1;
    if (p.supply < cost) return null;
    if (kind === "turret" || kind === "drone") {
      const max = kind === "turret" ? GAME.TURRET.MAX_PER_TEAM : GAME.DRONE.MAX_PER_TEAM;
      const mine = [...this.objects.values()].filter((o) => o.kind === kind && o.team === p.team && o.hp > 0).length;
      if (mine >= max) return null;
    }
    let pos: LatLon;
    if (at && Number.isFinite(at.lat) && Number.isFinite(at.lon)) {
      pos = at;
      if (p.lastSample && haversine(p.lastSample, pos) > 15) return null; // must be placed nearby
    } else {
      if (!p.lastSample) return null;
      pos = destination(p.lastSample, p.heading, 2);
    }
    const v = toLocal(this.origin, pos);
    const obj: WorldObject = {
      id: uid("obj"),
      kind,
      team: kind === "medkit" ? null : p.team,
      ownerId: p.id,
      x: v.x,
      z: v.z,
      hp: kind === "turret" ? GAME.TURRET.HP : kind === "barrier" ? GAME.BARRIER_HP : kind === "drone" ? GAME.DRONE.HP : 1,
      heading: p.heading,
    };
    if (kind === "turret") (obj as Turret).lastShotAt = 0;
    if (kind === "drone") {
      const d = obj as Drone;
      d.lastShotAt = 0;
      d.cx = v.x;
      d.cz = v.z;
      d.phase = 0;
      d.y = GAME.DRONE.ALT_M;
      d.expiresAt = this.now() + GAME.DRONE.TTL_MS;
    }
    this.objects.set(obj.id, obj);
    p.supply -= cost;
    this.broadcast({ type: "event", kind: "object_placed", data: { id: obj.id, kind, by: p.id } });
    return obj;
  }

  /* ---------------- referee ---------------- */

  start(): void {
    const t = this.now();
    this.phase = "countdown";
    this.phaseEndsAt = t + 10_000;
    this.score = { red: 0, blue: 0 };
    for (const p of this.players.values()) {
      p.hp = GAME.MAX_HP;
      p.alive = true;
      p.kills = 0;
      p.deaths = 0;
      p.supply = GAME.SUPPLY_PER_PLAYER;
      p.hasFlag = false;
      p.infected = false;
      p.shield = 0;
      p.overchargeUntil = 0;
      p.protectedUntil = 0;
      p.respawnAt = 0;
      this.resetLoadout(p);
    }
    this.objects.clear();
    this.projectiles.clear();
    this.lastPickupSpawn = 0;
    this.setupMode();
  }

  stop(): void {
    this.endRound();
  }

  reset(): void {
    this.phase = "lobby";
    this.phaseEndsAt = 0;
    this.objects.clear();
    this.projectiles.clear();
    this.score = { red: 0, blue: 0 };
    for (const p of this.players.values()) {
      p.hp = GAME.MAX_HP;
      p.alive = true;
      p.hasFlag = false;
      p.infected = false;
      p.shield = 0;
      p.respawnAt = 0;
      this.resetLoadout(p);
    }
  }

  private resetLoadout(p: Player): void {
    p.mag = fullMags();
    p.reserve = fullReserve();
    p.ammo = p.mag.rocket;
    p.reloadUntil = 0;
    p.bloom = 0;
    p.zoomed = false;
  }

  setZone(origin?: LatLon, radiusM?: number, polygon?: LatLon[]): void {
    // Re-anchor: convert existing local coords to new origin.
    const newOrigin = origin ?? this.origin;
    if (origin) {
      for (const p of this.players.values()) {
        if (p.lastSample) {
          const v = toLocal(newOrigin, p.lastSample);
          p.x = v.x;
          p.z = v.z;
        }
      }
      for (const o of this.objects.values()) {
        const ll = fromLocal(this.origin, o);
        const v = toLocal(newOrigin, ll);
        o.x = v.x;
        o.z = v.z;
      }
      this.origin = newOrigin;
    }
    if (radiusM) this.radiusM = Math.min(1000, Math.max(20, radiusM));
    this.polygon = polygon && polygon.length >= 3 ? polygon : undefined;
  }

  /* ---------------- simulation ---------------- */

  /** Advance the room by one tick. Returns true if a snapshot should be broadcast. */
  tick(): void {
    const t = this.now();
    if (this.phase === "countdown" && t >= this.phaseEndsAt) {
      this.phase = "playing";
      this.phaseEndsAt = t + GAME.ROUND_MS;
      this.kothLastTick = t;
      this.broadcast({ type: "event", kind: "round_start" });
    }
    if (this.phase !== "playing") return;
    if (t >= this.phaseEndsAt) {
      this.endRound();
      return;
    }
    this.lastTickAt = t;
    for (const p of this.players.values()) this.settleReload(p, t);
    this.tickRespawns(t);
    this.tickProjectiles(t);
    this.tickTurrets(t);
    this.tickDrones(t);
    this.tickPickups(t);
    this.tickMode(t);
  }

  /**
   * Dead players respawn by walking to their base (BASE_RADIUS_M) once RESPAWN_MS has passed,
   * or automatically after RESPAWN_MS + RESPAWN_AUTO_MS. Respawn grants spawn protection.
   */
  private tickRespawns(t: number): void {
    const bases = this.bases();
    for (const p of this.players.values()) {
      if (p.alive || !p.respawnAt || t < p.respawnAt) continue;
      const base = bases[p.team];
      const atBase = p.lastSample ? distLocal(p, base) <= GAME.BASE_RADIUS_M : false;
      if (atBase || t >= p.respawnAt + GAME.RESPAWN_AUTO_MS) this.respawn(p, t);
    }
  }

  private respawn(p: Player, t: number): void {
    p.alive = true;
    p.hp = GAME.MAX_HP;
    p.shield = 0;
    this.resetLoadout(p);
    p.respawnAt = 0;
    p.protectedUntil = t + GAME.SPAWN_PROTECT_MS;
    this.broadcast({ type: "event", kind: "respawn", data: { id: p.id } });
  }

  private tickDrones(t: number): void {
    const D = GAME.DRONE;
    const dt = Math.min(0.5, (t - (this.lastTickAt || t)) / 1000) || 1 / GAME.TICK_HZ;
    for (const o of [...this.objects.values()]) {
      if (o.kind !== "drone" || o.hp <= 0) continue;
      const d = o as Drone;
      if (d.expiresAt && t >= d.expiresAt) {
        this.objects.delete(d.id);
        this.broadcast({ type: "event", kind: "object_destroyed", data: { id: d.id, kind: "drone" } });
        continue;
      }
      // Orbit the placement point; when an enemy is near, orbit them instead.
      let target: Player | null = null;
      let bestD = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive || p.isReferee || !p.lastSample || p.outOfBoundsSince || p.team === d.team || p.protectedUntil > t) continue;
        const dist = distLocal({ x: d.cx, z: d.cz }, p);
        if (dist <= D.RANGE_M && dist < bestD) {
          target = p;
          bestD = dist;
        }
      }
      d.phase += (D.SPEED_MPS / D.ORBIT_M) * dt;
      const c = target ? { x: target.x, z: target.z } : { x: d.cx, z: d.cz };
      const r = target ? D.ORBIT_M * 0.5 : D.ORBIT_M;
      d.x = c.x + Math.cos(d.phase) * r;
      d.z = c.z + Math.sin(d.phase) * r;
      d.heading = target ? bearingLocal(d, target) : (d.phase * 180) / Math.PI + 90;
      if (target && t - d.lastShotAt >= D.COOLDOWN_MS && !this.barrierBetween(d, target)) {
        d.lastShotAt = t;
        this.broadcast({ type: "shot", weapon: "drone", shooterId: d.id, x: d.x, z: d.z, heading: d.heading, targetId: target.id, targetKind: "player", damage: D.DAMAGE });
        const owner = d.ownerId ? this.players.get(d.ownerId) ?? null : null;
        this.damagePlayer(target, D.DAMAGE, owner, "drone");
      }
    }
  }

  /** Spawns random pickups inside the zone and applies them on proximity. */
  private tickPickups(t: number): void {
    const alivePickups = [...this.objects.values()].filter((o) => o.team === null && PICKUP_KINDS.includes(o.kind as PickupKind));
    for (const o of alivePickups) {
      if (o.expiresAt && t >= o.expiresAt) {
        this.objects.delete(o.id);
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive || p.isReferee || !p.lastSample || distLocal(o, p) > GAME.PICKUP_RADIUS_M) continue;
        if (!this.applyPickup(p, o.kind as PickupKind, t)) continue;
        this.objects.delete(o.id);
        this.broadcast({ type: "event", kind: "pickup", data: { id: o.id, kind: o.kind, by: p.id } });
        break;
      }
    }
    const count = [...this.objects.values()].filter((o) => o.team === null && PICKUP_KINDS.includes(o.kind as PickupKind)).length;
    if (count < GAME.PICKUP_MAX && t - this.lastPickupSpawn >= GAME.PICKUP_INTERVAL_MS * (this.lastPickupSpawn ? 1 : 0.3)) {
      this.lastPickupSpawn = t;
      this.spawnPickup(t);
    }
  }

  private applyPickup(p: Player, kind: PickupKind, t: number): boolean {
    switch (kind) {
      case "medkit":
        if (p.hp >= GAME.MAX_HP) return false;
        p.hp = Math.min(GAME.MAX_HP, p.hp + 50);
        return true;
      case "ammo": {
        const primary = p.weapon === "rocket" || p.weapon === "pistol" ? "blaster" : p.weapon;
        const full = p.mag.rocket >= GAME.WEAPONS.rocket.AMMO + 2 && (p.reserve[primary] < 0 || p.reserve[primary] >= GAME.WEAPONS[primary].RESERVE);
        if (full) return false;
        p.mag.rocket = Math.min(GAME.WEAPONS.rocket.AMMO + 2, p.mag.rocket + 2);
        p.ammo = p.mag.rocket;
        if (p.reserve[primary] >= 0) p.reserve[primary] = Math.min(GAME.WEAPONS[primary].RESERVE, p.reserve[primary] + GAME.WEAPONS[primary].MAG);
        return true;
      }
      case "shield":
        if (p.shield >= GAME.SHIELD_MAX) return false;
        p.shield = GAME.SHIELD_MAX;
        return true;
      case "overcharge":
        p.overchargeUntil = t + GAME.OVERCHARGE_MS;
        return true;
      case "supply":
        p.supply += 2;
        return true;
    }
  }

  /** Random pickup at a random point inside 80 % of the zone, away from bases. */
  spawnPickup(t: number, kind?: PickupKind): WorldObject {
    const k = kind ?? PICKUP_KINDS[Math.floor(this.rng() * PICKUP_KINDS.length)]!;
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * this.radiusM * 0.8;
    const obj: WorldObject = {
      id: uid("pk"),
      kind: k,
      team: null,
      ownerId: null,
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      hp: 1,
      expiresAt: t + GAME.PICKUP_TTL_MS,
    };
    this.objects.set(obj.id, obj);
    this.broadcast({ type: "event", kind: "pickup_spawned", data: { id: obj.id, kind: k, x: obj.x, z: obj.z } });
    return obj;
  }

  private tickTurrets(t: number): void {
    for (const o of this.objects.values()) {
      if (o.kind !== "turret" || o.hp <= 0) continue;
      const turret = o as Turret;
      if (t - (turret.lastShotAt ?? 0) < GAME.TURRET.COOLDOWN_MS) continue;
      let best: Player | null = null;
      let bestD = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive || p.isReferee || !p.lastSample || p.outOfBoundsSince || p.protectedUntil > t) continue;
        if (o.team && !this.isEnemyTeam(o.team, p)) continue;
        const d = distLocal(o, p);
        if (d <= GAME.TURRET.RANGE_M && d < bestD && !this.barrierBetween(o, p)) {
          best = p;
          bestD = d;
        }
      }
      if (!best) continue;
      turret.lastShotAt = t;
      o.heading = bearingLocal(o, best);
      const dmg = damageAtDistance(GAME.TURRET.DAMAGE, bestD, GAME.TURRET.RANGE_M);
      this.broadcast({ type: "shot", weapon: "turret", shooterId: o.id, x: o.x, z: o.z, heading: o.heading, targetId: best.id, targetKind: "player", damage: dmg });
      const owner = o.ownerId ? this.players.get(o.ownerId) ?? null : null;
      this.damagePlayer(best, dmg, owner, "turret");
    }
  }

  /* ---------------- modes ---------------- */

  private setupMode(): void {
    if (this.mode === "ctf") {
      // Flags at ±60% radius north/south of origin.
      const r = this.radiusM * 0.6;
      for (const team of TEAMS) {
        const z = team === "red" ? -r : r;
        this.objects.set(`flag_${team}`, { id: `flag_${team}`, kind: "flag", team, ownerId: null, x: 0, z, hp: 1, carriedBy: null });
      }
    } else if (this.mode === "koth") {
      this.hill = { x: 0, z: 0, r: Math.max(8, this.radiusM * 0.15) };
    } else if (this.mode === "infection") {
      const ps = [...this.players.values()].filter((p) => !p.isReferee);
      for (const p of ps) p.team = "blue";
      const first = ps[Math.floor(Math.random() * ps.length)];
      if (first) {
        first.team = "red";
        first.infected = true;
        this.broadcast({ type: "event", kind: "infected", data: { id: first.id } });
      }
    } else if (this.mode === "turret_defense") {
      // Blue defends the centre; red attacks. Blue gets extra supply.
      for (const p of this.players.values()) if (p.team === "blue") p.supply += 3;
      this.hill = { x: 0, z: 0, r: Math.max(8, this.radiusM * 0.12) };
    }
  }

  private tickMode(t: number): void {
    if (this.mode === "ctf") this.tickCtf();
    else if (this.mode === "koth" || this.mode === "turret_defense") this.tickKoth(t);
    else if (this.mode === "infection") {
      const alive = [...this.players.values()].filter((p) => !p.isReferee);
      if (alive.length > 1 && alive.every((p) => p.team === "red")) this.endRound();
    }
  }

  private tickCtf(): void {
    for (const team of TEAMS) {
      const flag = this.objects.get(`flag_${team}`);
      if (!flag) continue;
      if (flag.carriedBy) {
        const c = this.players.get(flag.carriedBy);
        if (!c || !c.alive) {
          flag.carriedBy = null;
          if (c) c.hasFlag = false;
          continue;
        }
        flag.x = c.x;
        flag.z = c.z;
        // capture: carrier at own base flag position (home)
        const home = this.objects.get(`flag_${c.team}`);
        if (home && !home.carriedBy && distLocal(c, home) <= 5) {
          this.score[c.team]++;
          c.hasFlag = false;
          flag.carriedBy = null;
          flag.x = 0;
          flag.z = team === "red" ? -this.radiusM * 0.6 : this.radiusM * 0.6;
          this.broadcast({ type: "event", kind: "flag_captured", data: { by: c.id, team: c.team } });
        }
      } else {
        for (const p of this.players.values()) {
          if (!p.alive || p.isReferee || p.team === team || p.hasFlag) continue;
          if (distLocal(p, flag) <= 4) {
            flag.carriedBy = p.id;
            p.hasFlag = true;
            this.broadcast({ type: "event", kind: "flag_taken", data: { by: p.id, team } });
            break;
          }
        }
      }
    }
  }

  private tickKoth(t: number): void {
    if (!this.hill) return;
    const dt = (t - this.kothLastTick) / 1000;
    if (dt < 1) return;
    this.kothLastTick = t;
    const inside: Record<Team, number> = { red: 0, blue: 0 };
    for (const p of this.players.values()) {
      if (!p.alive || p.isReferee || !p.lastSample) continue;
      if (distLocal(p, this.hill) <= this.hill.r) inside[p.team]++;
    }
    if (inside.red > 0 && inside.blue === 0) this.score.red += Math.round(dt);
    else if (inside.blue > 0 && inside.red === 0) this.score.blue += Math.round(dt);
  }

  /* ---------------- damage ---------------- */

  private isEnemy(a: Player, b: Player): boolean {
    return a.team !== b.team;
  }
  private isEnemyTeam(team: Team, p: Player): boolean {
    return p.team !== team;
  }

  private damagePlayer(victim: Player, dmg: number, attacker: Player | null, weapon: KillWeapon): void {
    if (!victim.alive) return;
    if (victim.shield > 0) {
      const absorbed = Math.min(victim.shield, dmg);
      victim.shield -= absorbed;
      dmg -= absorbed;
    }
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.client.send({ type: "hit", by: attacker?.id ?? weapon, damage: dmg, hp: victim.hp });
    if (victim.hp > 0) return;
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = this.now() + GAME.RESPAWN_MS;
    if (victim.hasFlag) this.dropFlag(victim);
    if (attacker && attacker.id !== victim.id) {
      attacker.kills++;
      if (this.mode === "tdm") this.score[attacker.team]++;
    }
    if (this.mode === "infection" && victim.team === "blue") {
      victim.team = "red";
      victim.infected = true;
      this.broadcast({ type: "event", kind: "infected", data: { id: victim.id } });
    }
    this.broadcast({ type: "kill", killerId: attacker?.id ?? weapon, victimId: victim.id, weapon });
    this.events.onKill?.(this, attacker?.id ?? weapon, victim.id, weapon);
  }

  private damageObject(o: WorldObject, dmg: number): void {
    o.hp = Math.max(0, o.hp - dmg);
    if (o.hp === 0) {
      this.objects.delete(o.id);
      this.broadcast({ type: "event", kind: "object_destroyed", data: { id: o.id, kind: o.kind } });
    }
  }

  private dropFlag(p: Player): void {
    for (const f of this.objects.values()) {
      if (f.kind === "flag" && f.carriedBy === p.id) {
        f.carriedBy = null;
        f.x = p.x;
        f.z = p.z;
        this.broadcast({ type: "event", kind: "flag_dropped", data: { by: p.id } });
      }
    }
    p.hasFlag = false;
  }

  private endRound(): void {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.phaseEndsAt = this.now();
    const snap = this.snapshot();
    this.broadcast({ type: "event", kind: "round_end", data: { score: this.score } });
    this.events.onRoundEnd?.(this, snap);
  }
}

function other(t: Team): Team {
  return t === "red" ? "blue" : "red";
}

export function sanitizeNick(n: string): string {
  const s = String(n ?? "").replace(/[^\p{L}\p{N} _\-]/gu, "").trim().slice(0, 16);
  return s || "Игрок";
}

export function publicView(p: Player): PlayerPublic {
  return {
    id: p.id,
    nick: p.nick,
    team: p.team,
    avatar: p.avatar,
    playMode: p.playMode,
    x: p.x,
    z: p.z,
    heading: p.heading,
    hp: p.hp,
    alive: p.alive,
    kills: p.kills,
    deaths: p.deaths,
    supply: p.supply,
    acc: p.acc,
    t: p.t,
    hasFlag: p.hasFlag,
    shield: p.shield,
    ammo: p.mag.rocket,
    weapon: p.weapon,
    mag: { ...p.mag },
    reserve: { ...p.reserve },
    reloadUntil: p.reloadUntil,
    bloom: Math.round(p.bloom * 10) / 10,
    zoomed: p.zoomed,
    overchargeUntil: p.overchargeUntil,
    protectedUntil: p.protectedUntil,
    respawnAt: p.alive ? 0 : p.respawnAt,
  };
}

export function publicObject(o: WorldObject): WorldObject {
  const { id, kind, team, ownerId, x, z, hp, heading, carriedBy, y, expiresAt } = o;
  const out: WorldObject = { id, kind, team, ownerId, x, z, hp };
  if (heading !== undefined) out.heading = heading;
  if (carriedBy !== undefined) out.carriedBy = carriedBy;
  if (y !== undefined) out.y = y;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return out;
}

export function fullMags(): Record<WeaponId, number> {
  return { pistol: GAME.WEAPONS.pistol.MAG, blaster: GAME.WEAPONS.blaster.MAG, sniper: GAME.WEAPONS.sniper.MAG, rocket: GAME.WEAPONS.rocket.AMMO };
}
export function fullReserve(): Record<WeaponId, number> {
  return { pistol: GAME.WEAPONS.pistol.RESERVE, blaster: GAME.WEAPONS.blaster.RESERVE, sniper: GAME.WEAPONS.sniper.RESERVE, rocket: 0 };
}

/** Small deterministic PRNG (for pickup placement; seedable in tests). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
