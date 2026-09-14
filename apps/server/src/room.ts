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
  WEAPON_IDS,
  PICKUP_KINDS,
  catalogCone,
  defaultLoadout,
  sanitizeLoadout,
  weaponById,
  type Loadout,
  type WeaponDef,
  type WeaponId,
  type Projectile,
  type GrenadeKind,
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
  /** Server time of the last throw, for the grenade cooldown. */
  lastGrenadeAt: number;
  /** Shields stay down until this server time after an EMP. */
  empUntil: number;
  grenades: Record<GrenadeKind, number>;
  /** Server time when rifle bloom was last updated. */
  bloomAt: number;
  /** Overheat seconds accumulated (rifle "overheat" trait) and lock time. */
  heat: number;
  heatAt: number;
  lockUntil: number;
  /** Burn: damage accumulator. */
  burnAcc: number;
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
  def: WeaponDef;
  /** Where the projectile will self-detonate (aimed distance). */
  maxDist: number;
  travelled: number;
  /** Grenades: where the throw started, so the arc is a function of time, not of tick size. */
  x0?: number;
  z0?: number;
  /** Grenades: how long the throw itself takes, ms. */
  flightMs?: number;
}

/** Full set of throwables, handed out on spawn and on respawn. */
function fullGrenades(): Record<GrenadeKind, number> {
  return { plasma: GAME.GRENADE.TYPES.plasma.perLife, emp: GAME.GRENADE.TYPES.emp.perLife };
}

/**
 * Turns a grenade type into the projectile definition `explode()` already
 * understands, so throwables reuse the rocket splash path instead of a second
 * damage model.
 */
function grenadeDef(kind: GrenadeKind): WeaponDef {
  const G = GAME.GRENADE.TYPES[kind];
  const base = weaponById("rocket_01") ?? ({} as WeaponDef);
  return {
    ...base,
    id: `grenade_${kind}`,
    name: kind === "emp" ? "ЭМИ-граната" : "Плазменная граната",
    damage: G.damage,
    damageEdge: G.damageEdge,
    splashM: G.splashM,
    trait: kind === "emp" ? "emp" : "none",
    color: G.color,
  };
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
  /**
   * Rounds that have left the muzzle but not yet arrived. Hitscan resolution
   * still happens at the trigger pull (that is what keeps aiming fair under GPS
   * noise), but the damage lands after the round's flight time, so a fast mover
   * can be killed where they were and a slow round can be outrun by a respawn.
   */
  private pendingHits: Array<{
    at: number;
    shooterId: string;
    targetId: string;
    damage: number;
    weapon: WeaponId;
    defId: string;
  }> = [];
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
    opts: { nick: string; avatar: AvatarId; playMode: PlayMode; deviceId: string; team?: Team; isReferee?: boolean; loadout?: unknown },
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
      lastGrenadeAt: 0,
      empUntil: 0,
      grenades: fullGrenades(),
      loadout: sanitizeLoadout(opts.loadout),
      mag: fullMags(),
      reserve: fullReserve(),
      reloadUntil: 0,
      bloom: 0,
      zoomed: false,
      bloomAt: 0,
      stunnedUntil: 0,
      burnUntil: 0,
      heat: 0,
      heatAt: 0,
      lockUntil: 0,
      burnAcc: 0,
    };
    p.mag = fullMags(p.loadout);
    p.grenades = fullGrenades();
    p.reserve = fullReserve(p.loadout);
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
    const W = this.def(p, weapon);
    if (weapon === "rocket" && W.reserve === 0) return false; // heavy ammo comes from pickups
    if (p.mag[weapon] >= W.mag) return false;
    if (p.reserve[weapon] === 0) return false;
    p.reloadUntil = t + W.reloadMs;
    p.weapon = weapon;
    this.broadcast({ type: "event", kind: "reload", data: { id: p.id, weapon, ms: W.reloadMs } });
    return true;
  }

  /** Complete a finished reload: move rounds from reserve into the magazine. */
  private settleReload(p: Player, t: number): void {
    if (!p.reloadUntil || t < p.reloadUntil) return;
    p.reloadUntil = 0;
    const w = p.weapon;
    const W = this.def(p, w);
    const need = W.mag - p.mag[w];
    const take = p.reserve[w] < 0 ? need : Math.min(need, p.reserve[w]);
    p.mag[w] += take;
    if (p.reserve[w] >= 0) p.reserve[w] -= take;
  }

  /** Rifle bloom decays once the trigger has been released for a moment (grace 250 ms). */
  private settleBloom(p: Player, t: number): void {
    const since = t - (p.bloomAt || t);
    const dt = Math.max(0, (since - 250) / 1000);
    if (dt > 0) p.bloom = Math.max(0, p.bloom - this.def(p, "blaster").bloomDecay * dt);
    // overheat cools at 1 s of heat per second when not firing
    const hs = Math.max(0, (t - (p.heatAt || t) - 250) / 1000);
    if (hs > 0) {
      p.heat = Math.max(0, p.heat - hs);
      p.heatAt = t;
    }
  }

  shoot(p: Player, heading: number, weapon: WeaponId = p.weapon, opts: { chargeMs?: number; zoomed?: boolean; pitch?: number } = {}): void {
    const t = this.now();
    if (this.phase !== "playing" || !p.alive || p.isReferee) return;
    if (p.outOfBoundsSince) return;
    if (!p.lastSample) return;
    if (!WEAPON_IDS.includes(weapon)) weapon = "blaster";
    const W = this.def(p, weapon);
    this.settleReload(p, t);
    this.settleBloom(p, t);
    if (p.reloadUntil > t || p.stunnedUntil > t || p.lockUntil > t) return;
    if (t - p.lastShotByWeapon[weapon] < W.cooldownMs) return;
    if (p.mag[weapon] <= 0) {
      p.client.send({ type: "event", kind: "empty", data: { weapon } });
      this.reload(p, weapon); // auto-reload when spare rounds exist
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

    if (W.trait === "overheat") {
      p.heat += W.cooldownMs / 1000;
      p.heatAt = t;
      if (p.heat >= 6) {
        p.heat = 0;
        p.lockUntil = t + 3000;
        p.client.send({ type: "event", kind: "overheat", data: { ms: 3000 } });
      }
    }

    const aimPitch = Number.isFinite(opts.pitch) ? (opts.pitch as number) : undefined;
    if (weapon === "rocket" && W.pellets <= 1) {
      this.launchRocket(p, t, W, aimPitch);
      return;
    }

    // ---- hitscan weapons: GPS-tolerant cone, blocked by barriers, traits
    const zoomed = weapon === "sniper" && (opts.zoomed ?? p.zoomed);
    const bloomNow = p.bloom;
    const cone = (dist: number) => catalogCone(W, dist, bloomNow, zoomed);
    if (weapon === "blaster") {
      p.bloom = Math.max(0, Math.min(W.coneMax - W.cone, p.bloom + W.bloom));
      p.bloomAt = t;
    }
    const charge = W.trait === "charge" ? Math.min(opts.chargeMs ?? 0, t - prevShot) : 0;
    const charged = W.trait === "charge" && charge >= W.chargeMs;
    const enemies = [...this.players.values()].filter((q) => q.id !== p.id && q.alive && !q.isReferee && this.isEnemy(p, q) && q.lastSample && q.protectedUntil <= t);
    const allies = W.trait === "heal" ? [...this.players.values()].filter((q) => q.id !== p.id && q.alive && !q.isReferee && !this.isEnemy(p, q) && q.lastSample && q.hp < GAME.MAX_HP) : [];
    const targets = [
      ...enemies.map((q) => ({ id: q.id, x: q.x, z: q.z, acc: q.acc })),
      ...allies.map((q) => ({ id: q.id, x: q.x, z: q.z, acc: q.acc })),
      ...[...this.objects.values()]
        .filter((o) => o.hp > 0 && o.team !== null && o.team !== p.team && (o.kind === "turret" || o.kind === "drone"))
        .map((o) => ({ id: o.id, x: o.x, z: o.z, acc: 0 })),
    ];
    const evt: ServerMsg = { type: "shot", weapon, weaponId: W.id, shooterId: p.id, x: p.x, z: p.z, heading: p.heading, pitch: aimPitch };
    const rounds = Math.max(1, W.burst) * Math.max(1, W.pellets);
    // burst consumes extra rounds from the magazine (pellets don't)
    if (W.burst > 1) p.mag[weapon] = Math.max(0, p.mag[weapon] - (W.burst - 1));
    const extra: Array<{ targetId: string; damage: number }> = [];
    let firstDone = false;
    for (let n = 0; n < rounds; n++) {
      // pellets scatter: jitter the aim inside the cone
      const jitter = W.pellets > 1 ? (this.rng() * 2 - 1) * W.cone * 0.8 : 0;
      const hit = resolveShot({ x: p.x, z: p.z, acc: p.acc }, p.heading + jitter, targets, W.rangeM, cone, { pitch: aimPitch });
      if (!hit) continue;
      const tgt = this.players.get(hit.id) ?? this.objects.get(hit.id);
      if (!tgt) continue;
      // A rail slug goes through cover; everything else is stopped by it.
      const barrier = W.piercesCover ? null : this.barrierBetween(p, tgt);
      if (barrier) {
        if (!firstDone) evt.blockedBy = barrier.id;
        this.damageObject(barrier, Math.round(W.damage / 2));
        continue;
      }
      let dmg = charged ? W.chargedDamage : weapon === "sniper" ? W.damage : damageAtDistance(W.damage, hit.dist, W.rangeM);
      if (p.overchargeUntil > t && weapon !== "sniper") dmg *= GAME.OVERCHARGE_MULT;
      const victim = this.players.get(hit.id);
      if (victim && !this.isEnemy(p, victim)) {
        // heal trait: ally hit heals
        victim.hp = Math.min(GAME.MAX_HP, victim.hp + dmg);
        this.broadcast({ type: "event", kind: "heal", data: { id: victim.id, by: p.id, amount: dmg } });
        if (!firstDone) {
          evt.targetId = victim.id;
          evt.targetKind = "player";
          evt.damage = 0;
        }
        firstDone = true;
        continue;
      }
      if (!firstDone) {
        evt.targetId = hit.id;
        evt.targetKind = victim ? "player" : "object";
        evt.damage = dmg;
        firstDone = true;
      } else extra.push({ targetId: hit.id, damage: dmg });
      // Flight time. Anything slower than a rail slug arrives late.
      const flightMs = (hit.dist / Math.max(1, W.speedMps)) * 1000;
      if (flightMs >= 30) {
        this.pendingHits.push({ at: t + flightMs, shooterId: p.id, targetId: hit.id, damage: dmg, weapon, defId: W.id });
      } else if (victim) {
        this.applyHit(p, victim, dmg, weapon, W, t);
      } else {
        const obj = this.objects.get(hit.id);
        if (obj) this.damageObject(obj, dmg);
      }
    }
    if (!firstDone && !evt.blockedBy) {
      const wall = this.barrierBetween(p, rayEnd(p, p.heading, W.rangeM));
      if (wall) {
        evt.blockedBy = wall.id;
        this.damageObject(wall, Math.round(W.damage / 2));
      }
    }
    if (extra.length) evt.extraHits = extra;
    this.broadcast(evt);
  }

  /** Apply a hit with the weapon's trait side effects. */
  private applyHit(p: Player, victim: Player, dmg: number, weapon: KillWeapon, W: WeaponDef, t: number): void {
    const pierce = W.piercesShield;
    this.damagePlayer(victim, dmg, p, weapon, pierce);
    if (W.burnS > 0) {
      victim.burnUntil = Math.max(victim.burnUntil, t + W.burnS * 1000);
      this.broadcast({ type: "event", kind: "burn", data: { id: victim.id, s: W.burnS } });
    }
    if (W.stunMs > 0) {
      victim.stunnedUntil = Math.max(victim.stunnedUntil, t + W.stunMs);
      this.broadcast({ type: "event", kind: "stun", data: { id: victim.id, ms: W.stunMs } });
    }
    if (W.trait === "lifesteal") p.hp = Math.min(GAME.MAX_HP, p.hp + Math.round(dmg * 0.3));
    if (W.trait === "chain") {
      let best: Player | null = null;
      let bd = 6;
      for (const q of this.players.values()) {
        if (q.id === victim.id || q.id === p.id || !q.alive || q.isReferee || !this.isEnemy(p, q) || q.protectedUntil > t) continue;
        const d = distLocal(victim, q);
        if (d <= bd) {
          best = q;
          bd = d;
        }
      }
      if (best) {
        const cd = Math.max(1, Math.round(dmg * 0.5));
        this.damagePlayer(best, cd, p, weapon, pierce);
        this.broadcast({ type: "shot", weapon, weaponId: W.id, shooterId: p.id, x: victim.x, z: victim.z, heading: bearingLocal(victim, best), targetId: best.id, targetKind: "player", damage: cd });
      }
    }
  }

  private barriers(): Array<WorldObject & { id: string }> {
    return [...this.objects.values()].filter((o) => o.kind === "barrier" && o.hp > 0);
  }

  private barrierBetween(from: { x: number; z: number }, to: { x: number; z: number }): WorldObject | null {
    return firstBarrierOnPath(from, to, this.barriers());
  }

  private launchRocket(p: Player, t: number, W: WeaponDef, aimPitch?: number): void {
    // Aim assist: if an enemy (or ally for heal) is inside the cone, fly exactly to them; otherwise max range.
    const heal = W.trait === "heal";
    const targets = [...this.players.values()]
      .filter((q) => q.id !== p.id && q.alive && !q.isReferee && (heal ? !this.isEnemy(p, q) : this.isEnemy(p, q)) && q.lastSample)
      .map((q) => ({ id: q.id, x: q.x, z: q.z, acc: q.acc }));
    const aimed = resolveShot({ x: p.x, z: p.z, acc: p.acc }, p.heading, targets, W.rangeM, W.cone, { pitch: aimPitch });
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
      maxDist: aimed ? Math.min(W.rangeM, aimed.dist) : W.rangeM,
      travelled: 0,
      def: W,
    };
    this.projectiles.set(proj.id, proj);
    this.broadcast({ type: "shot", weapon: "rocket", weaponId: W.id, shooterId: p.id, x: p.x, z: p.z, heading: p.heading, pitch: aimPitch });
  }

  /**
   * Throw a grenade. Range comes from the aim pitch (docs/TZ.md): level throws
   * to MIN_RANGE_M, fully tilted up to MAX_RANGE_M. The fuse starts on release,
   * so a grenade cannot be cooked.
   */
  throwGrenade(p: Player, kind: GrenadeKind, heading: number, pitch: number): void {
    const t = this.now();
    if (this.phase !== "playing" || !p.alive || p.isReferee) return;
    if (p.outOfBoundsSince || !p.lastSample) return;
    if (p.stunnedUntil > t) return;
    if (kind !== "plasma" && kind !== "emp") return;
    if ((p.grenades[kind] ?? 0) <= 0) return;
    if (t - p.lastGrenadeAt < GAME.GRENADE.COOLDOWN_MS) return;

    const G = GAME.GRENADE;
    const h = Number.isFinite(heading) ? heading : p.heading;
    p.heading = ((h % 360) + 360) % 360;
    const aim = Number.isFinite(pitch) ? Math.max(0, Math.min(G.MAX_PITCH_DEG, pitch)) : G.MIN_PITCH_DEG;
    const k = Math.max(0, (aim - G.MIN_PITCH_DEG) / (G.MAX_PITCH_DEG - G.MIN_PITCH_DEG));
    const range = G.MIN_RANGE_M + k * (G.MAX_RANGE_M - G.MIN_RANGE_M) + G.ROLL_M;

    p.grenades[kind] -= 1;
    p.lastGrenadeAt = t;
    const def = grenadeDef(kind);
    const proj: ServerProjectile = {
      id: uid("gr"),
      kind: "grenade",
      grenade: kind,
      ownerId: p.id,
      team: p.team,
      x: p.x,
      z: p.z,
      y: 1.4,
      heading: p.heading,
      t0: t,
      fuseAt: t + G.FUSE_MS,
      lastT: t,
      x0: p.x,
      z0: p.z,
      // The throw lands well before the fuse, then it sits there until the blast.
      flightMs: G.FUSE_MS / 2,
      maxDist: range,
      travelled: 0,
      def,
    };
    this.projectiles.set(proj.id, proj);
    this.broadcast({ type: "event", kind: "grenade", data: { id: proj.id, kind, by: p.id, x: p.x, z: p.z, heading: p.heading, range, fuseMs: G.FUSE_MS } });
  }

  /** Land the rounds whose flight time has elapsed. */
  private tickPendingHits(t: number): void {
    if (!this.pendingHits.length) return;
    const still: typeof this.pendingHits = [];
    for (const h of this.pendingHits) {
      if (h.at > t) {
        still.push(h);
        continue;
      }
      const shooter = this.players.get(h.shooterId);
      const W = weaponById(h.defId);
      if (!W) continue;
      const victim = this.players.get(h.targetId);
      if (victim) {
        // The round arrives regardless of who is watching, but a target that
        // already died (or respawned under protection) is not hit twice.
        if (!victim.alive || victim.protectedUntil > t) continue;
        if (shooter) this.applyHit(shooter, victim, h.damage, h.weapon, W, t);
        else this.damagePlayer(victim, h.damage, null, h.weapon, W.piercesShield);
        continue;
      }
      const obj = this.objects.get(h.targetId);
      if (obj && obj.hp > 0) this.damageObject(obj, h.damage);
    }
    this.pendingHits = still;
  }

  private tickProjectiles(t: number): void {
    for (const pr of this.projectiles.values()) {
      const R = { SPEED_MPS: pr.def.speedMps, FUSE_M: pr.def.fuseM };
      const heal = pr.def.trait === "heal";
      const dt = Math.min(0.5, (t - pr.lastT) / 1000);
      pr.lastT = t;
      const step = R.SPEED_MPS * dt;
      const from = { x: pr.x, z: pr.z };
      if (pr.kind === "grenade") {
        // Timed, not proximity: it flies to the landing point, stops there and
        // waits out the fuse, so enemies get the chance to back away.
        //
        // The position is derived from elapsed time rather than accumulated per
        // tick: a long tick (a stalled server, a test that jumps the clock) must
        // not leave the grenade short of where the throw was aimed.
        const flight = Math.max(1, pr.flightMs ?? 1);
        const k = Math.max(0, Math.min(1, (t - pr.t0) / flight));
        const land = rayEnd({ x: pr.x0 ?? pr.x, z: pr.z0 ?? pr.z }, pr.heading, pr.maxDist * k);
        // A grenade is lobbed, so a barrier stops it where it strikes rather
        // than letting it pass, but it still waits out its fuse there.
        const wall = firstBarrierOnPath(from, land, this.barriers(), GAME.BARRIER_BLOCK_M);
        if (wall) {
          pr.x = wall.x;
          pr.z = wall.z;
          pr.travelled = pr.maxDist;
          pr.flightMs = 1; // it has arrived; stop advancing it
          pr.x0 = wall.x;
          pr.z0 = wall.z;
          pr.maxDist = 0;
        } else {
          pr.x = land.x;
          pr.z = land.z;
          pr.travelled = pr.maxDist * k;
        }
        if (t >= (pr.fuseAt ?? t)) this.explode(pr, pr.x, pr.z, t);
        continue;
      }
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
        if (!q.alive || q.isReferee || (heal ? q.team !== pr.team || q.id === pr.ownerId : q.team === pr.team) || !q.lastSample) continue;
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

  private explode(pr: ServerProjectile, x: number, z: number, t: number, sub = false): void {
    if (!sub) this.projectiles.delete(pr.id);
    const W = pr.def;
    const owner = this.players.get(pr.ownerId) ?? null;
    const victims: Array<{ id: string; damage: number }> = [];
    const heal = W.trait === "heal";
    for (const q of this.players.values()) {
      if (!q.alive || q.isReferee || !q.lastSample) continue;
      const d = distLocal({ x, z }, q);
      if (heal) {
        if (q.team !== pr.team) continue;
        const amt = splashDamage(d, W.splashM, W.damage, W.damageEdge);
        if (amt > 0 && q.hp < GAME.MAX_HP) {
          q.hp = Math.min(GAME.MAX_HP, q.hp + amt);
          victims.push({ id: q.id, damage: -amt });
          this.broadcast({ type: "event", kind: "heal", data: { id: q.id, by: pr.ownerId, amount: amt } });
        }
        continue;
      }
      if (q.protectedUntil > t) continue;
      if (q.team === pr.team && q.id !== pr.ownerId) continue; // no team damage; self-damage allowed
      // An EMP does no damage, so the shield strip has to happen outside the
      // damage branch or a zero-damage blast would leave shields untouched.
      if (W.trait === "emp" && d <= W.splashM) {
        q.shield = 0;
        q.empUntil = Math.max(q.empUntil, t + GAME.GRENADE.TYPES.emp.disableMs);
      }
      const dmg = splashDamage(d, W.splashM, q.id === pr.ownerId ? Math.round(W.damage / 2) : W.damage, W.damageEdge);
      if (dmg > 0) {
        victims.push({ id: q.id, damage: dmg });
        if (W.trait === "emp") q.shield = 0;
        if (owner) this.applyHit(owner, q, dmg, "rocket", W, t);
        else this.damagePlayer(q, dmg, null, "rocket", W.trait === "pierce");
        if (W.trait === "lifesteal" && owner) owner.hp = Math.min(GAME.MAX_HP, owner.hp + Math.round(dmg * 0.3));
      }
    }
    for (const o of [...this.objects.values()]) {
      if (o.hp <= 0 || o.team === null || o.team === pr.team) continue;
      if (o.kind !== "turret" && o.kind !== "barrier" && o.kind !== "drone") continue;
      const d = distLocal({ x, z }, o);
      const dmg = splashDamage(d, W.splashM, W.damage * 2, W.damageEdge);
      if (dmg > 0 && !heal) {
        victims.push({ id: o.id, damage: dmg });
        this.damageObject(o, dmg);
      }
      if (W.trait === "emp" && d <= W.splashM && this.objects.has(o.id)) o.disabledUntil = t + 6000;
    }
    // Fragments: past the blast core, a thinner ring of damage that ignores the
    // falloff curve. This is what turns a grenade into area denial instead of a
    // point strike.
    const frag = pr.grenade ? GAME.GRENADE.TYPES[pr.grenade] : null;
    if (frag && frag.fragments > 0 && !sub) {
      const fragR = W.splashM * GAME.GRENADE.FRAG_RANGE_MUL;
      for (const q of this.players.values()) {
        if (!q.alive || q.isReferee || !q.lastSample) continue;
        if (q.protectedUntil > t) continue;
        if (q.team === pr.team && q.id !== pr.ownerId) continue;
        const d = distLocal({ x, z }, q);
        if (d <= W.splashM || d > fragR) continue; // the core already hit them
        if (victims.some((v) => v.id === q.id)) continue;
        const dmg = q.id === pr.ownerId ? Math.round(frag.fragDamage / 2) : frag.fragDamage;
        victims.push({ id: q.id, damage: dmg });
        if (owner) this.applyHit(owner, q, dmg, "rocket", W, t);
        else this.damagePlayer(q, dmg, null, "rocket", false);
      }
      this.broadcast({ type: "event", kind: "shrapnel", data: { x, z, r: fragR, n: frag.fragments, by: pr.ownerId } });
    }
    if (W.trait === "emp") this.broadcast({ type: "event", kind: "emp", data: { x, z, r: W.splashM } });
    this.broadcast({ type: "event", kind: "explosion", data: { x, z, r: W.splashM, by: pr.ownerId, victims, weaponId: W.id, heal } });
    if (W.trait === "cluster" && !sub) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + this.rng();
        const r = W.splashM * 0.9;
        this.explode(pr, x + Math.cos(a) * r, z + Math.sin(a) * r, t, true);
      }
    }
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
    p.mag = fullMags(p.loadout);
    p.grenades = fullGrenades();
    p.reserve = fullReserve(p.loadout);
    p.ammo = p.mag.rocket;
    p.reloadUntil = 0;
    p.bloom = 0;
    p.zoomed = false;
    p.heat = 0;
    p.lockUntil = 0;
    p.stunnedUntil = 0;
    p.burnUntil = 0;
  }

  /** Equip a catalog weapon into its slot; magazine refills to the new weapon's size. */
  equip(p: Player, slot: WeaponId, weaponId: string): boolean {
    const def = weaponById(weaponId);
    if (!def || def.slot !== slot) return false;
    p.loadout[slot] = weaponId;
    p.mag[slot] = slot === "rocket" ? def.mag : def.mag;
    p.reserve[slot] = def.reserve;
    if (slot === "rocket") p.ammo = p.mag.rocket;
    if (p.weapon === slot) p.reloadUntil = 0;
    p.bloom = 0;
    p.heat = 0;
    return true;
  }

  def(p: Player, slot: WeaponId = p.weapon): WeaponDef {
    return weaponById(p.loadout[slot]) ?? weaponById(defaultLoadout()[slot])!;
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
    for (const p of this.players.values()) this.settleReload(p, t);
    this.tickBurn(t);
    this.tickRespawns(t);
    this.tickPendingHits(t);
    this.tickProjectiles(t);
    this.tickTurrets(t);
    this.tickDrones(t);
    this.tickPickups(t);
    this.tickMode(t);
    this.lastTickAt = t;
  }

  /** Burning players take 3 HP/s (never below 1 HP from burn alone — burn cannot kill). */
  private tickBurn(t: number): void {
    const dt = Math.min(0.5, (t - (this.lastTickAt || t)) / 1000) || 1 / GAME.TICK_HZ;
    for (const p of this.players.values()) {
      if (!p.alive || p.burnUntil <= t) continue;
      p.burnAcc += 3 * dt;
      const whole = Math.floor(p.burnAcc);
      if (whole >= 1 && p.hp > 1) {
        p.burnAcc -= whole;
        p.hp = Math.max(1, p.hp - whole);
        p.client.send({ type: "hit", by: "burn", damage: whole, hp: p.hp });
      }
    }
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
      if (target && t - d.lastShotAt >= D.COOLDOWN_MS && !this.barrierBetween(d, target) && !(d.disabledUntil && d.disabledUntil > t)) {
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
        const heavy = this.def(p, "rocket");
        const prim = this.def(p, primary);
        const cap = Math.max(heavy.mag, GAME.WEAPONS.rocket.AMMO) + 2;
        const full = p.mag.rocket >= cap && (p.reserve[primary] < 0 || p.reserve[primary] >= prim.reserve);
        if (full) return false;
        p.mag.rocket = Math.min(cap, p.mag.rocket + 2);
        p.ammo = p.mag.rocket;
        if (p.reserve[primary] >= 0) p.reserve[primary] = Math.min(prim.reserve, p.reserve[primary] + prim.mag);
        return true;
      }
      case "shield":
        // An EMP keeps the emitter down, so picking up a shield mid-jam is a waste.
        if (p.empUntil > t) return false;
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
      if (o.disabledUntil && o.disabledUntil > t) continue;
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

  private damagePlayer(victim: Player, dmg: number, attacker: Player | null, weapon: KillWeapon, pierce = false): void {
    if (!victim.alive) return;
    if (victim.shield > 0 && !pierce) {
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
    grenades: { ...p.grenades },
    reserve: { ...p.reserve },
    reloadUntil: p.reloadUntil,
    bloom: Math.round(p.bloom * 10) / 10,
    zoomed: p.zoomed,
    loadout: { ...p.loadout },
    stunnedUntil: p.stunnedUntil,
    burnUntil: p.burnUntil,
    overchargeUntil: p.overchargeUntil,
    protectedUntil: p.protectedUntil,
    respawnAt: p.alive ? 0 : p.respawnAt,
  };
}

export function publicObject(o: WorldObject): WorldObject {
  const { id, kind, team, ownerId, x, z, hp, heading, carriedBy, y, expiresAt, disabledUntil } = o;
  const out: WorldObject = { id, kind, team, ownerId, x, z, hp };
  if (disabledUntil !== undefined) out.disabledUntil = disabledUntil;
  if (heading !== undefined) out.heading = heading;
  if (carriedBy !== undefined) out.carriedBy = carriedBy;
  if (y !== undefined) out.y = y;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return out;
}

export function fullMags(lo: Loadout = defaultLoadout()): Record<WeaponId, number> {
  const d = (s: WeaponId) => weaponById(lo[s]) ?? weaponById(defaultLoadout()[s])!;
  return { pistol: d("pistol").mag, blaster: d("blaster").mag, sniper: d("sniper").mag, rocket: d("rocket").mag };
}
export function fullReserve(lo: Loadout = defaultLoadout()): Record<WeaponId, number> {
  const d = (s: WeaponId) => weaponById(lo[s]) ?? weaponById(defaultLoadout()[s])!;
  return { pistol: d("pistol").reserve, blaster: d("blaster").reserve, sniper: d("sniper").reserve, rocket: d("rocket").reserve };
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
