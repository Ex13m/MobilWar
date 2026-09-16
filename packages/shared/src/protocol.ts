import type { LatLon } from "./geo.js";
import type { AvatarId, Team, WeaponId } from "./constants.js";
import type { Loadout } from "./weapons.js";

export type GameMode = "tdm" | "ctf" | "koth" | "infection" | "turret_defense";
export type PlayMode = "ar" | "screenless" | "referee";
/** Placeable (turret/barrier/drone/medkit), mode objects (flag) and pickups. */
export type ObjectKind = "turret" | "barrier" | "drone" | "medkit" | "flag" | "ammo" | "shield" | "overcharge" | "supply";
export const PICKUP_KINDS = ["medkit", "ammo", "shield", "overcharge", "supply"] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

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
  /** Shield points (absorbed before HP). */
  shield: number;
  /** Rockets left. */
  ammo: number;
  /** Currently selected weapon (for viewmodels on other clients). */
  weapon: WeaponId;
  /** Rounds in the current magazine per weapon and spare rounds. */
  mag: Record<WeaponId, number>;
  /** Throwables left this life. */
  grenades: Record<GrenadeKind, number>;
  reserve: Record<WeaponId, number>;
  /** Epoch ms until a reload finishes (0 = not reloading). */
  reloadUntil: number;
  /** Current bloom (deg) added to the rifle cone. */
  bloom: number;
  /** Sniper zoom on (affects cone). */
  zoomed: boolean;
  /** Equipped catalog weapon per slot. */
  loadout: Loadout;
  /** Epoch ms until which the player cannot fire (stun). */
  stunnedUntil: number;
  /** Epoch ms until which the player burns (3 dmg/s). */
  burnUntil: number;
  /** Epoch ms until which the overcharge buff is active (0 = none). */
  overchargeUntil: number;
  /** Epoch ms until which spawn protection is active. */
  protectedUntil: number;
  /** Epoch ms when respawn becomes possible (0 when alive). */
  respawnAt: number;
}

/** Thrown equipment. Plasma hurts, EMP disables. */
export type GrenadeKind = "plasma" | "emp";

export interface Projectile {
  id: string;
  kind: "rocket" | "grenade";
  ownerId: string;
  team: Team;
  x: number;
  z: number;
  y: number;
  heading: number;
  /** Server time of launch. */
  t0: number;
  /** Grenades only: which type, and when it goes off (server time). */
  grenade?: GrenadeKind;
  fuseAt?: number;
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
  /** Height above ground (drones), metres. */
  y?: number;
  /** Epoch ms when the object expires (pickups, drones). */
  expiresAt?: number;
  /** Epoch ms until which a turret/drone is disabled by EMP. */
  disabledUntil?: number;
}

export interface BaseInfo {
  x: number;
  z: number;
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
  /** Team bases (local coords). Dead players respawn by walking to their base. */
  bases: Record<Team, BaseInfo>;
}

export interface Snapshot {
  t: number;
  room: RoomInfo;
  players: PlayerPublic[];
  objects: WorldObject[];
  projectiles: Projectile[];
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
  /** Chosen catalog weapons per slot (validated server-side). */
  loadout?: Partial<Loadout>;
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
  weapon?: WeaponId;
  /** Sniper: how long the trigger was held (ms) — server clamps against CHARGE_MS and its own timers. */
  chargeMs?: number;
  /** Sniper: zoomed when fired. */
  zoomed?: boolean;
  heading: number;
  /**
   * Pitch in degrees, positive = up. The server gates hits against the
   * target's elevation, so aiming up or down actually misses.
   */
  pitch: number;
  ct: number;
}

export interface SelectWeaponMsg {
  type: "weapon";
  weapon: WeaponId;
}

export interface ReloadMsg {
  type: "reload";
}

/** Equip a catalog weapon into its slot (allowed any time; for testing balance in the field). */
export interface LoadoutMsg {
  type: "loadout";
  slot: WeaponId;
  weaponId: string;
}

export interface ZoomMsg {
  type: "zoom";
  on: boolean;
}

export interface PlaceObjectMsg {
  type: "place";
  kind: "turret" | "barrier" | "drone" | "medkit";
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

export interface ThrowGrenadeMsg {
  type: "grenade";
  kind: GrenadeKind;
  heading: number;
  /**
   * Aim pitch in degrees. The throw distance is read off this: level throws
   * short, tilted up throws long (see GAME.GRENADE).
   */
  pitch: number;
  ct: number;
}

export type ClientMsg =
  | JoinMsg
  | PosMsg
  | ShootMsg
  | ThrowGrenadeMsg
  | SelectWeaponMsg
  | ReloadMsg
  | ZoomMsg
  | LoadoutMsg
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
  weapon: WeaponId | "turret" | "drone";
  /** Catalog id of the weapon (for colour / sound on other clients). */
  weaponId?: string;
  /** Additional pellets/burst hits resolved in the same trigger. */
  extraHits?: Array<{ targetId: string; damage: number }>;
  shooterId: string;
  x: number;
  z: number;
  heading: number;
  /** Elevation of the shot in degrees, positive = up (for the tracer on other clients). */
  pitch?: number;
  /** Target hit, if any. */
  targetId?: string;
  targetKind?: "player" | "object";
  damage?: number;
  /** Shot was stopped by a barrier at this point. */
  blockedBy?: string;
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
  weapon: WeaponId | "turret" | "drone";
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
    | "object_destroyed"
    | "explosion"
    | "grenade"
    | "shrapnel"
    | "lock_on"
    | "lock_lost"
    | "drone_returning"
    | "drone_rearmed"
    | "pickup"
    | "pickup_spawned"
    | "respawn"
    | "reload"
    | "empty"
    | "burn"
    | "stun"
    | "emp"
    | "heal"
    | "overheat";
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
