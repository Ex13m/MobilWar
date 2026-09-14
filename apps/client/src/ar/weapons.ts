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
    mat.emissiveIntensity = 0.12;
    m.material = mat;
  });
}

/** Stable 0..1 hash of a catalog id, so a weapon always builds the same kit. */
function hash01(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const KIT_DARK = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.55, metalness: 0.8 });

/**
 * Procedural attachment kit.
 *
 * The catalog holds 120 variants but the asset pack only has eleven weapon
 * meshes, so without this every gun in a slot is the same silhouette. The kit
 * bolts primitives onto the loaded mesh — barrel, optic, magazine, rail light,
 * heat fins — chosen deterministically from the catalog id and the trait, and
 * tinted with the weapon's colour. Costs a handful of triangles per gun.
 *
 * Returns the group plus how far forward the muzzle moved, so the flash and the
 * ejected casings still line up with the barrel.
 */
function buildKit(def: WeaponDef, box: THREE.Box3): { group: THREE.Group; muzzleZ: number } {
  const g = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({
    color: 0x2a2f36,
    roughness: 0.35,
    metalness: 0.7,
    emissive: new THREE.Color(def.color),
    emissiveIntensity: 0.9,
  });
  const size = box.getSize(new THREE.Vector3());
  const frontZ = box.min.z;
  const topY = box.max.y;
  const botY = box.min.y;
  const midY = (box.min.y + box.max.y) / 2;
  const gauge = Math.max(0.012, Math.min(size.y, size.x) * 0.16);
  let muzzleZ = 0;

  // --- barrel ---------------------------------------------------------------
  const barrelKind = Math.floor(hash01(def.id, 1) * 4);
  if (barrelKind === 1) {
    // suppressor: long smooth tube
    const len = size.z * 0.34;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(gauge * 1.5, gauge * 1.5, len, 10), KIT_DARK);
    m.rotation.x = Math.PI / 2;
    m.position.set(0, midY, frontZ - len / 2);
    g.add(m);
    muzzleZ = len;
  } else if (barrelKind === 2) {
    // muzzle brake: short tube with three vent rings
    const len = size.z * 0.16;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(gauge * 1.3, gauge * 1.1, len, 8), KIT_DARK);
    m.rotation.x = Math.PI / 2;
    m.position.set(0, midY, frontZ - len / 2);
    g.add(m);
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(gauge * 1.5, gauge * 0.25, 4, 10), glow);
      r.position.set(0, midY, frontZ - len * (0.2 + i * 0.3));
      g.add(r);
    }
    muzzleZ = len;
  } else if (barrelKind === 3) {
    // twin under-barrel rails
    const len = size.z * 0.22;
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(gauge * 0.8, gauge * 0.8, len), KIT_DARK);
      m.position.set(sx * gauge * 1.6, midY - gauge, frontZ - len / 2);
      g.add(m);
    }
    muzzleZ = len * 0.6;
  }

  // --- optic ----------------------------------------------------------------
  const opticKind = Math.floor(hash01(def.id, 2) * 4);
  if (opticKind === 1 || def.trait === "charge") {
    // scope: tube with a glowing objective
    const len = size.z * 0.3;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(gauge * 1.2, gauge * 1.2, len, 10), KIT_DARK);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, topY + gauge * 1.2, box.min.z + size.z * 0.45);
    g.add(tube);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(gauge * 1.1, 10), glow);
    lens.position.set(0, topY + gauge * 1.2, tube.position.z - len / 2 - 0.001);
    g.add(lens);
  } else if (opticKind === 2) {
    // red dot on a riser
    const riser = new THREE.Mesh(new THREE.BoxGeometry(gauge * 1.4, gauge * 1.6, gauge * 2), KIT_DARK);
    riser.position.set(0, topY + gauge * 0.8, box.min.z + size.z * 0.5);
    g.add(riser);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(gauge * 0.5, 8, 6), glow);
    dot.position.set(0, topY + gauge * 1.5, riser.position.z);
    g.add(dot);
  }

  // --- magazine -------------------------------------------------------------
  if (def.mag >= 40 || def.trait === "overheat") {
    // drum
    const d = new THREE.Mesh(new THREE.CylinderGeometry(size.y * 0.42, size.y * 0.42, gauge * 1.6, 12), KIT_DARK);
    d.rotation.z = Math.PI / 2;
    d.position.set(0, botY - size.y * 0.22, box.min.z + size.z * 0.62);
    g.add(d);
  } else if (def.mag >= 18) {
    // extended box
    const h = size.y * 0.5;
    const m = new THREE.Mesh(new THREE.BoxGeometry(gauge * 2, h, gauge * 3), KIT_DARK);
    m.position.set(0, botY - h * 0.4, box.min.z + size.z * 0.62);
    g.add(m);
  }

  // --- rail light / laser ---------------------------------------------------
  if (hash01(def.id, 3) > 0.55) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(gauge * 0.6, gauge * 0.6, size.z * 0.16, 8), glow);
    l.rotation.x = Math.PI / 2;
    l.position.set(gauge * 2, midY - gauge * 0.8, frontZ + size.z * 0.1);
    g.add(l);
  }

  // --- heat fins: the loud, hot traits wear their cooling on the outside -----
  if (def.trait === "burn" || def.trait === "overheat" || def.trait === "emp") {
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(gauge * 3, gauge * 0.3, gauge * 0.8), glow);
      f.position.set(0, topY + gauge * 0.2, box.min.z + size.z * (0.2 + i * 0.09));
      g.add(f);
    }
  }
  return { group: g, muzzleZ };
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
  private kit: THREE.Group | null = null;
  private weapon: WeaponId = "blaster";
  private def: WeaponDef | null = null;
  private back = new Spring(160, 22);
  private pitch = new Spring(200, 26);
  private camPitch = new Spring(220, 28);
  private camYaw = new Spring(220, 28);
  private flash: THREE.Sprite;
  private flash2: THREE.Sprite;
  private flashLight: THREE.PointLight;
  private casings: THREE.InstancedMesh;
  private casingState: Array<{ active: boolean; pos: THREE.Vector3; vel: THREE.Vector3; rot: number; life: number }> = [];
  private casingIdx = 0;
  private scene: THREE.Object3D;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3(1, 1, 1);
  private flashUntil = 0;
  private switchT = 1; // 0..1 animation progress of "draw"
  private t = 0;
  private loading = 0;
  visible = true;

  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Object3D) {
    this.camera = camera;
    this.scene = scene;
    camera.add(this.root);
    this.root.add(this.holder);
    // Two-layer muzzle flash (sharp shape + soft glow), HDR colours so bloom picks them up.
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite("muzzle3"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }));
    this.flash.scale.set(0.35, 0.35, 1);
    this.flash.visible = false;
    this.flash2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite("light"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }));
    this.flash2.scale.set(0.7, 0.7, 1);
    this.flash2.visible = false;
    this.flashLight = new THREE.PointLight(0xffc27a, 0, 26, 2);
    this.holder.add(this.flash, this.flash2, this.flashLight);
    // Ejected casings: one InstancedMesh, pooled.
    const geo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.04, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.95 });
    this.casings = new THREE.InstancedMesh(geo, mat, 32);
    this.casings.frustumCulled = false;
    for (let i = 0; i < 32; i++) {
      this.casingState.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: 0, life: 0 });
      this.tmpM.compose(new THREE.Vector3(0, -100, 0), this.tmpQ.identity(), this.tmpS);
      this.casings.setMatrixAt(i, this.tmpM);
    }
    this.casings.instanceMatrix.needsUpdate = true;
    scene.add(this.casings);
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
    // Two or three meshes cover thirty variants per slot, so give each catalog
    // id its own size as well as its own kit: heavier guns read bigger in hand.
    const bulk = def ? 0.9 + hash01(def.id, 7) * 0.26 : 1;
    const scale = (MODEL_SCALE[modelId] ?? p.scale) * bulk;
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
    if (this.kit) {
      this.holder.remove(this.kit);
      this.kit = null;
    }
    let muzzleZ = box2.min.z;
    if (def) {
      const { group, muzzleZ: ext } = buildKit(def, box2);
      this.kit = group;
      this.holder.add(group);
      muzzleZ -= ext;
    }
    const mz = new THREE.Vector3(0, (box2.min.y + box2.max.y) / 2 + 0.03, muzzleZ);
    this.flash.position.copy(mz);
    this.flash2.position.copy(mz);
    this.flashLight.position.copy(mz);
    (this.flash.material as THREE.SpriteMaterial).map = sprite(p.flash);
    const color = def ? def.color : p.boltColor;
    (this.flash.material as THREE.SpriteMaterial).color.set(color).multiplyScalar(4);
    (this.flash2.material as THREE.SpriteMaterial).color.set(color).multiplyScalar(2.5);
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
    this.flash2.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.3 + Math.random() * 0.15);
    this.flash2.scale.setScalar(0.6 + Math.random() * 0.2);
    this.flashLight.intensity = 60;
    if (this.weapon !== "rocket") this.ejectCasing();
  }

  private ejectCasing(): void {
    const c = this.casingState[this.casingIdx]!;
    this.casingIdx = (this.casingIdx + 1) % this.casingState.length;
    // eject point: right side of the holder, in world space
    const ej = new THREE.Vector3(0.08, 0.02, 0.05).applyMatrix4(this.holder.matrixWorld);
    c.pos.copy(ej);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    const up = new THREE.Vector3(0, 1, 0);
    c.vel.copy(right).multiplyScalar(1.6 + Math.random() * 0.8).addScaledVector(up, 1.8 + Math.random() * 0.8);
    c.rot = Math.random() * Math.PI * 2;
    c.life = 1.4;
    c.active = true;
  }

  private updateCasings(dt: number): void {
    let any = false;
    for (let i = 0; i < this.casingState.length; i++) {
      const c = this.casingState[i]!;
      if (!c.active) continue;
      any = true;
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.rot += dt * 12;
      if (c.pos.y < 0.02) {
        c.pos.y = 0.02;
        c.vel.y *= -0.35;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
      }
      if (c.life <= 0) {
        c.active = false;
        this.tmpM.compose(new THREE.Vector3(0, -100, 0), this.tmpQ.identity(), this.tmpS);
      } else {
        this.tmpQ.setFromEuler(new THREE.Euler(c.rot, c.rot * 0.7, 0));
        this.tmpM.compose(c.pos, this.tmpQ, this.tmpS);
      }
      this.casings.setMatrixAt(i, this.tmpM);
    }
    if (any) this.casings.instanceMatrix.needsUpdate = true;
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
      this.flash2.visible = false;
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 400);
    this.updateCasings(dt);
    this.root.visible = this.visible;
  }
}
