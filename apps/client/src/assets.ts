import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { WeaponId } from "@mobilwar/shared";

/** Static asset registry. Files live in apps/client/public/assets (CC0, see LICENSES.md). */
export const MODELS = {
  pistol: "/assets/models/blaster-b.glb",
  rifle: "/assets/models/blaster-a.glb",
  sniper: "/assets/models/blaster-e.glb",
  minigun: "/assets/models/machinegun.glb",
  rocket: "/assets/models/rocketlauncherModern.glb",
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
} as const;
export type SfxId = keyof typeof SFX;

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

/** Warm the caches for everything the first fight needs. Safe to call multiple times. */
export function preload(): Promise<void> {
  const models: ModelId[] = ["rifle", "rocket", "turret", "drone", "crate", "rocketAmmo"];
  (Object.keys(SPRITES) as SpriteId[]).forEach(sprite);
  return Promise.all(models.map((m) => loadModel(m).catch(() => null))).then(() => undefined);
}
