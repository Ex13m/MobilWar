import * as THREE from "three";
import { ParticleSystem, softSpriteTexture } from "./particles.js";

/** Visual language: team colours + weapon colours. */
export const FX = {
  blasterRed: 0xff3b3b,
  blasterBlue: 0x3b9dff,
  blasterYellow: 0xffd23b,
  rocket: 0xffa53b,
  turret: 0xff8c3b,
  drone: 0x3bffd0,
  hit: 0xffffff,
  heal: 0x4ade80,
  shield: 0x38bdf8,
};

interface Bolt {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  light: THREE.PointLight | null;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  onArrive?: () => void;
}

interface Fireball {
  core: THREE.Mesh;
  ring: THREE.Mesh;
  light: THREE.PointLight;
  t: number;
  dur: number;
  radius: number;
}

interface Label {
  sprite: THREE.Sprite;
  t: number;
  dur: number;
  vy: number;
}

/**
 * All transient visuals: projectiles (blaster bolts), explosions, sparks,
 * muzzle flashes, floating damage numbers. One ParticleSystem is shared.
 */
export class Effects {
  readonly particles: ParticleSystem;
  private bolts: Bolt[] = [];
  private fireballs: Fireball[] = [];
  private labels: Label[] = [];
  private glowTex = softSpriteTexture(64);
  private boltGeo = new THREE.CapsuleGeometry(0.06, 0.9, 4, 8);
  private ringGeo = new THREE.RingGeometry(0.9, 1, 48);
  private sphereGeo = new THREE.SphereGeometry(1, 16, 12);
  private lightBudget = 4;

  constructor(private scene: THREE.Object3D) {
    this.particles = new ParticleSystem(scene, 3000, this.glowTex);
    this.boltGeo.rotateX(Math.PI / 2); // capsule along Z
  }

  /** A glowing bolt flying from → to (world coords). Speed in m/s. */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, speed = 70, onArrive?: () => void): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(this.boltGeo, mat);
    mesh.position.copy(from);
    mesh.lookAt(to);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
    glow.scale.set(0.7, 0.7, 1);
    mesh.add(glow);
    let light: THREE.PointLight | null = null;
    if (this.lightBudget > 0) {
      light = new THREE.PointLight(color, 6, 6, 2);
      mesh.add(light);
      this.lightBudget--;
    }
    this.scene.add(mesh);
    const dist = from.distanceTo(to);
    this.bolts.push({ mesh, glow, light, from: from.clone(), to: to.clone(), t: 0, dur: Math.max(0.05, dist / speed), onArrive });
    // muzzle sparks
    const dir = to.clone().sub(from).normalize();
    this.particles.emit({ pos: from, count: 10, vel: dir.multiplyScalar(6), spread: 3, life: 0.25, size: 0.18, color, color2: 0xffffff, drag: 2 });
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, color: number): void {
    this.particles.emit({ pos, count: 18, vel: dir.clone().multiplyScalar(8), spread: 4, life: 0.18, size: 0.35, color: 0xffffff, color2: color, drag: 3 });
  }

  hitSpark(pos: THREE.Vector3, color = FX.hit): void {
    this.particles.emit({ pos, count: 24, spread: 5, life: 0.5, size: 0.14, color, color2: 0xffb060, gravity: 6, drag: 1 });
  }

  shieldRipple(pos: THREE.Vector3): void {
    this.particles.emit({ pos, count: 30, spread: 2.5, life: 0.6, size: 0.25, color: FX.shield, color2: 0xffffff, drag: 2 });
  }

  explosion(pos: THREE.Vector3, radius: number): void {
    const core = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    core.position.copy(pos).setY(pos.y + 0.6);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffa53b, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).setY(0.1);
    const light = new THREE.PointLight(0xffa040, 40, radius * 4, 2);
    light.position.copy(pos).setY(1.5);
    this.scene.add(core, ring, light);
    this.fireballs.push({ core, ring, light, t: 0, dur: 0.7, radius });
    const up = new THREE.Vector3(0, 7, 0);
    this.particles.emit({ pos: core.position, count: 120, vel: up, spread: 9, life: 0.9, lifeVar: 0.5, size: 0.6, color: 0xffe08a, color2: 0xff5a1f, gravity: 4, drag: 1.2 });
    this.particles.emit({ pos: core.position, count: 60, vel: up.clone().multiplyScalar(0.5), spread: 4, life: 1.8, lifeVar: 0.4, size: 1.4, color: 0x555555, color2: 0x222222, gravity: -1, drag: 1 });
    this.particles.emit({ pos: core.position, count: 40, spread: 14, life: 0.6, size: 0.12, color: 0xffffff, color2: 0xffc060, gravity: 12, drag: 0.5 });
  }

  /** Rocket exhaust: call every frame while a rocket flies. */
  exhaust(pos: THREE.Vector3, backDir: THREE.Vector3): void {
    this.particles.emit({ pos, count: 3, vel: backDir.clone().multiplyScalar(4), spread: 1, life: 0.35, size: 0.35, color: 0xffd080, color2: 0xff6a20, drag: 2 });
    this.particles.emit({ pos, count: 2, vel: backDir.clone().multiplyScalar(1.5), spread: 0.8, life: 1.4, size: 0.8, color: 0x9a9a9a, color2: 0x444444, gravity: -0.6, drag: 1 });
  }

  /** Floating damage number above a point. */
  damageNumber(pos: THREE.Vector3, text: string, color: string): void {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 64;
    const c = cv.getContext("2d")!;
    c.font = "bold 44px system-ui, sans-serif";
    c.textAlign = "center";
    c.lineWidth = 6;
    c.strokeStyle = "rgba(0,0,0,0.8)";
    c.strokeText(text, 64, 48);
    c.fillStyle = color;
    c.fillText(text, 64, 48);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.position.copy(pos);
    const d = Math.max(1, pos.length());
    const s = 0.9 + d / 15;
    sprite.scale.set(s, s / 2, 1);
    this.scene.add(sprite);
    this.labels.push({ sprite, t: 0, dur: 1.1, vy: 1.2 });
  }

  update(dt: number): void {
    this.particles.update(dt);
    // bolts
    this.bolts = this.bolts.filter((b) => {
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.mesh.position.lerpVectors(b.from, b.to, k);
      if (k >= 1) {
        this.scene.remove(b.mesh);
        if (b.light) this.lightBudget++;
        b.onArrive?.();
        return false;
      }
      return true;
    });
    // fireballs
    this.fireballs = this.fireballs.filter((f) => {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const s = f.radius * (0.3 + 0.7 * Math.sqrt(k));
      f.core.scale.setScalar(s * 0.22);
      (f.core.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k) * (1 - k);
      f.ring.scale.setScalar(s * 1.2);
      (f.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      f.light.intensity = 40 * (1 - k);
      if (k >= 1) {
        this.scene.remove(f.core, f.ring, f.light);
        return false;
      }
      return true;
    });
    // labels
    this.labels = this.labels.filter((l) => {
      l.t += dt;
      const k = l.t / l.dur;
      l.sprite.position.y += l.vy * dt;
      (l.sprite.material as THREE.SpriteMaterial).opacity = 1 - k * k;
      if (k >= 1) {
        this.scene.remove(l.sprite);
        (l.sprite.material as THREE.SpriteMaterial).map?.dispose();
        return false;
      }
      return true;
    });
  }
}
