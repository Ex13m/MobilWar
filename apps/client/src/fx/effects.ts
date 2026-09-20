import * as THREE from "three";
import { ParticleSystem, ringSpriteTexture, softSpriteTexture } from "./particles.js";

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

/**
 * How a round is drawn. Borrowed from the pooled "skins" in the TreaskaAr
 * prototype: one projectile object per class instead of one capsule for
 * everything, so a slug, an energy bolt and a plasma orb read differently in
 * the air.
 */
export type BoltSkin = "streak" | "bolt" | "orb" | "beam";

interface Bolt {
  skin: BoltSkin;
  mesh: THREE.Mesh;
  core: THREE.Object3D | null;
  glow: THREE.Sprite;
  light: THREE.PointLight | null;
  from: THREE.Vector3;
  to: THREE.Vector3;
  dist: number;
  tailM: number;
  t: number;
  dur: number;
  fade: number;
  arrived: boolean;
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
  /** Airburst extras: the ring sprite, the delayed crackle, the flash light. */
  private billboards: Array<{ sprite: THREE.Sprite; t: number; dur: number; radius: number }> = [];
  private crackles: Array<{ pos: THREE.Vector3; color: number; at: number; radius: number }> = [];
  private flashes: Array<{ light: THREE.PointLight; t: number; dur: number; peak: number }> = [];
  private glowTex = softSpriteTexture(64);
  private ringTex = ringSpriteTexture(128);
  private boltGeo = new THREE.CapsuleGeometry(0.07, 1, 4, 8); // unit length, stretched per frame
  private coreGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 8);
  private orbGeo = new THREE.IcosahedronGeometry(0.17, 0);
  private ringGeo = new THREE.RingGeometry(0.9, 1, 48);
  private sphereGeo = new THREE.SphereGeometry(1, 16, 12);
  private lightBudget = 4;

  constructor(private scene: THREE.Object3D) {
    this.particles = new ParticleSystem(scene, 3000, this.glowTex);
    this.boltGeo.rotateX(Math.PI / 2); // capsule along Z
    this.coreGeo.rotateX(Math.PI / 2);
  }

  /**
   * A round in flight, drawn according to its class:
   *  - `streak` — a bullet: a thin stretched trace, the way a tracer reads;
   *  - `bolt`   — an energy round: a solid glowing rod with a halo;
   *  - `orb`    — plasma: a tumbling ball of fire leaving sparks behind it;
   *  - `beam`   — a rail slug: the whole line at once, gone in a blink.
   * Speed is in m/s; the drawing caps it (see below) while the server keeps the
   * real one for damage.
   */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, speed = 70, onArrive?: () => void, skin: BoltSkin = "streak"): void {
    const hot = new THREE.Color(color).multiplyScalar(3.5);
    const mat = new THREE.MeshBasicMaterial({ color: hot, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(this.boltGeo, mat);
    mesh.position.copy(from);
    mesh.lookAt(to);
    mesh.scale.set(1, 1, 0.02);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, toneMapped: false }));
    glow.scale.setScalar(skin === "orb" ? 1.3 : skin === "bolt" ? 0.95 : 0.8);
    glow.position.copy(from);
    // The solid part of an energy round or a plasma ball: a real object in the
    // air rather than a smear, which is what makes it read as 3D.
    let core: THREE.Object3D | null = null;
    if (skin === "bolt" || skin === "orb") {
      const cm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).lerp(new THREE.Color(color), 0.35), toneMapped: false });
      core = new THREE.Mesh(skin === "orb" ? this.orbGeo : this.coreGeo, cm);
      if (skin === "bolt") {
        core.scale.set(1, 1, 0.55);
        core.lookAt(to.clone().sub(from).add(core.position));
      }
      core.position.copy(from);
      this.scene.add(core);
    }
    let light: THREE.PointLight | null = null;
    if (this.lightBudget > 0) {
      light = new THREE.PointLight(color, skin === "orb" ? 9 : 6, skin === "orb" ? 9 : 6, 2);
      light.position.copy(from);
      this.scene.add(light);
      this.lightBudget--;
    }
    this.scene.add(mesh, glow);
    const dist = Math.max(0.05, from.distanceTo(to));
    // A round leaving the camera is seen end-on and recedes, so the honest
    // flight time is not watchable: 400 m/s over 20 m is 50 ms, three frames,
    // and a railgun is instant. The server keeps the real speed for damage;
    // the tracer is drawn at a capped one, held for a floor, and stretched
    // into a streak so the shot reads as a line going out, not as a dot.
    const shown = Math.min(speed, skin === "orb" ? 45 : 120);
    const dur = skin === "beam" ? 0.001 : Math.max(0.15, dist / shown);
    const tailM = skin === "beam" ? dist : skin === "streak" ? Math.min(9, Math.max(2, dist * 0.5)) : skin === "bolt" ? 1.6 : 0.9;
    this.bolts.push({ skin, mesh, core, glow, light, from: from.clone(), to: to.clone(), dist, tailM, t: 0, dur, fade: skin === "beam" ? 0.2 : 0.12, arrived: false, onArrive });
    if (skin === "beam") {
      // The rail slug is already there: draw the full line and let it decay.
      mesh.scale.set(1.6, 1.6, dist);
      mesh.position.lerpVectors(from, to, 0.5);
      this.particles.emit({ pos: to, count: 14, spread: 4, life: 0.35, size: 0.12, color, color2: 0xffffff, drag: 1.5 });
    }
    // muzzle sparks
    const dir = to.clone().sub(from).normalize();
    this.particles.emit({ pos: from, count: 10, vel: dir.multiplyScalar(6), spread: 3, life: 0.25, size: 0.18, color, color2: 0xffffff, drag: 2 });
  }

  /**
   * An airburst: a round that tears open in the air rather than on someone.
   * Two shells (colour, then a white core), a ring facing the viewer and a
   * crackle of falling sparks — a firework, which is exactly what it looks like
   * from twenty metres away.
   */
  airburst(pos: THREE.Vector3, color: number, radius = 3): void {
    this.particles.emit({ pos, count: 60, spread: 7 * (radius / 3), life: 0.75, lifeVar: 0.3, size: 0.22, color, color2: 0xffffff, gravity: 5, drag: 0.8 });
    this.particles.emit({ pos, count: 26, spread: 3.2, life: 0.35, size: 0.4, color: 0xffffff, color2: color, drag: 2.5 });
    // the crackle: a second, smaller shell a moment later, falling
    this.crackles.push({ pos: pos.clone(), color, at: 0.16, radius });
    this.billboardRing(pos, color, radius);
    if (this.lightBudget > 0) {
      const l = new THREE.PointLight(color, 25, radius * 6, 2);
      l.position.copy(pos);
      this.scene.add(l);
      this.lightBudget--;
      this.flashes.push({ light: l, t: 0, dur: 0.45, peak: 25 });
    }
  }

  /** A shock ring that always faces the viewer, for bursts that happen in the air. */
  private billboardRing(pos: THREE.Vector3, color: number, radius: number): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ringTex, color: new THREE.Color(color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, toneMapped: false }));
    s.position.copy(pos);
    s.scale.setScalar(0.4);
    this.scene.add(s);
    this.billboards.push({ sprite: s, t: 0, dur: 0.45, radius });
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
    const core = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
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
      if (!b.arrived && k >= 1) {
        b.arrived = true;
        b.onArrive?.();
      }
      // The head runs from muzzle to impact; the tail trails tailM behind it
      // and, once the head is home, runs in over `fade` so the streak collapses
      // into the hit instead of blinking out.
      const f = b.arrived ? Math.min(1, (b.t - b.dur) / b.fade) : 0;
      if (b.skin === "beam") {
        // The whole line is already drawn: it only fades.
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - f) * (1 - f);
        (b.glow.material as THREE.SpriteMaterial).opacity = 0;
      } else {
        const tailK = Math.max(0, Math.min(1, k - (b.tailM / b.dist) * (1 - f)));
        const seg = Math.max(0.02, (k - tailK) * b.dist);
        b.mesh.position.lerpVectors(b.from, b.to, (k + tailK) / 2);
        b.mesh.scale.z = seg;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = (b.skin === "streak" ? 0.95 : 0.55) * (1 - f * f);
        b.glow.position.lerpVectors(b.from, b.to, k);
        (b.glow.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - f);
      }
      if (b.core) {
        b.core.position.copy(b.glow.position);
        if (b.skin === "orb") {
          // A plasma ball tumbles and drops sparks, the way the TreaskaAr orbs do.
          b.core.rotation.x += dt * 6;
          b.core.rotation.y += dt * 4;
          if (!b.arrived && Math.random() < dt * 20) {
            this.particles.emit({ pos: b.core.position, count: 2, spread: 0.6, life: 0.35, size: 0.14, color: (b.glow.material as THREE.SpriteMaterial).color.getHex(), color2: 0xffffff, gravity: 1.5, drag: 1.6 });
          }
        }
        b.core.visible = f < 1;
      }
      if (b.light) {
        b.light.position.copy(b.glow.position);
        b.light.intensity = 6 * (1 - f);
      }
      if (b.t >= b.dur + b.fade) {
        this.scene.remove(b.mesh, b.glow);
        if (b.core) this.scene.remove(b.core);
        if (b.light) {
          this.scene.remove(b.light);
          this.lightBudget++;
        }
        return false;
      }
      return true;
    });
    // airburst extras: expanding ring, the delayed crackle, the flash light
    this.billboards = this.billboards.filter((b) => {
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.sprite.scale.setScalar(0.4 + b.radius * 2.2 * Math.sqrt(k));
      (b.sprite.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.scene.remove(b.sprite);
        (b.sprite.material as THREE.SpriteMaterial).dispose();
        return false;
      }
      return true;
    });
    this.crackles = this.crackles.filter((c) => {
      c.at -= dt;
      if (c.at > 0) return true;
      this.particles.emit({ pos: c.pos, count: 34, spread: 4.5 * (c.radius / 3), life: 0.9, lifeVar: 0.4, size: 0.12, color: 0xffffff, color2: c.color, gravity: 9, drag: 0.5 });
      return false;
    });
    this.flashes = this.flashes.filter((fl) => {
      fl.t += dt;
      const k = Math.min(1, fl.t / fl.dur);
      fl.light.intensity = fl.peak * (1 - k) * (1 - k);
      if (k >= 1) {
        this.scene.remove(fl.light);
        this.lightBudget++;
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
