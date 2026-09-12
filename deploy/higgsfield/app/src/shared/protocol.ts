import type { LatLon } from "./geo";
import type { AvatarId, Team } from "./constants";

export type GameMode = "tdm" | "ctf" | "koth" | "infection" | "turret_defense";
export type PlayMode = "ar" | "screenless" | "referee";
export type ObjectKind = "turret" | "barrier" | "medkit" | "flag";

export interface PlayerPublic {
  id: string;
  nick: string;
  team: Team;
  avatar: AvatarId;
  playMode: PlayMode;
  /** Local ENU coords (m), relative to room origin. */
  x: number;
  z: number;
  /** Compass heading in degrees, 0 = north, clockwise. */
  heading: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  supply: number;
  /** GPS accuracy reported by device (m). */
  acc: number;
  /** Server timestamp of last position update. */
  t: number;
  hasFlag?: boolean;
}

export interface WorldObject {
  id: string;
  kind: ObjectKind;
  team: Team | null;
  ownerId: string | null;
  x: number;
  z: number;
  hp: number;
  /** For turrets: heading the barrel currently points at. */
  heading?: number;
  /** For flags: whether currently carried. */
  carriedBy?: string | null;
}

export interface RoomInfo {
  id: string;
  name: string;
  mode: GameMode;
  origin: LatLon;
  radiusM: number;
  /** Optional polygon geofence (overrides circle if present). */
  polygon?: LatLon[];
  phase: "lobby" | "countdown" | "playing" | "ended";
  /** Epoch ms when the current phase ends (for countdown/playing). */
  phaseEndsAt: number;
  score: Record<Team, number>;
  playerCount: number;
}

export interface Snapshot {
  t: number;
  room: RoomInfo;
  players: PlayerPublic[];
  objects: WorldObject[];
}

/* ---------- Client → Server ---------- */

export interface JoinMsg {
  type: "join";
  roomId: string;
  nick: string;
  avatar: AvatarId;
  playMode: PlayMode;
  deviceId: string;
  /** Preferred team; server may override for balance. */
  team?: Team;
}

export interface PosMsg {
  type: "pos";
  lat: number;
  lon: number;
  acc: number;
  heading: number;
  /** Client monotonic time (ms). */
  ct: number;
}

export interface ShootMsg {
  type: "shoot";
  heading: number;
  /** Pitch in degrees, positive = up. Used only for AR feedback; hits are 2D. */
  pitch: number;
  ct: number;
}

export interface PlaceObjectMsg {
  type: "place";
  kind: ObjectKind;
  /** Optional explicit position; defaults to player's current position + 2 m ahead. */
  lat?: number;
  lon?: number;
}

export interface RefereeCmdMsg {
  type: "ref";
  cmd: "start" | "stop" | "reset" | "kick" | "set_mode" | "set_zone";
  playerId?: string;
  mode?: GameMode;
  origin?: LatLon;
  radiusM?: number;
  polygon?: LatLon[];
}

export interface PingMsg {
  type: "ping";
  ct: number;
}

export interface CreateRoomMsg {
  type: "create_room";
  name: string;
  mode: GameMode;
  origin: LatLon;
  radiusM: number;
}

export interface ListRoomsMsg {
  type: "list_rooms";
  near?: LatLon;
}

export type ClientMsg =
  | JoinMsg
  | PosMsg
  | ShootMsg
  | PlaceObjectMsg
  | RefereeCmdMsg
  | PingMsg
  | CreateRoomMsg
  | ListRoomsMsg;

/* ---------- Server → Client ---------- */

export interface WelcomeMsg {
  type: "welcome";
  playerId: string;
  room: RoomInfo;
  serverTime: number;
}

export interface SnapshotMsg {
  type: "snapshot";
  snap: Snapshot;
}

/** Fired when a shot happens (for visuals/audio on all clients). */
export interface ShotEventMsg {
  type: "shot";
  shooterId: string;
  x: number;
  z: number;
  heading: number;
  /** Target hit, if any. */
  targetId?: string;
  targetKind?: "player" | "object";
  damage?: number;
}

export interface HitMsg {
  type: "hit";
  /** You were hit. */
  by: string;
  damage: number;
  hp: number;
}

export interface KillMsg {
  type: "kill";
  killerId: string;
  victimId: string;
  weapon: "rifle" | "turret";
}

export interface EventMsg {
  type: "event";
  kind:
    | "flag_taken"
    | "flag_captured"
    | "flag_dropped"
    | "zone_captured"
    | "infected"
    | "round_start"
    | "round_end"
    | "object_placed"
    | "object_destroyed";
  data?: Record<string, unknown>;
}

export interface WarnMsg {
  type: "warn";
  code: "out_of_bounds" | "near_border" | "gps_poor" | "speed" | "rate_limit";
  text: string;
}

export interface ErrorMsg {
  type: "error";
  code: string;
  text: string;
}

export interface PongMsg {
  type: "pong";
  ct: number;
  st: number;
}

export interface RoomsMsg {
  type: "rooms";
  rooms: RoomInfo[];
}

export interface RoomCreatedMsg {
  type: "room_created";
  room: RoomInfo;
}

export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | ShotEventMsg
  | HitMsg
  | KillMsg
  | EventMsg
  | WarnMsg
  | ErrorMsg
  | PongMsg
  | RoomsMsg
  | RoomCreatedMsg;

export function isClientMsg(v: unknown): v is ClientMsg {
  return typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
}
