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
