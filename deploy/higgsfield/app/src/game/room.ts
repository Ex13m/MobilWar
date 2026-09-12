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
} from "../shared/index";

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
}

interface Turret extends WorldObject {
  kind: "turret";
  lastShotAt: number;
}

export interface RoomEvents {
  onKill?(room: Room, killerId: string, victimId: string, weapon: "rifle" | "turret"): void;
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
    };
  }

  snapshot(): Snapshot {
    return {
      t: this.now(),
      room: this.info(),
      players: [...this.players.values()].filter((p) => !p.isReferee).map(publicView),
      objects: [...this.objects.values()].map((o) => ({ ...o })),
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

  shoot(p: Player, heading: number): void {
    const t = this.now();
    if (this.phase !== "playing" || !p.alive || p.isReferee) return;
    if (p.outOfBoundsSince) return;
    if (t - p.lastShotAt < GAME.RIFLE_COOLDOWN_MS) return;
    if (!p.lastSample) return;
    p.lastShotAt = t;
    const h = Number.isFinite(heading) ? heading : p.heading;
    p.heading = ((h % 360) + 360) % 360;

    const targets = [
      ...[...this.players.values()]
        .filter((q) => q.id !== p.id && q.alive && !q.isReferee && this.isEnemy(p, q) && q.lastSample)
        .map((q) => ({ id: q.id, x: q.x, z: q.z, acc: q.acc })),
      ...[...this.objects.values()]
        .filter((o) => o.hp > 0 && o.team !== null && o.team !== p.team && (o.kind === "turret" || o.kind === "barrier"))
        .map((o) => ({ id: o.id, x: o.x, z: o.z, acc: 0 })),
    ];
    const hit = resolveShot({ x: p.x, z: p.z, acc: p.acc }, p.heading, targets);
    const evt: ServerMsg = { type: "shot", shooterId: p.id, x: p.x, z: p.z, heading: p.heading };
    if (hit) {
      const dmg = damageAtDistance(GAME.RIFLE_DAMAGE, hit.dist, GAME.RIFLE_RANGE_M);
      const victim = this.players.get(hit.id);
      if (victim) {
        evt.targetId = victim.id;
        evt.targetKind = "player";
        evt.damage = dmg;
        this.damagePlayer(victim, dmg, p, "rifle");
      } else {
        const obj = this.objects.get(hit.id);
        if (obj) {
          evt.targetId = obj.id;
          evt.targetKind = "object";
          evt.damage = dmg;
          this.damageObject(obj, dmg);
        }
      }
    }
    this.broadcast(evt);
  }

  placeObject(p: Player, kind: ObjectKind, at?: LatLon): WorldObject | null {
    if (this.phase === "ended" || p.isReferee) return null;
    if (kind === "flag") return null; // flags are placed by the mode, not players
    const cost = kind === "turret" ? GAME.TURRET.COST : 1;
    if (p.supply < cost) return null;
    if (kind === "turret") {
      const mine = [...this.objects.values()].filter((o) => o.kind === "turret" && o.team === p.team && o.hp > 0).length;
      if (mine >= GAME.TURRET.MAX_PER_TEAM) return null;
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
      hp: kind === "turret" ? GAME.TURRET.HP : kind === "barrier" ? 150 : 1,
      heading: p.heading,
    };
    if (kind === "turret") (obj as Turret).lastShotAt = 0;
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
    }
    this.objects.clear();
    this.setupMode();
  }

  stop(): void {
    this.endRound();
  }

  reset(): void {
    this.phase = "lobby";
    this.phaseEndsAt = 0;
    this.objects.clear();
    this.score = { red: 0, blue: 0 };
    for (const p of this.players.values()) {
      p.hp = GAME.MAX_HP;
      p.alive = true;
      p.hasFlag = false;
      p.infected = false;
    }
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
    // respawns
    for (const p of this.players.values()) {
      if (!p.alive && p.respawnAt && t >= p.respawnAt) {
        p.alive = true;
        p.hp = GAME.MAX_HP;
        p.respawnAt = 0;
      }
    }
    this.tickTurrets(t);
    this.tickMedkits();
    this.tickMode(t);
  }

  private tickTurrets(t: number): void {
    for (const o of this.objects.values()) {
      if (o.kind !== "turret" || o.hp <= 0) continue;
      const turret = o as Turret;
      if (t - (turret.lastShotAt ?? 0) < GAME.TURRET.COOLDOWN_MS) continue;
      let best: Player | null = null;
      let bestD = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive || p.isReferee || !p.lastSample || p.outOfBoundsSince) continue;
        if (o.team && !this.isEnemyTeam(o.team, p)) continue;
        const d = distLocal(o, p);
        if (d <= GAME.TURRET.RANGE_M && d < bestD) {
          best = p;
          bestD = d;
        }
      }
      if (!best) continue;
      turret.lastShotAt = t;
      o.heading = bearingLocal(o, best);
      const dmg = damageAtDistance(GAME.TURRET.DAMAGE, bestD, GAME.TURRET.RANGE_M);
      this.broadcast({ type: "shot", shooterId: o.id, x: o.x, z: o.z, heading: o.heading, targetId: best.id, targetKind: "player", damage: dmg });
      const owner = o.ownerId ? this.players.get(o.ownerId) ?? null : null;
      this.damagePlayer(best, dmg, owner, "turret");
    }
  }

  private tickMedkits(): void {
    for (const o of this.objects.values()) {
      if (o.kind !== "medkit" || o.hp <= 0) continue;
      for (const p of this.players.values()) {
        if (!p.alive || p.isReferee || p.hp >= GAME.MAX_HP) continue;
        if (distLocal(o, p) <= 3) {
          p.hp = GAME.MAX_HP;
          o.hp = 0;
          this.objects.delete(o.id);
          this.broadcast({ type: "event", kind: "object_destroyed", data: { id: o.id, kind: "medkit", by: p.id } });
          break;
        }
      }
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

  private damagePlayer(victim: Player, dmg: number, attacker: Player | null, weapon: "rifle" | "turret"): void {
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.client.send({ type: "hit", by: attacker?.id ?? "turret", damage: dmg, hp: victim.hp });
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
    this.broadcast({ type: "kill", killerId: attacker?.id ?? "turret", victimId: victim.id, weapon });
    this.events.onKill?.(this, attacker?.id ?? "turret", victim.id, weapon);
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
  };
}
