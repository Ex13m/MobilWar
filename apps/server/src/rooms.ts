import { haversine, shortCode, type GameMode, type LatLon, type RoomInfo, type Snapshot } from "@mobilwar/shared";
import { Room } from "./room.js";

/** In-memory registry of rooms (geo-zones). */
export class RoomManager {
  rooms = new Map<string, Room>();
  constructor(
    private onRoundEnd: (room: Room, snap: Snapshot) => void,
    private now: () => number = Date.now,
  ) {}

  create(opts: { name: string; mode: GameMode; origin: LatLon; radiusM: number; doom?: boolean }): Room {
    let id = shortCode(4);
    while (this.rooms.has(id)) id = shortCode(4);
    const room = new Room({ id, ...opts }, { onRoundEnd: this.onRoundEnd }, this.now);
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id.toUpperCase());
  }

  /** Rooms sorted by distance from `near` (or by creation). */
  list(near?: LatLon): RoomInfo[] {
    const arr = [...this.rooms.values()];
    if (near) arr.sort((a, b) => haversine(near, a.origin) - haversine(near, b.origin));
    else arr.sort((a, b) => b.createdAt - a.createdAt);
    return arr.slice(0, 50).map((r) => r.info());
  }

  tickAll(): void {
    for (const r of this.rooms.values()) r.tick();
  }

  /** Remove rooms with no players for `ttlMs`. */
  gc(ttlMs: number): void {
    const t = this.now();
    for (const [id, r] of this.rooms) {
      if (r.players.size === 0 && t - r.lastActiveAt > ttlMs) this.rooms.delete(id);
    }
  }
}
