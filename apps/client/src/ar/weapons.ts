import * as THREE from "three";
import type { WeaponId } from "@mobilwar/shared";
import { WEAPON_PRESETS, MODEL_SCALE, loadModel, sprite, type ModelId } from "../assets.js";
import { weaponById, type WeaponDef } from "@mobilwar/shared";

/** Emissive tint so every catalog variant of the same model reads differently. */
function tint(root: THREE.Object3D, color: number): void {
  const c = new THREE.Color(color);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.emissive = c.clone();
    mat.emissiveIntensity = 0.28;
    m.material = mat;
  });
}

/** Critically damped spring on a scalar. */
class Spring {
  v = 0;
  x = 0;
  constructor(
    private k = 180,
    private d = 24,
  ) {}
  kick(impulse: number): void {
    this.v += impulse;
  }
  step(dt: number, target = 0): number {
    const a = -this.k * (this.x - target) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/**
 * First-person weapon attached to the camera: model, idle sway, walk bob,
 * recoil springs, muzzle flash sprite + light, weapon switch animation.
 * Also reports the camera kick the scene should apply.
 */
export class Viewmodel {
  readonly root = new THREE.Group();
  private holder = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private weapon: WeaponId = "blaster";
  private def: WeaponDef | null = null;
  private back = new Spring(160, 22);
  private pitch = new Spring(200, 26);
  private camPitch = new Spring(220, 28);
  private camYaw = new Spring(220, 28);
  private flash: THREE.Sprite;
  private flashLight: THREE.PointLight;
  private flashUntil = 0;
  private switchT = 1; // 0..1 animation progress of "draw"
  private t = 0;
  private loading = 0;
  visible = true;

  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    camera.add(this.root);
    this.root.add(this.holder);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite("muzzle3"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.flash.scale.set(0.35, 0.35, 1);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffd23b, 0, 4, 2);
    this.holder.add(this.flash, this.flashLight);
    void this.setWeapon("blaster");
  }

  get current(): WeaponId {
    return this.weapon;
  }

  async setWeapon(w: WeaponId, weaponId?: string): Promise<void> {
    this.weapon = w;
    const seq = ++this.loading;
    const p = WEAPON_PRESETS[w];
    const def = weaponId ? weaponById(weaponId) ?? null : this.def;
    this.def = def;
    this.switchT = 0;
    const modelId = (def && def.model in MODEL_SCALE ? (def.model as ModelId) : p.model);
    const m = await loadModel(modelId);
    if (seq !== this.loading) return;
    if (this.model) this.holder.remove(this.model);
    const scale = MODEL_SCALE[modelId] ?? p.scale;
    m.scale.setScalar(scale);
    m.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    if (def) tint(m, def.color);
    // Centre the model on its bounding box so presets are stable across packs.
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    m.position.sub(c);
    this.model = m;
    this.holder.add(m);
    this.holder.position.set(p.pos[0], p.pos[1], p.pos[2]);
    // muzzle = front of the bounding box along the barrel (-Z after rotation)
    const box2 = new THREE.Box3().setFromObject(m);
    const mz = new THREE.Vector3(0, (box2.min.y + box2.max.y) / 2 + 0.03, box2.min.z);
    this.flash.position.copy(mz);
    this.flashLight.position.copy(mz);
    (this.flash.material as THREE.SpriteMaterial).map = sprite(p.flash);
    const color = def ? def.color : p.boltColor;
    (this.flash.material as THREE.SpriteMaterial).color.set(color);
    this.flashLight.color.set(color);
  }

  /** Fire animation. Returns nothing; camera kick is read via cameraKick(). */
  fire(): void {
    const p = WEAPON_PRESETS[this.weapon];
    this.back.kick(-p.kickBack * 40);
    this.pitch.kick(p.kickPitch * 40);
    this.camPitch.kick(p.camKick * 12);
    this.camYaw.kick((Math.random() - 0.5) * p.camKick * 6);
    this.flashUntil = this.t + 0.06;
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.3 + Math.random() * 0.15);
    this.flashLight.intensity = 8;
  }

  /** World position of the muzzle (for spawning bolts). */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.flash.getWorldPosition(out);
  }

  /** Camera kick in degrees {pitch, yaw} to be applied by the scene this frame. */
  cameraKick(): { pitch: number; yaw: number } {
    return { pitch: this.camPitch.x, yaw: this.camYaw.x };
  }

  update(dt: number, speedMps: number): void {
    this.t += dt;
    const b = this.back.step(dt);
    const pk = this.pitch.step(dt);
    this.camPitch.step(dt);
    this.camYaw.step(dt);
    this.switchT = Math.min(1, this.switchT + dt / 0.35);
    const draw = 1 - Math.pow(1 - this.switchT, 3);
    // idle sway + walk bob
    const bobA = 0.004 + Math.min(0.02, speedMps * 0.01);
    const bobF = speedMps > 0.6 ? 7 : 1.2;
    const sx = Math.sin(this.t * bobF) * bobA;
    const sy = Math.abs(Math.cos(this.t * bobF)) * bobA * 1.4;
    // Anchor to the visible frustum so the weapon sits bottom-right on any aspect ratio / zoom.
    const p = WEAPON_PRESETS[this.weapon];
    const z = -p.pos[2];
    const hh = z * Math.tan((this.camera.fov * Math.PI) / 360);
    const hw = hh * this.camera.aspect;
    this.holder.position.x = hw * 0.5 + p.pos[0] * 0.2 + sx;
    this.holder.position.y = -hh * 0.62 + p.pos[1] * 0.2 - 0.35 * (1 - draw) + sy;
    this.holder.position.z = p.pos[2] + b;
    this.holder.rotation.x = pk + 0.5 * (1 - draw);
    this.holder.rotation.z = Math.sin(this.t * 0.9) * 0.01;
    if (this.flash.visible && this.t > this.flashUntil) {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
    this.root.visible = this.visible;
  }
}
