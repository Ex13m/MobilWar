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
  /**
   * Vertical half-angle (deg) the aim may deviate from the target's elevation.
   * Targets stand on the same ground plane, so this is generous — it exists so
   * that pointing the phone at the sky or at your own feet is a clean miss.
   */
  VERT_HALF_ANGLE_DEG: 22,
  /**
   * Lag compensation. A client renders other players INTERP_DELAY_MS in the
   * past, so a shot is resolved against where the target was on the shooter's
   * screen. The cap bounds how far back a bad connection can rewind the world,
   * which is what stops "I died behind cover".
   */
  MAX_REWIND_MS: 400,
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
  /**
   * Quake's map control: items do not appear at random, they sit at fixed points
   * on fixed timers, so a team that knows the clock owns the lawn. The big two
   * are called out before they come back, which is what "timing the mega" is.
   */
  ITEMS: {
    /** Respawn after being taken, ms, per kind. */
    RESPAWN_MS: { overcharge: 90000, shield: 45000, medkit: 35000, ammo: 25000 },
    /** How long before a big item returns the call-out goes out, ms. */
    WARN_MS: 10000,
    WARN_KINDS: ["overcharge", "shield"],
  },
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
    /** Shots before it has to go home. */
    MAG: 12,
    /** Time spent sitting on its anchor reloading, ms. */
    RELOAD_MS: 6000,
    /** Speed on the way home; it does not loiter while empty. */
    RETURN_MPS: 7,
    /** Damage dealt to an obstacle per shot (it chews cover slowly). */
    OBSTACLE_DAMAGE: 12,
  },
  /** Guided rocket: hold to lock, release to fire. */
  ROCKET_LOCK: {
    /** Holding the aim this long on a target completes the lock, ms. */
    MS: 700,
    /** Half-angle the target must stay inside while locking, deg. */
    CONE_DEG: 12,
    /** A locked rocket steers this hard toward its target, deg per second. */
    TURN_DPS: 90,
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
  /**
   * Throwables (docs/TZ.md rows 6-7). Range comes from how far the player tilts
   * the phone up, which is why the aim pitch is now part of the protocol.
   */
  GRENADE: {
    /** Tilt that throws the shortest / longest, in degrees above level. */
    MIN_PITCH_DEG: 10,
    MAX_PITCH_DEG: 45,
    MIN_RANGE_M: 8,
    MAX_RANGE_M: 18,
    /** Time from the throw to the blast, ms. Cooking is not possible: the fuse starts on release. */
    FUSE_MS: 2500,
    /** How far it keeps rolling after it lands, m. */
    ROLL_M: 1,
    /** Apex of the throw arc, m (visual only; the blast point is on the ground). */
    ARC_APEX_M: 4,
    /**
     * Quake's grenade launcher: the grenade does not stop where it lands, it
     * bounces and rolls out its fuse. `HOPS` are the fractions of the fuse each
     * bounce takes, `BOUNCE_DECAY` is how much apex a bounce keeps, and the
     * whole thing is still moving for `FLIGHT_FRAC` of the fuse.
     */
    HOPS: [0.5, 0.28, 0.14, 0.08],
    BOUNCE_DECAY: 0.45,
    FLIGHT_FRAC: 0.8,
    /** Minimum gap between two throws, ms. */
    COOLDOWN_MS: 900,
    TYPES: {
      plasma: {
        /** Damage at the centre, falling to `damageEdge` at `splashM`. */
        damage: 40,
        damageEdge: 10,
        splashM: 5,
        /** Fragments carry a lighter hit out to `splashM * FRAG_RANGE_MUL`. */
        fragments: 8,
        fragDamage: 8,
        perLife: 2,
        color: 0x67e8f9,
      },
      emp: {
        damage: 0,
        damageEdge: 0,
        splashM: 8,
        fragments: 0,
        fragDamage: 0,
        perLife: 1,
        color: 0xa78bfa,
        /** Turrets, drones and shields inside the blast stay down this long, ms. */
        disableMs: 8000,
      },
    },
    /** Fragments reach this multiple of the splash radius. */
    FRAG_RANGE_MUL: 1.8,
  },
  SUPPLY_PER_PLAYER: 6,
  MAX_PLAYERS_PER_ROOM: 16,
  /** Default room geofence radius (m). */
  DEFAULT_ZONE_RADIUS_M: 150,
  /**
   * The round starts by itself once this many players are in the room, after a
   * short countdown. A referee is optional: a pick-up game on a lawn has nobody
   * to run it.
   */
  AUTOSTART_PLAYERS: 2,
  /** Grace period before the automatic countdown begins, ms. */
  AUTOSTART_DELAY_MS: 5000,
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
