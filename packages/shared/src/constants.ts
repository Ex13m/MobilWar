/** Tunable game constants. Single source of truth for client + server. */
export const GAME = {
  TICK_HZ: 10,
  /** Position upload rate from client (Hz). */
  POS_HZ: 4,
  /** Max HP per player. */
  MAX_HP: 100,
  /** Damage per hit for the basic rifle. */
  RIFLE_DAMAGE: 25,
  /** Rifle range, metres. */
  RIFLE_RANGE_M: 60,
  /** Minimum time between shots, ms. */
  RIFLE_COOLDOWN_MS: 400,
  /** Hit cone half-angle (deg) at 0 m; grows with GPS error. */
  CONE_HALF_ANGLE_DEG: 10,
  /** Extra hit radius (m) added to account for combined GPS error. */
  HIT_RADIUS_BASE_M: 3,
  /** Respawn delay, ms. */
  RESPAWN_MS: 8000,
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
    RANGE_M: 25,
    DAMAGE: 10,
    COOLDOWN_MS: 1500,
    HP: 200,
    /** Cost in "supply" points to place one. */
    COST: 3,
    /** Max turrets per team. */
    MAX_PER_TEAM: 3,
  },
  /** Supply points a player gets per round to place objects. */
  SUPPLY_PER_PLAYER: 3,
  MAX_PLAYERS_PER_ROOM: 16,
  /** Default room geofence radius (m). */
  DEFAULT_ZONE_RADIUS_M: 150,
  /** Client interpolation buffer (ms). */
  INTERP_DELAY_MS: 250,
} as const;

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
