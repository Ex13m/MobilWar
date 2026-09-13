/** Tunable game constants. Single source of truth for client + server. */
export const GAME = {
  TICK_HZ: 10,
  /** Position upload rate from client (Hz). */
  POS_HZ: 4,
  /** Max HP per player. */
  MAX_HP: 100,
  /** Shield capacity granted by a shield pickup (absorbs damage before HP). */
  SHIELD_MAX: 50,
  /**
   * Weapons. Damage in HP points. cone = base half-angle (deg); bloom adds per shot (rifle),
   * decays at bloomDecay deg/s. mag/reserve = magazine size and spare rounds per life
   * (reserve -1 = infinite). charge (sniper): hold time (ms) for a charged shot.
   */
  WEAPONS: {
    pistol: { DAMAGE: 12, RANGE_M: 35, COOLDOWN_MS: 200, SPEED_MPS: 80, CONE: 5, CONE_MAX: 14, CONE_PER_M: 0.9, BLOOM: 0, BLOOM_DECAY: 0, MAG: 12, RESERVE: -1, RELOAD_MS: 1000, SPLASH_M: 0, AMMO: 0, FUSE_M: 0, CHARGE_MS: 0, CHARGED_DAMAGE: 0 },
    blaster: { DAMAGE: 9, RANGE_M: 60, COOLDOWN_MS: 100, SPEED_MPS: 70, CONE: 7, CONE_MAX: 16, CONE_PER_M: 0, BLOOM: 0.8, BLOOM_DECAY: 10, MAG: 30, RESERVE: 120, RELOAD_MS: 2000, SPLASH_M: 0, AMMO: 0, FUSE_M: 0, CHARGE_MS: 0, CHARGED_DAMAGE: 0 },
    sniper: { DAMAGE: 50, RANGE_M: 120, COOLDOWN_MS: 1200, SPEED_MPS: 200, CONE: 3, CONE_MAX: 12, CONE_PER_M: 0, BLOOM: 0, BLOOM_DECAY: 0, MAG: 5, RESERVE: 20, RELOAD_MS: 2800, SPLASH_M: 0, AMMO: 0, FUSE_M: 0, CHARGE_MS: 800, CHARGED_DAMAGE: 100 },
    rocket: {
      DAMAGE: 50,
      DAMAGE_EDGE: 15,
      SPLASH_M: 6,
      RANGE_M: 45,
      COOLDOWN_MS: 2500,
      SPEED_MPS: 22,
      AMMO: 2,
      FUSE_M: 3,
      CONE: 10,
      CONE_MAX: 10,
      CONE_PER_M: 0,
      BLOOM: 0,
      BLOOM_DECAY: 0,
      MAG: 1,
      RESERVE: 0,
      RELOAD_MS: 3000,
      CHARGE_MS: 0,
      CHARGED_DAMAGE: 0,
    },
  },
  /** Cone when firing the sniper from the hip (not zoomed) vs zoomed. */
  SNIPER_HIP_CONE: 12,
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
export const WEAPON_IDS = ["pistol", "blaster", "sniper", "rocket"] as const satisfies readonly WeaponId[];
/** Primary weapons a class can pick; pistol is always carried; rocket comes from ammo pickups. */
export const PRIMARY_WEAPONS = ["blaster", "sniper"] as const;
export const WEAPON_NAMES: Record<WeaponId, string> = { pistol: "Искра", blaster: "Гроза", sniper: "Горизонт", rocket: "Молот" };

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
