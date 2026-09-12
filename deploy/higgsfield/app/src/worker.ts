/**
 * MobilWar on Cloudflare Workers + Durable Objects.
 *
 *   /ws/<CODE>      -> WebSocket to the game room DO named <CODE> (authoritative simulation)
 *   /api/rooms      -> GET list (nearest first) / POST create — served by the registry DO "__lobby"
 *   /health         -> liveness
 *   everything else -> static client (dist/client) served by the platform before this runs
 */
import type { Env } from "./env";
import { Room } from "./room";

export { Room };

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOBBY = "__lobby";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a websocket upgrade", { status: 426 });
      }
      const raw = url.pathname.slice(3).replace(/^\/+/, "").toUpperCase();
      if (!raw || raw === LOBBY || !ROOM_RE.test(raw)) return new Response("invalid room", { status: 400 });
      const id = env.ROOMS.idFromName(raw);
      return env.ROOMS.get(id).fetch(request);
    }

    if (url.pathname === "/api/rooms" || url.pathname === "/api/leaderboard") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(LOBBY));
      const res = await stub.fetch(new Request(`https://lobby${url.pathname}${url.search}`, request));
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, env: env.HF_ENV ?? "?", slug: env.APP_SLUG ?? "?" }, { headers: CORS });
    }

    if (request.method === "GET" && request.headers.get("Accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
