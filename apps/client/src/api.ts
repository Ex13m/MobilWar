import type { GameMode, LatLon, RoomBrief, RoomInfo } from "@mobilwar/shared";

/** Where the game lives when the page is served from somewhere else. */
const CANONICAL = "https://mobilwar.higgsfield.app";

/**
 * Backend base URL. Priority:
 *  1. VITE_API_URL (build-time), e.g. https://mobilwar.example.com
 *  2. Vite dev server (port 5173/4173) -> same host, port 8080 (the Node server)
 *  3. same origin (production: Cloudflare Worker / Node behind a reverse proxy)
 */
function guessBase(): string {
  const env = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
  if (env) return env;
  if (location.port === "5173" || location.port === "4173") return `${location.protocol}//${location.hostname}:8080`;
  return location.origin;
}

let resolved: string | null = null;

export function apiBase(): string {
  return resolved ?? guessBase();
}

/**
 * Pick a backend that actually answers, once, before the lobby opens.
 *
 * The page can be served from somewhere that is not the game's own origin — an
 * embed, a preview shell, a copy behind another host — and then every request
 * goes to a server that knows nothing about rooms and answers 404. Probing
 * /health and falling back to the canonical address turns that from a dead
 * lobby into a working one.
 */
export async function initApiBase(): Promise<string> {
  const seen = new Set<string>();
  const candidates = [guessBase(), CANONICAL].filter((c) => !seen.has(c) && seen.add(c));
  for (const c of candidates) {
    try {
      const r = await fetch(`${c}/health`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (r.ok && ((await r.json()) as { ok?: boolean }).ok) {
        resolved = c;
        return c;
      }
    } catch {
      /* try the next one */
    }
  }
  resolved = candidates[0]!;
  return resolved;
}

/** Host shown in the lobby, so a screenshot says where the app is talking. */
export function apiHost(): string {
  try {
    return new URL(apiBase()).host;
  } catch {
    return apiBase();
  }
}

export function wsUrlFor(roomId: string): string {
  return `${apiBase().replace(/^http/, "ws")}/ws/${encodeURIComponent(roomId.toUpperCase())}`;
}

export async function listRooms(near?: LatLon | null): Promise<RoomBrief[]> {
  const q = near ? `?lat=${near.lat}&lon=${near.lon}` : "";
  const url = `${apiBase()}/api/rooms${q}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} @ ${apiHost()}`);
  return (await r.json()) as RoomBrief[];
}

export async function createRoom(body: { name: string; mode: GameMode; origin: LatLon; radiusM: number; listed?: boolean }): Promise<RoomInfo> {
  const r = await fetch(`${apiBase()}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { error?: string } & Partial<RoomInfo>;
  // The host is part of the message on purpose: a 404 almost always means the
  // page is talking to the wrong server, and the screenshot should say which.
  if (!r.ok) throw new Error(`${data.error ?? r.status} @ ${apiHost()}`);
  return data as RoomInfo;
}
