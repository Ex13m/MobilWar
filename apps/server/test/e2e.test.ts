import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { GAME, destination, type ClientMsg, type ServerMsg } from "@mobilwar/shared";
import { createApp } from "../src/server.js";

let app: ReturnType<typeof createApp>;
let port = 0;

class C {
  ws: WebSocket;
  inbox: ServerMsg[] = [];
  constructor(path = "") {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    this.ws.on("message", (d) => this.inbox.push(JSON.parse(String(d))));
  }
  open() {
    return new Promise<void>((r) => this.ws.once("open", () => r()));
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  async wait<T extends ServerMsg["type"]>(type: T, timeout = 3000): Promise<Extract<ServerMsg, { type: T }>> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const i = this.inbox.findIndex((m) => m.type === type);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { type: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout waiting ${type}`);
  }
}

const origin = { lat: 55.75, lon: 37.61 };

beforeAll(async () => {
  app = createApp({ dbPath: ":memory:" });
  await new Promise<void>((r) => app.http.listen(0, () => r()));
  port = (app.http.address() as { port: number }).port;
});
afterAll(() => app.close());

describe("e2e over WebSocket", () => {
  it("create room, two players join, referee starts, shot kills, match persisted", { timeout: 15000 }, async () => {
    const ref = new C();
    await ref.open();
    ref.send({ type: "create_room", name: "Двор", mode: "tdm", origin, radiusM: 120 });
    const created = await ref.wait("room_created");
    const roomId = created.room.id;
    expect(roomId).toHaveLength(4);
    ref.send({ type: "join", roomId, nick: "Судья", avatar: "robot", playMode: "referee", deviceId: "ref" });
    await ref.wait("welcome");

    const a = new C();
    const b = new C();
    await Promise.all([a.open(), b.open()]);
    a.send({ type: "join", roomId, nick: "A", avatar: "scout", playMode: "ar", deviceId: "da", team: "red" });
    b.send({ type: "join", roomId, nick: "B", avatar: "heavy", playMode: "screenless", deviceId: "db", team: "blue" });
    const wa = await a.wait("welcome");
    await b.wait("welcome");
    expect(wa.room.id).toBe(roomId);

    // health endpoint
    const h = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
    expect(h.ok).toBe(true);
    expect(h.rooms).toBe(1);

    const room = app.rooms.get(roomId)!;
    ref.send({ type: "ref", cmd: "start" });
    await new Promise((r) => setTimeout(r, 100));
    expect(room.phase).toBe("countdown");
    // fast-forward countdown
    room.phaseEndsAt = Date.now() - 1;
    await new Promise((r) => setTimeout(r, 150));
    expect(room.phase).toBe("playing");

    a.send({ type: "pos", lat: origin.lat, lon: origin.lon, acc: 5, heading: 0, ct: 0 });
    const north = destination(origin, 0, 15);
    b.send({ type: "pos", lat: north.lat, lon: north.lon, acc: 5, heading: 180, ct: 0 });
    await new Promise((r) => setTimeout(r, 100));

    for (let i = 0; i < 12; i++) {
      a.send({ type: "shoot", heading: 0, pitch: 0, ct: 0 });
      await new Promise((r) => setTimeout(r, GAME.WEAPONS.blaster.COOLDOWN_MS + 40));
    }
    const kill = await b.wait("kill");
    expect(kill.victimId).toBe(room.players.get([...room.players.keys()].find((k) => room.players.get(k)!.nick === "B")!)!.id);
    expect(room.score.red).toBe(1);
    a.inbox.length = 0;
    const snap = await a.wait("snapshot");
    expect(snap.snap.room.score.red).toBe(1);

    ref.send({ type: "ref", cmd: "stop" });
    await new Promise((r) => setTimeout(r, 100));
    expect(room.phase).toBe("ended");
    const top = app.db.topDevices(5);
    expect(top.find((d) => d.nick === "A")?.kills).toBe(1);
    for (const c of [a, b, ref]) c.ws.close();
  });

  it("HTTP create + join via /ws/<code> path", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP", mode: "koth", origin, radiusM: 80 }),
    });
    expect(r.status).toBe(201);
    const info = (await r.json()) as { id: string; mode: string };
    expect(info.mode).toBe("koth");
    const c = new C(`/ws/${info.id.toLowerCase()}`);
    await c.open();
    c.send({ type: "join", roomId: "", nick: "P", avatar: "ninja", playMode: "ar", deviceId: "dp" });
    const w = await c.wait("welcome");
    expect(w.room.id).toBe(info.id);
    const list = (await fetch(`http://127.0.0.1:${port}/api/rooms?lat=${origin.lat}&lon=${origin.lon}`).then((x) => x.json())) as Array<{ id: string }>;
    expect(list.some((x) => x.id === info.id)).toBe(true);
    c.ws.close();
  });
});
