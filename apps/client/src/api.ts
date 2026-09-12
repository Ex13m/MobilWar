import type { GameMode, LatLon, RoomInfo } from "@mobilwar/shared";

/**
 * Backend base URL. Priority:
 *  1. VITE_API_URL (build-time), e.g. https://mobilwar.example.com
 *  2. Vite dev server (port 5173) -> same host, port 8080 (the Node server)
 *  3. same origin (production: Cloudflare Worker / Node behind a reverse proxy)
 */
export function apiBase(): string {
  const env = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
  if (env) return env;
  if (location.port === "5173" || location.port === "4173") return `${location.protocol}//${location.hostname}:8080`;
  return location.origin;
}

export function wsUrlFor(roomId: string): string {
  return `${apiBase().replace(/^http/, "ws")}/ws/${encodeURIComponent(roomId.toUpperCase())}`;
}

export async function listRooms(near?: LatLon | null): Promise<RoomInfo[]> {
  const q = near ? `?lat=${near.lat}&lon=${near.lon}` : "";
  const r = await fetch(`${apiBase()}/api/rooms${q}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`rooms ${r.status}`);
  return (await r.json()) as RoomInfo[];
}

export async function createRoom(body: { name: string; mode: GameMode; origin: LatLon; radiusM: number }): Promise<RoomInfo> {
  const r = await fetch(`${apiBase()}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { error?: string } & Partial<RoomInfo>;
  if (!r.ok) throw new Error(data.error ?? `create ${r.status}`);
  return data as RoomInfo;
}
