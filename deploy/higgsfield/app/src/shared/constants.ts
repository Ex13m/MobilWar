/** Tunable game constants. Single source of truth for client + server. */
export const GAME = {
  TICK_HZ: 10,
  /** Position upload rate from client (Hz). */
  POS_HZ: 4,
  /** Max HP per player. */
  MAX_HP: 100,
  /** Shield capacity granted by a shield pickup (absorbs damage before HP). */
  SHIELD_MAX: 50,
  /** Weapons. Damage is in HP points: blaster = 10 % of HP, rocket = up to 50 %. */
  WEAPONS: {
    blaster: { DAMAGE: 10, RANGE_M: 60, COOLDOWN_MS: 250, SPEED_MPS: 70 },
    rocket: {
      DAMAGE: 50,
      /** Damage at the splash edge. */
      DAMAGE_EDGE: 15,
      SPLASH_M: 6,
      RANGE_M: 45,
      COOLDOWN_MS: 2500,
      SPEED_MPS: 22,
      /** Rockets per life. */
      AMMO: 2,
      /** Proximity fuse: explode when this close to an enemy/object (m). */
      FUSE_M: 3,
    },
  },
  /** Legacy aliases (blaster). */
  RIFLE_DAMAGE: 10,
  RIFLE_RANGE_M: 60,
  RIFLE_COOLDOWN_MS: 250,
  /** Hit cone half-angle (deg) at 0 m; grows with GPS error. */
  CONE_HALF_ANGLE_DEG: 10,
  /** Extra hit radius (m) added to account for combined GPS error. */
  HIT_RADIUS_BASE_M: 3,
  /** Minimum time dead before respawn is possible, ms. */
  RESPAWN_MS: 8000,
  /** After this extra time a dead player respawns even without reaching the base, ms. */
  RESPAWN_AUTO_MS: 22000,
  /** Distance to own base that triggers respawn (m). */
  BASE_RADIUS_M: 8,
  /** Invulnerability right after respawn, ms. */
  SPAWN_PROTECT_MS: 3000,
  /** Overcharge buff: blaster damage multiplier and duration. */
  OVERCHARGE_MULT: 2,
  OVERCHARGE_MS: 20000,
  /** Barriers block shots passing within this distance of their centre (m). */
  BARRIER_BLOCK_M: 1.6,
  BARRIER_HP: 150,
  /** Pickups: spawn interval, max alive, pickup radius. */
  PICKUP_INTERVAL_MS: 20000,
  PICKUP_MAX: 4,
  PICKUP_RADIUS_M: 3,
  PICKUP_TTL_MS: 90000,
  /** Drone: placed object that orbits and harasses enemies. */
  DRONE: {
    RANGE_M: 18,
    DAMAGE: 5,
    COOLDOWN_MS: 800,
    HP: 60,
    ORBIT_M: 8,
    ALT_M: 3,
    SPEED_MPS: 4,
    TTL_MS: 120000,
    COST: 2,
    MAX_PER_TEAM: 2,
  },
  /** Round length, ms. */
  ROUND_MS: 8 * 60 * 1000,
  /** Human max plausible speed (m/s) for anti-cheat. Usain Bolt ~12.4 */
  MAX_SPEED_MPS: 9,
  /** Position samples with accuracy worse than this are ignored (m). */
  MAX_ACCURACY_M: 40,
  /** Distance to warn player they are near the geofence border (m). */
  GEOFENCE_WARN_M: 8,
  /** Screenless mode radar: ping interval range (ms) near..far. */
  RADAR_PING_MIN_MS: 150,
  RADAR_PING_MAX_MS: 1500,
  /** Turret defaults. */
  TURRET: {
    RANGE_M: 30,
    DAMAGE: 8,
    COOLDOWN_MS: 1200,
    HP: 200,
    /** Cost in "supply" points to place one. */
    COST: 3,
    /** Max turrets per team. */
    MAX_PER_TEAM: 3,
  },
  /** Supply points a player gets per round to place objects. */
  SUPPLY_PER_PLAYER: 6,
  MAX_PLAYERS_PER_ROOM: 16,
  /** Default room geofence radius (m). */
  DEFAULT_ZONE_RADIUS_M: 150,
  /** Client interpolation buffer (ms). */
  INTERP_DELAY_MS: 250,
} as const;

export type WeaponId = keyof typeof GAME.WEAPONS;
export const WEAPON_IDS = ["blaster", "rocket"] as const satisfies readonly WeaponId[];

export const TEAMS = ["red", "blue"] as const;
export type Team = (typeof TEAMS)[number];

export const AVATARS = ["scout", "heavy", "medic", "sniper", "robot", "ninja"] as const;
export type AvatarId = (typeof AVATARS)[number];

export const AVATAR_COLORS: Record<AvatarId, number> = {
  scout: 0x4ade80,
  heavy: 0xf97316,
  medic: 0xf8fafc,
  sniper: 0xa78bfa,
  robot: 0x38bdf8,
  ninja: 0x111827,
};

export const TEAM_COLORS: Record<Team, number> = {
  red: 0xef4444,
  blue: 0x3b82f6,
};
