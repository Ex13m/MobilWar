import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Snapshot } from "@mobilwar/shared";

/**
 * Minimal persistence for MVP: match results + per-device stats.
 * SQLite (single file) — swap for Postgres when going multi-process.
 */
export class Db {
  private db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        room_name TEXT NOT NULL,
        mode TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        score_red INTEGER NOT NULL,
        score_blue INTEGER NOT NULL,
        ended_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS match_players (
        match_id INTEGER NOT NULL REFERENCES matches(id),
        device_id TEXT NOT NULL,
        nick TEXT NOT NULL,
        team TEXT NOT NULL,
        kills INTEGER NOT NULL,
        deaths INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        nick TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        matches INTEGER NOT NULL DEFAULT 0,
        kills INTEGER NOT NULL DEFAULT 0,
        deaths INTEGER NOT NULL DEFAULT 0,
        last_seen INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_matches_geo ON matches(lat, lon);
    `);
  }

  saveMatch(snap: Snapshot, deviceIds: Map<string, string>): number {
    const tx = this.db.transaction(() => {
      const r = this.db
        .prepare(
          `INSERT INTO matches(room_id, room_name, mode, lat, lon, score_red, score_blue, ended_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          snap.room.id,
          snap.room.name,
          snap.room.mode,
          snap.room.origin.lat,
          snap.room.origin.lon,
          snap.room.score.red,
          snap.room.score.blue,
          snap.t,
        );
      const matchId = Number(r.lastInsertRowid);
      const insP = this.db.prepare(
        `INSERT INTO match_players(match_id, device_id, nick, team, kills, deaths) VALUES (?,?,?,?,?,?)`,
      );
      const upDev = this.db.prepare(
        `INSERT INTO devices(device_id, nick, xp, matches, kills, deaths, last_seen)
         VALUES (@id, @nick, @xp, 1, @kills, @deaths, @t)
         ON CONFLICT(device_id) DO UPDATE SET
           nick = excluded.nick,
           xp = xp + excluded.xp,
           matches = matches + 1,
           kills = kills + excluded.kills,
           deaths = deaths + excluded.deaths,
           last_seen = excluded.last_seen`,
      );
      for (const p of snap.players) {
        const dev = deviceIds.get(p.id) ?? "anon";
        insP.run(matchId, dev, p.nick, p.team, p.kills, p.deaths);
        const won = snap.room.score[p.team] > snap.room.score[p.team === "red" ? "blue" : "red"];
        const xp = 10 + p.kills * 5 + (won ? 20 : 0);
        upDev.run({ id: dev, nick: p.nick, xp, kills: p.kills, deaths: p.deaths, t: snap.t });
      }
      return matchId;
    });
    return tx();
  }

  getDevice(deviceId: string): { nick: string; xp: number; matches: number; kills: number; deaths: number } | undefined {
    return this.db.prepare(`SELECT nick, xp, matches, kills, deaths FROM devices WHERE device_id = ?`).get(deviceId) as
      | { nick: string; xp: number; matches: number; kills: number; deaths: number }
      | undefined;
  }

  topDevices(limit = 20): Array<{ nick: string; xp: number; kills: number }> {
    return this.db.prepare(`SELECT nick, xp, kills FROM devices ORDER BY xp DESC LIMIT ?`).all(limit) as Array<{
      nick: string;
      xp: number;
      kills: number;
    }>;
  }

  close(): void {
    this.db.close();
  }
}
