import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  GAME,
  TokenBucket,
  isClientMsg,
  uid,
  AVATARS,
  type ClientMsg,
  type ServerMsg,
} from "@mobilwar/shared";
import { config } from "./config.js";
import { Db } from "./db.js";
import { log } from "./log.js";
import { Room, type Client } from "./room.js";
import { RoomManager } from "./rooms.js";

interface Conn extends Client {
  ws: WebSocket;
  room: Room | null;
  /** Room code taken from the WS path /ws/<code>, if any. */
  pathRoom: string;
  deviceId: string;
  posBucket: TokenBucket;
  shootBucket: TokenBucket;
  msgBucket: TokenBucket;
  alive: boolean;
}

export function createApp(opts: { dbPath?: string } = {}) {
  const db = new Db(opts.dbPath ?? config.dbPath);
  const deviceIdByPlayer = new Map<string, string>();
  const rooms = new RoomManager((room, snap) => {
    try {
      db.saveMatch(snap, deviceIdByPlayer);
      log.info("match saved", room.id, snap.room.score);
    } catch (e) {
      log.error("saveMatch failed", e);
    }
  });

  const http = createServer((req, res) => handleHttp(req, res));
  const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });
  const conns = new Set<Conn>();

  function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, conns: conns.size, uptime: process.uptime() }));
      return;
    }
    if (url.pathname === "/api/rooms" && req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "content-type" });
      res.end();
      return;
    }
    if (url.pathname === "/api/rooms" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const m = JSON.parse(body || "{}") as { name?: string; mode?: string; origin?: { lat: number; lon: number }; radiusM?: number };
          if (!m.origin || !Number.isFinite(m.origin.lat) || !Number.isFinite(m.origin.lon)) throw new Error("bad_origin");
          const room = rooms.create({
            name: String(m.name ?? "Зона").slice(0, 32) || "Зона",
            mode: (m.mode as import("@mobilwar/shared").GameMode) ?? "tdm",
            origin: { lat: m.origin.lat, lon: m.origin.lon },
            radiusM: Number(m.radiusM) || GAME.DEFAULT_ZONE_RADIUS_M,
          });
          log.info("room created (http)", room.id, room.name, room.mode);
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify(room.info()));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
      return;
    }
    if (url.pathname === "/api/rooms") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      const near = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rooms.list(near)));
      return;
    }
    if (url.pathname === "/api/leaderboard") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(db.topDevices(20)));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  }

  wss.on("connection", (ws, req) => {
    const origin = req.headers.origin ?? "";
    if (config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
      ws.close(1008, "origin");
      return;
    }
    const conn: Conn = {
      id: uid("p"),
      ws,
      room: null,
      pathRoom: (new URL(req.url ?? "/", "http://x").pathname.match(/^\/ws\/([A-Za-z0-9_-]{1,64})/)?.[1] ?? "").toUpperCase(),
      deviceId: "",
      posBucket: new TokenBucket(10, GAME.POS_HZ * 1.5),
      shootBucket: new TokenBucket(15, 12),
      msgBucket: new TokenBucket(60, 30),
      alive: true,
      send(msg: ServerMsg) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    conns.add(conn);

    ws.on("pong", () => (conn.alive = true));
    ws.on("message", (data) => {
      if (!conn.msgBucket.take()) {
        conn.send({ type: "warn", code: "rate_limit", text: "Слишком много сообщений" });
        return;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!isClientMsg(msg)) return;
      try {
        handle(conn, msg);
      } catch (e) {
        log.error("handle", (e as Error).message);
        conn.send({ type: "error", code: "internal", text: (e as Error).message });
      }
    });
    ws.on("close", () => {
      conns.delete(conn);
      if (conn.room) {
        conn.room.leave(conn.id);
        deviceIdByPlayer.delete(conn.id);
      }
    });
  });

  function handle(conn: Conn, msg: ClientMsg): void {
    switch (msg.type) {
      case "ping":
        conn.send({ type: "pong", ct: msg.ct, st: Date.now() });
        return;
      case "list_rooms":
        conn.send({ type: "rooms", rooms: rooms.list(msg.near) });
        return;
      case "create_room": {
        if (!msg.origin || !Number.isFinite(msg.origin.lat) || !Number.isFinite(msg.origin.lon)) {
          conn.send({ type: "error", code: "bad_origin", text: "Нужны координаты зоны" });
          return;
        }
        const room = rooms.create({
          name: String(msg.name ?? "Зона").slice(0, 32) || "Зона",
          mode: msg.mode ?? "tdm",
          origin: { lat: msg.origin.lat, lon: msg.origin.lon },
          radiusM: Number(msg.radiusM) || GAME.DEFAULT_ZONE_RADIUS_M,
        });
        log.info("room created", room.id, room.name, room.mode);
        conn.send({ type: "room_created", room: room.info() });
        return;
      }
      case "join": {
        const room = rooms.get(msg.roomId || conn.pathRoom || "");
        if (!room) {
          conn.send({ type: "error", code: "no_room", text: "Комната не найдена" });
          return;
        }
        if (conn.room) {
          conn.room.leave(conn.id);
          deviceIdByPlayer.delete(conn.id);
        }
        conn.deviceId = String(msg.deviceId ?? "").slice(0, 64);
        const isReferee = msg.playMode === "referee";
        try {
          room.join(conn, {
            nick: msg.nick,
            avatar: AVATARS.includes(msg.avatar) ? msg.avatar : "scout",
            playMode: msg.playMode ?? "ar",
            deviceId: conn.deviceId,
            team: msg.team,
            isReferee,
            loadout: msg.loadout,
          });
        } catch (e) {
          conn.send({ type: "error", code: (e as Error).message, text: "Комната заполнена" });
          return;
        }
        conn.room = room;
        deviceIdByPlayer.set(conn.id, conn.deviceId);
        conn.send({ type: "welcome", playerId: conn.id, room: room.info(), serverTime: Date.now() });
        conn.send({ type: "snapshot", snap: room.snapshot() });
        return;
      }
      case "pos": {
        const room = conn.room;
        if (!room) return;
        if (!conn.posBucket.take()) return;
        const p = room.players.get(conn.id);
        if (!p) return;
        room.updatePosition(p, Number(msg.lat), Number(msg.lon), Number(msg.acc), Number(msg.heading));
        return;
      }
      case "shoot": {
        const room = conn.room;
        if (!room) return;
        if (!conn.shootBucket.take()) return;
        const p = room.players.get(conn.id);
        if (!p) return;
        room.shoot(p, Number(msg.heading), msg.weapon, { chargeMs: Number(msg.chargeMs) || 0, zoomed: !!msg.zoomed });
        return;
      }
      case "reload": {
        const p = conn.room?.players.get(conn.id);
        if (p && conn.room) conn.room.reload(p);
        return;
      }
      case "zoom": {
        const p = conn.room?.players.get(conn.id);
        if (p && conn.room) conn.room.setZoom(p, !!msg.on);
        return;
      }
      case "loadout": {
        const p = conn.room?.players.get(conn.id);
        if (p && conn.room) {
          if (!conn.room.equip(p, msg.slot, String(msg.weaponId))) conn.send({ type: "error", code: "bad_weapon", text: "Нет такого оружия" });
          else conn.send({ type: "snapshot", snap: conn.room.snapshot() });
        }
        return;
      }
      case "weapon": {
        const p = conn.room?.players.get(conn.id);
        if (p && conn.room) conn.room.selectWeapon(p, msg.weapon);
        return;
      }
      case "place": {
        const room = conn.room;
        if (!room) return;
        const p = room.players.get(conn.id);
        if (!p) return;
        const at = Number.isFinite(msg.lat) && Number.isFinite(msg.lon) ? { lat: msg.lat!, lon: msg.lon! } : undefined;
        const obj = room.placeObject(p, msg.kind, at);
        if (!obj) conn.send({ type: "error", code: "cant_place", text: "Нельзя поставить здесь (нет ресурсов / лимит / далеко)" });
        return;
      }
      case "ref": {
        const room = conn.room;
        if (!room) return;
        const p = room.players.get(conn.id);
        if (!p || !p.isReferee) {
          conn.send({ type: "error", code: "forbidden", text: "Только судья" });
          return;
        }
        switch (msg.cmd) {
          case "start":
            room.start();
            break;
          case "stop":
            room.stop();
            break;
          case "reset":
            room.reset();
            break;
          case "set_mode":
            if (msg.mode) {
              room.mode = msg.mode;
              room.reset();
            }
            break;
          case "set_zone":
            room.setZone(msg.origin, msg.radiusM, msg.polygon);
            break;
          case "kick": {
            const victim = msg.playerId ? room.players.get(msg.playerId) : undefined;
            if (victim) {
              victim.client.send({ type: "error", code: "kicked", text: "Судья исключил тебя из игры" });
              const vc = [...conns].find((c) => c.id === victim.id);
              vc?.ws.close(1000, "kicked");
            }
            break;
          }
        }
        room.broadcast({ type: "snapshot", snap: room.snapshot() });
        return;
      }
    }
  }

  // Simulation + snapshot loop.
  const tickTimer = setInterval(() => {
    rooms.tickAll();
    for (const r of rooms.rooms.values()) {
      if (r.players.size === 0) continue;
      r.broadcast({ type: "snapshot", snap: r.snapshot() });
    }
  }, 1000 / GAME.TICK_HZ);

  const gcTimer = setInterval(() => rooms.gc(config.emptyRoomTtlMs), 60_000);

  const pingTimer = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 15_000);

  function close(): void {
    clearInterval(tickTimer);
    clearInterval(gcTimer);
    clearInterval(pingTimer);
    wss.close();
    http.close();
    db.close();
  }

  return { http, wss, rooms, db, close };
}
