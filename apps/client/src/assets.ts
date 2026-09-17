import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { WeaponId } from "@mobilwar/shared";

/** Static asset registry. Files live in apps/client/public/assets (CC0, see LICENSES.md). */
export const MODELS = {
  pistol: "/assets/models/blaster-b.glb",
  pistol2: "/assets/models/blaster-h.glb",
  pistol3: "/assets/models/pistol.glb",
  rifle: "/assets/models/blaster-a.glb",
  rifle2: "/assets/models/blaster-p.glb",
  rifle3: "/assets/models/fps/blaster.glb",
  sniper: "/assets/models/blaster-e.glb",
  sniper2: "/assets/models/sniper.glb",
  minigun: "/assets/models/machinegun.glb",
  rocket: "/assets/models/rocketlauncherModern.glb",
  rocket2: "/assets/models/fps/blaster.glb",
  rocketAmmo: "/assets/models/ammo_rocket.glb",
  clip: "/assets/models/clip-small.glb",
  crate: "/assets/models/crate-small.glb",
  turret: "/assets/models/turret_single.glb",
  drone: "/assets/models/fps/enemy-flying.glb",
} as const;
export type ModelId = keyof typeof MODELS;

export const SPRITES = {
  muzzle1: "/assets/sprites/muzzle_01.png",
  muzzle3: "/assets/sprites/muzzle_03.png",
  muzzle5: "/assets/sprites/muzzle_05.png",
  smoke: "/assets/sprites/smoke_01.png",
  smoke3: "/assets/sprites/smoke_03.png",
  flare: "/assets/sprites/flare_01.png",
  spark: "/assets/sprites/spark_01.png",
  light: "/assets/sprites/light_01.png",
  circle: "/assets/sprites/circle_01.png",
  trace: "/assets/sprites/trace_01.png",
  explosion: "/assets/sprites/explosion00.png",
  scorch: "/assets/sprites/scorch_01.png",
} as const;
export type SpriteId = keyof typeof SPRITES;

/**
 * Hero key art. Loaded by CSS on the screen that needs it, so none of it costs
 * anything until that screen is shown.
 */
export const ART = {
  lobby: "/assets/art/lobby.webp",
  start: "/assets/art/start.webp",
  victory: "/assets/art/victory.webp",
  down: "/assets/art/down.webp",
} as const;

export const SFX = {
  laser1: "/assets/sfx/laser1.ogg",
  laser4: "/assets/sfx/laser4.ogg",
  zap: "/assets/sfx/zap1.ogg",
  blaster: "/assets/sfx/blaster.ogg",
  impact: "/assets/sfx/impactMetal_heavy_000.ogg",
  destroy: "/assets/sfx/enemy_destroy.ogg",
  change: "/assets/sfx/weapon_change.ogg",
  powerup: "/assets/sfx/powerUp5.ogg",
  confirm: "/assets/sfx/confirmation_001.ogg",
  error: "/assets/sfx/error_001.ogg",
  lowDown: "/assets/sfx/lowDown.ogg",
  // Generated cinematic set (Mirelo text-to-audio via Higgsfield game pipeline), see LICENSES.md
  g_pistol_a: "/assets/sfx/gen/pistol_a.ogg",
  g_pistol_b: "/assets/sfx/gen/pistol_b.ogg",
  g_pistol_reload: "/assets/sfx/gen/pistol_reload.ogg",
  g_rifle_a: "/assets/sfx/gen/rifle_a.ogg",
  g_rifle_b: "/assets/sfx/gen/rifle_b.ogg",
  g_rifle_reload: "/assets/sfx/gen/rifle_reload.ogg",
  g_minigun: "/assets/sfx/gen/minigun.ogg",
  g_sniper: "/assets/sfx/gen/sniper.ogg",
  g_sniper_charge: "/assets/sfx/gen/sniper_charge.ogg",
  g_sniper_reload: "/assets/sfx/gen/sniper_reload.ogg",
  g_rocket: "/assets/sfx/gen/rocket.ogg",
  g_grenade: "/assets/sfx/gen/grenade.ogg",
  g_explosion_big: "/assets/sfx/gen/explosion_big.ogg",
  g_explosion_mid: "/assets/sfx/gen/explosion_mid.ogg",
  g_explosion_far: "/assets/sfx/gen/explosion_far.ogg",
  g_emp: "/assets/sfx/gen/emp.ogg",
  g_hit_body: "/assets/sfx/gen/hit_body.ogg",
  g_hit_shield: "/assets/sfx/gen/hit_shield.ogg",
  g_hit_metal: "/assets/sfx/gen/hit_metal.ogg",
  g_ricochet: "/assets/sfx/gen/ricochet.ogg",
  g_hit_confirm: "/assets/sfx/gen/hit_confirm.ogg",
  g_death: "/assets/sfx/gen/death.ogg",
  g_respawn: "/assets/sfx/gen/respawn.ogg",
  g_pickup: "/assets/sfx/gen/pickup.ogg",
  g_shield_up: "/assets/sfx/gen/shield_up.ogg",
  g_heartbeat: "/assets/sfx/gen/heartbeat.ogg",
  g_overheat: "/assets/sfx/gen/overheat.ogg",
  g_empty: "/assets/sfx/gen/empty.ogg",
  g_switch: "/assets/sfx/gen/switch.ogg",
  g_turret: "/assets/sfx/gen/turret.ogg",
  g_drone: "/assets/sfx/gen/drone.ogg",
  g_crate: "/assets/sfx/gen/crate.ogg",
  g_siren: "/assets/sfx/gen/siren.ogg",
  g_victory: "/assets/sfx/gen/victory.ogg",
  g_round_start: "/assets/sfx/gen/round_start.ogg",
  g_lockon: "/assets/sfx/gen/lockon.ogg",
} as const;
export type SfxId = keyof typeof SFX;

/**
 * Generated clips actually shipped in public/assets/sfx/gen. The `g_*` fallback
 * chains name the whole planned set, so the loader consults this list instead of
 * firing a request for every id and collecting 404s on each launch.
 */
export const GEN_SHIPPED: ReadonlySet<string> = new Set([
  "g_crate",
  "g_death",
  "g_drone",
  "g_emp",
  "g_empty",
  "g_explosion_big",
  "g_explosion_far",
  "g_explosion_mid",
  "g_grenade",
  "g_heartbeat",
  "g_hit_body",
  "g_hit_confirm",
  "g_hit_metal",
  "g_hit_shield",
  "g_lockon",
  "g_minigun",
  "g_overheat",
  "g_pickup",
  "g_pistol_a",
  "g_pistol_b",
  "g_pistol_reload",
  "g_respawn",
  "g_ricochet",
  "g_rifle_a",
  "g_rifle_b",
  "g_rifle_reload",
  "g_rocket",
  "g_round_start",
  "g_shield_up",
  "g_siren",
  "g_sniper",
  "g_sniper_charge",
  "g_sniper_reload",
  "g_switch",
  "g_turret",
  "g_victory",
]);

/** Per-weapon presentation: model, how it sits in the hand, recoil, sounds. */
export interface WeaponPreset {
  model: ModelId;
  name: string;
  /** Viewmodel position in camera space (x right, y up, z forward = -). */
  pos: [number, number, number];
  rot: [number, number, number];
  scale: number;
  /** Muzzle position in model space (before scale). */
  muzzle: [number, number, number];
  /** Recoil: backward kick (m), pitch kick (rad), camera kick (deg). */
  kickBack: number;
  kickPitch: number;
  camKick: number;
  boltColor: number;
  flash: SpriteId;
  sfx: SfxId;
  sfxRate: number;
}

export const WEAPON_PRESETS: Record<WeaponId, WeaponPreset> = {
  pistol: {
    model: "pistol",
    name: "Искра",
    pos: [0.22, -0.22, -0.42],
    rot: [0, Math.PI, 0],
    scale: 0.55,
    muzzle: [0, 0.22, -0.25],
    kickBack: 0.04,
    kickPitch: 0.08,
    camKick: 0.6,
    boltColor: 0x7dd3fc,
    flash: "muzzle5",
    sfx: "laser1",
    sfxRate: 1.5,
  },
  sniper: {
    model: "sniper",
    name: "Горизонт",
    pos: [0.24, -0.25, -0.55],
    rot: [0, Math.PI, 0],
    scale: 0.6,
    muzzle: [0, 0.3, -0.75],
    kickBack: 0.12,
    kickPitch: 0.16,
    camKick: 2.5,
    boltColor: 0xc4b5fd,
    flash: "muzzle1",
    sfx: "zap",
    sfxRate: 0.6,
  },
  blaster: {
    model: "rifle",
    name: "Гроза",
    pos: [0.26, -0.24, -0.5],
    rot: [0, Math.PI, 0],
    scale: 0.6,
    muzzle: [0, 0.32, -0.42],
    kickBack: 0.05,
    kickPitch: 0.06,
    camKick: 0.45,
    boltColor: 0xffd23b,
    flash: "muzzle3",
    sfx: "laser4",
    sfxRate: 1.15,
  },
  rocket: {
    model: "rocket",
    name: "Молот",
    pos: [0.3, -0.26, -0.5],
    rot: [0, Math.PI, 0],
    scale: 0.75,
    muzzle: [0, 0.2, -0.45],
    kickBack: 0.12,
    kickPitch: 0.14,
    camKick: 2.5,
    boltColor: 0xffa53b,
    flash: "muzzle1",
    sfx: "blaster",
    sfxRate: 0.55,
  },
};

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const modelCache = new Map<ModelId, Promise<THREE.Group>>();
const spriteCache = new Map<SpriteId, THREE.Texture>();

/** Load (once) and return a fresh clone of a model. Materials are shared; clone them if you tint. */
export async function loadModel(id: ModelId): Promise<THREE.Group> {
  let p = modelCache.get(id);
  if (!p) {
    p = gltfLoader.loadAsync(MODELS[id]).then((g) => {
      g.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          m.castShadow = false;
          m.receiveShadow = false;
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat && "roughness" in mat) mat.roughness = Math.min(mat.roughness, 0.85);
        }
      });
      g.scene.userData.animations = g.animations;
      return g.scene;
    });
    modelCache.set(id, p);
  }
  const src = await p;
  const clone = src.clone(true);
  clone.userData.animations = src.userData.animations;
  return clone;
}

export function sprite(id: SpriteId): THREE.Texture {
  let t = spriteCache.get(id);
  if (!t) {
    t = texLoader.load(SPRITES[id]);
    t.colorSpace = THREE.SRGBColorSpace;
    spriteCache.set(id, t);
  }
  return t;
}

/** Per-model viewmodel scale so different packs look the same size in hand. */
export const MODEL_SCALE: Record<ModelId, number> = {
  pistol: 0.55, pistol2: 0.5, pistol3: 0.9, rifle: 0.6, rifle2: 0.55, rifle3: 0.16, sniper: 0.6, sniper2: 0.7, minigun: 0.9,
  rocket: 0.75, rocket2: 0.18, rocketAmmo: 1, clip: 1, crate: 1, turret: 1, drone: 1,
};

/** Warm the caches for everything the first fight needs. Safe to call multiple times. */
export function preload(): Promise<void> {
  const models: ModelId[] = ["rifle", "pistol", "sniper", "rocket", "turret", "drone", "crate", "rocketAmmo", "pistol2", "pistol3", "rifle2", "rifle3", "sniper2", "minigun", "rocket2"];
  (Object.keys(SPRITES) as SpriteId[]).forEach(sprite);
  return Promise.all(models.map((m) => loadModel(m).catch(() => null))).then(() => undefined);
}
