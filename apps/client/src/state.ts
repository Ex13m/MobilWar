import {
  GAME,
  PositionFilter,
  toLocal,
  type LatLon,
  type PlayerPublic,
  type RoomInfo,
  type Snapshot,
  type WorldObject,
} from "@mobilwar/shared";

interface Sample {
  t: number;
  x: number;
  z: number;
  heading: number;
}

export interface RemotePlayer extends PlayerPublic {
  /** Interpolated render position. */
  rx: number;
  rz: number;
  rheading: number;
  buf: Sample[];
}

/**
 * Client-side world model: keeps the last snapshot, interpolates remote
 * players between snapshots (INTERP_DELAY_MS behind server time) and keeps
 * a locally filtered position for "me".
 */
export class WorldState {
  myId = "";
  room: RoomInfo | null = null;
  players = new Map<string, RemotePlayer>();
  objects = new Map<string, WorldObject>();
  lastSnapT = 0;
  /** My filtered local position. */
  me = { x: 0, z: 0, acc: 999, heading: 0, hp: GAME.MAX_HP as number, alive: true };
  private posF = new PositionFilter();

  get origin(): LatLon | null {
    return this.room?.origin ?? null;
  }

  applySnapshot(s: Snapshot): void {
    this.room = s.room;
    this.lastSnapT = s.t;
    const seen = new Set<string>();
    for (const p of s.players) {
      seen.add(p.id);
      let rp = this.players.get(p.id);
      if (!rp) {
        rp = { ...p, rx: p.x, rz: p.z, rheading: p.heading, buf: [] };
        this.players.set(p.id, rp);
      }
      Object.assign(rp, p);
      rp.buf.push({ t: s.t, x: p.x, z: p.z, heading: p.heading });
      if (rp.buf.length > 20) rp.buf.shift();
      if (p.id === this.myId) {
        this.me.hp = p.hp;
        this.me.alive = p.alive;
      }
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
    this.objects.clear();
    for (const o of s.objects) this.objects.set(o.id, o);
  }

  /** Feed my own GPS fix; returns local coords. */
  pushMyFix(lat: number, lon: number, acc: number, t: number): { x: number; z: number } | null {
    if (!this.room) return null;
    const v = toLocal(this.room.origin, { lat, lon });
    const f = this.posF.push(v.x, v.z, acc, t);
    this.me.x = f.x;
    this.me.z = f.z;
    this.me.acc = acc;
    return f;
  }

  /** Advance interpolation to render time. */
  interpolate(serverNow: number): void {
    const rt = serverNow - GAME.INTERP_DELAY_MS;
    for (const p of this.players.values()) {
      const b = p.buf;
      if (b.length === 0) continue;
      if (b.length === 1 || rt <= b[0]!.t) {
        const s = b[0]!;
        p.rx = s.x;
        p.rz = s.z;
        p.rheading = s.heading;
        continue;
      }
      let i = b.length - 1;
      while (i > 0 && b[i - 1]!.t > rt) i--;
      const a = b[i - 1] ?? b[0]!;
      const c = b[i]!;
      const span = Math.max(1, c.t - a.t);
      const k = Math.min(1, Math.max(0, (rt - a.t) / span));
      p.rx = a.x + (c.x - a.x) * k;
      p.rz = a.z + (c.z - a.z) * k;
      // shortest-arc heading lerp
      let dh = ((c.heading - a.heading + 540) % 360) - 180;
      p.rheading = (a.heading + dh * k + 360) % 360;
      // drop old samples
      while (b.length > 2 && b[1]!.t < rt - 1000) b.shift();
    }
  }

  myPlayer(): RemotePlayer | undefined {
    return this.players.get(this.myId);
  }

  enemies(): RemotePlayer[] {
    const me = this.myPlayer();
    if (!me) return [];
    return [...this.players.values()].filter((p) => p.id !== me.id && p.team !== me.team && p.alive);
  }
}
