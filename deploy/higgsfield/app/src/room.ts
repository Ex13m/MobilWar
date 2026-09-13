/**
 * Durable Object `Room`. Two personalities, chosen by the DO name:
 *
 *  - "__lobby": the zone registry. Plain HTTP: GET /api/rooms (nearest first),
 *    POST /api/rooms (create → 4-letter code), GET /room/<id> (config for a room DO),
 *    POST /update (a room pushes its live info), GET /api/leaderboard (stub).
 *
 *  - any other name: one game zone. Owns the WebSockets and runs the authoritative
 *    simulation (`game/room.ts`, the same class as the Node server) at 10 Hz driven
 *    by DO alarms. Game state lives in memory while the room is active; if the object
 *    is evicted (long idle) clients are asked to re-join.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { Room as GameRoom, type Client } from "./game/room";
import {
  AVATARS,
  GAME,
  TokenBucket,
  haversine,
  isClientMsg,
  shortCode,
  type ClientMsg,
  type GameMode,
  type LatLon,
  type RoomInfo,
  type ServerMsg,
} from "./shared/index";

const LOBBY = "__lobby";
const TICK_MS = Math.round(1000 / GAME.TICK_HZ);
const REGISTRY_PUSH_MS = 3000;
const STALE_MS = 90_000;

interface RoomConfig {
  id: string;
  name: string;
  mode: GameMode;
  origin: LatLon;
  radiusM: number;
  createdAt: number;
}

interface Conn extends Client {
  ws: WebSocket;
  deviceId: string;
  posBucket: TokenBucket;
  shootBucket: TokenBucket;
  msgBucket: TokenBucket;
}

type RegistryEntry = RoomInfo & { updatedAt: number };

export class Room extends DurableObject<Env> {
  // ---- game personality (in-memory; see file header) ----
  private game: GameRoom | null = null;
  private conns = new Map<string, Conn>();
  private lastRegistryPush = 0;
  private config: RoomConfig | null = null;

  private get isLobby(): boolean {
    return this.ctx.id.name === LOBBY;
  }

  override async fetch(request: Request): Promise<Response> {
    if (this.isLobby) return this.lobbyFetch(request);
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const game = await this.ensureGame();
    if (!game) return new Response("room not found", { status: 404 });

    const pair = new WebSocketPair();
    const server = pair[1]!;
    this.ctx.acceptWebSocket(server);
    const connId = "p_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    server.serializeAttachment({ connId });
    this.conns.set(connId, this.makeConn(connId, server));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private makeConn(connId: string, ws: WebSocket): Conn {
    return {
      id: connId,
      ws,
      deviceId: "",
      posBucket: new TokenBucket(10, GAME.POS_HZ * 1.5),
      shootBucket: new TokenBucket(5, 1000 / GAME.RIFLE_COOLDOWN_MS),
      msgBucket: new TokenBucket(60, 30),
      send(msg: ServerMsg) {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          /* closed */
        }
      },
    };
  }

  /** Load config (from storage or the registry) and build the simulation once. */
  private async ensureGame(): Promise<GameRoom | null> {
    if (this.game) return this.game;
    let cfg = this.config ?? (await this.ctx.storage.get<RoomConfig>("config")) ?? null;
    if (!cfg) {
      const name = this.ctx.id.name ?? "";
      const res = await this.env.ROOMS.get(this.env.ROOMS.idFromName(LOBBY)).fetch(`https://lobby/room/${name}`);
      if (!res.ok) return null;
      cfg = (await res.json()) as RoomConfig;
      await this.ctx.storage.put("config", cfg);
    }
    this.config = cfg;
    this.game = new GameRoom({ id: cfg.id, name: cfg.name, mode: cfg.mode, origin: cfg.origin, radiusM: cfg.radiusM });
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    return this.game;
  }

  private connOf(ws: WebSocket): Conn | null {
    const att = ws.deserializeAttachment() as { connId?: string } | null;
    if (!att?.connId) return null;
    const c = this.conns.get(att.connId);
    if (c) return c;
    // Object was evicted and revived: memory is gone, socket is not. Ask the client to re-join.
    const fresh = this.makeConn(att.connId, ws);
    this.conns.set(att.connId, fresh);
    fresh.send({ type: "error", code: "rejoin", text: "Переподключение" });
    return fresh;
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (this.isLobby) return;
    const conn = this.connOf(ws);
    if (!conn) return;
    if (typeof raw !== "string" || raw.length > 16 * 1024) return;
    if (!conn.msgBucket.take()) {
      conn.send({ type: "warn", code: "rate_limit", text: "Слишком много сообщений" });
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isClientMsg(msg)) return;
    const game = await this.ensureGame();
    if (!game) {
      conn.send({ type: "error", code: "no_room", text: "Комната не найдена" });
      return;
    }
    try {
      this.handle(game, conn, msg);
    } catch (e) {
      console.error("handle failed", e instanceof Error ? e.stack : String(e));
      conn.send({ type: "error", code: "internal", text: "Ошибка сервера" });
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    if (this.isLobby) return;
    const att = ws.deserializeAttachment() as { connId?: string } | null;
    if (!att?.connId) return;
    this.conns.delete(att.connId);
    this.game?.leave(att.connId);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private handle(game: GameRoom, conn: Conn, msg: ClientMsg): void {
    switch (msg.type) {
      case "ping":
        conn.send({ type: "pong", ct: msg.ct, st: Date.now() });
        return;
      case "join": {
        if (game.players.has(conn.id)) game.leave(conn.id);
        conn.deviceId = String(msg.deviceId ?? "").slice(0, 64);
        const isReferee = msg.playMode === "referee";
        try {
          game.join(conn, {
            nick: msg.nick,
            avatar: AVATARS.includes(msg.avatar) ? msg.avatar : "scout",
            playMode: msg.playMode ?? "ar",
            deviceId: conn.deviceId,
            team: msg.team,
            isReferee,
          });
        } catch (e) {
          conn.send({ type: "error", code: (e as Error).message, text: "Комната заполнена" });
          return;
        }
        conn.send({ type: "welcome", playerId: conn.id, room: game.info(), serverTime: Date.now() });
        conn.send({ type: "snapshot", snap: game.snapshot() });
        void this.pushRegistry(game, true);
        return;
      }
      case "pos": {
        if (!conn.posBucket.take()) return;
        const p = game.players.get(conn.id);
        if (p) game.updatePosition(p, Number(msg.lat), Number(msg.lon), Number(msg.acc), Number(msg.heading));
        return;
      }
      case "shoot": {
        if (!conn.shootBucket.take()) return;
        const p = game.players.get(conn.id);
        if (p) game.shoot(p, Number(msg.heading), msg.weapon);
        return;
      }
      case "weapon": {
        const p = game.players.get(conn.id);
        if (p) game.selectWeapon(p, msg.weapon);
        return;
      }
      case "place": {
        const p = game.players.get(conn.id);
        if (!p) return;
        const at = Number.isFinite(msg.lat) && Number.isFinite(msg.lon) ? { lat: msg.lat!, lon: msg.lon! } : undefined;
        if (!game.placeObject(p, msg.kind, at)) {
          conn.send({ type: "error", code: "cant_place", text: "Нельзя поставить здесь (нет ресурсов / лимит / далеко)" });
        }
        return;
      }
      case "ref": {
        const p = game.players.get(conn.id);
        if (!p || !p.isReferee) {
          conn.send({ type: "error", code: "forbidden", text: "Только судья" });
          return;
        }
        switch (msg.cmd) {
          case "start":
            game.start();
            break;
          case "stop":
            game.stop();
            break;
          case "reset":
            game.reset();
            break;
          case "set_mode":
            if (msg.mode) {
              game.mode = msg.mode;
              game.reset();
            }
            break;
          case "set_zone":
            game.setZone(msg.origin, msg.radiusM, msg.polygon);
            break;
          case "kick": {
            const victim = msg.playerId ? game.players.get(msg.playerId) : undefined;
            if (victim) {
              victim.client.send({ type: "error", code: "kicked", text: "Судья исключил тебя из игры" });
              this.conns.get(victim.id)?.ws.close(1000, "kicked");
              game.leave(victim.id);
            }
            break;
          }
        }
        game.broadcast({ type: "snapshot", snap: game.snapshot() });
        void this.pushRegistry(game, true);
        return;
      }
      case "list_rooms":
      case "create_room":
        conn.send({ type: "error", code: "use_http", text: "Используй /api/rooms" });
        return;
    }
  }

  /** 10 Hz simulation tick, driven by DO alarms while anyone is connected. */
  override async alarm(): Promise<void> {
    if (this.isLobby) return;
    const game = await this.ensureGame();
    if (!game) return;
    // Sockets that survived an eviction are not in `conns` yet; count the real ones.
    const live = this.ctx.getWebSockets().length;
    if (live === 0 && game.players.size === 0) {
      await this.pushRegistry(game, true);
      return; // stop ticking; next connection re-arms the alarm
    }
    try {
      game.tick();
      game.broadcast({ type: "snapshot", snap: game.snapshot() });
    } catch (e) {
      console.error("tick failed", e instanceof Error ? e.stack : String(e));
    }
    await this.pushRegistry(game, false);
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  private async pushRegistry(game: GameRoom, force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastRegistryPush < REGISTRY_PUSH_MS) return;
    this.lastRegistryPush = now;
    try {
      await this.env.ROOMS.get(this.env.ROOMS.idFromName(LOBBY)).fetch("https://lobby/update", {
        method: "POST",
        body: JSON.stringify(game.info()),
      });
    } catch (e) {
      console.warn("registry push failed", String(e));
    }
  }

  // ---------------- registry personality ----------------

  private async lobbyFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const rooms = (await this.ctx.storage.get<Record<string, RegistryEntry>>("rooms")) ?? {};
    const now = Date.now();
    let dirty = false;
    for (const [id, r] of Object.entries(rooms)) {
      if (now - r.updatedAt > STALE_MS && r.playerCount === 0) {
        delete rooms[id];
        dirty = true;
      }
    }

    if (url.pathname === "/api/rooms" && request.method === "GET") {
      if (dirty) await this.ctx.storage.put("rooms", rooms);
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      const arr = Object.values(rooms);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const near = { lat, lon };
        arr.sort((a, b) => haversine(near, a.origin) - haversine(near, b.origin));
      } else arr.sort((a, b) => b.updatedAt - a.updatedAt);
      return Response.json(arr.slice(0, 50).map(({ updatedAt: _u, ...info }) => info));
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      let m: { name?: string; mode?: GameMode; origin?: LatLon; radiusM?: number };
      try {
        m = (await request.json()) as typeof m;
      } catch {
        return Response.json({ error: "bad_json" }, { status: 400 });
      }
      if (!m.origin || !Number.isFinite(m.origin.lat) || !Number.isFinite(m.origin.lon)) {
        return Response.json({ error: "bad_origin" }, { status: 400 });
      }
      let id = shortCode(4);
      while (rooms[id]) id = shortCode(4);
      const cfg: RoomConfig = {
        id,
        name: String(m.name ?? "Зона").slice(0, 32) || "Зона",
        mode: m.mode ?? "tdm",
        origin: { lat: m.origin.lat, lon: m.origin.lon },
        radiusM: Math.min(1000, Math.max(20, Number(m.radiusM) || GAME.DEFAULT_ZONE_RADIUS_M)),
        createdAt: now,
      };
      const info: RegistryEntry = {
        id,
        name: cfg.name,
        mode: cfg.mode,
        origin: cfg.origin,
        radiusM: cfg.radiusM,
        phase: "lobby",
        phaseEndsAt: 0,
        score: { red: 0, blue: 0 },
        playerCount: 0,
        updatedAt: now,
      };
      rooms[id] = info;
      await this.ctx.storage.put({ rooms, [`cfg:${id}`]: cfg });
      const { updatedAt: _u, ...pub } = info;
      return Response.json(pub, { status: 201 });
    }

    if (url.pathname.startsWith("/room/")) {
      const id = url.pathname.slice(6).toUpperCase();
      const cfg = await this.ctx.storage.get<RoomConfig>(`cfg:${id}`);
      return cfg ? Response.json(cfg) : Response.json({ error: "no_room" }, { status: 404 });
    }

    if (url.pathname === "/update" && request.method === "POST") {
      const info = (await request.json()) as RoomInfo;
      if (info?.id && (rooms[info.id] || (await this.ctx.storage.get(`cfg:${info.id}`)))) {
        rooms[info.id] = { ...info, updatedAt: now };
        await this.ctx.storage.put("rooms", rooms);
      }
      return new Response("ok");
    }

    if (url.pathname === "/api/leaderboard") return Response.json([]);
    return new Response("not found", { status: 404 });
  }
}
